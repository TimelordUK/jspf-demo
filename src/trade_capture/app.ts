import 'reflect-metadata'

import * as fs from 'fs'
import * as path from 'path'

import { TradeCaptureServer } from './trade-capture-server'
import { TradeCaptureClient } from './trade-capture-client'
import { CustomLogonClient, CustomLogonMsgFactory } from './custom-logon'
import { SkeletonSession } from './skeleton'
import { startHeapReport } from './heap-report'
import { brokerLogonFields, ensureBrokerDictionary } from './broker-dictionary'
import {
  AsciiSession, EngineFactory, IJsFixConfig, ISessionDescription, ISessionMsgFactory,
  JsFixLoggerFactory, SessionLauncher
} from 'jspurefix'
import {
  CliOptions, getConfigPaths, lateCounterparty, parseCliOptions, SessionMode, storeDirectories
} from './cli'
import { describeJsonLogs, makeLogFactory } from './logging'

class AppLauncher extends SessionLauncher {
  /** custom-logon mode: an initiator whose Logon is built by its own factory */
  private readonly bespokeLogon: boolean
  /** skeleton mode: both roles run the same do-nothing session */
  private readonly skeleton: boolean

  public constructor (
    client: string | ISessionDescription | null,
    server: string | ISessionDescription | null,
    mode: SessionMode,
    // the third argument to SessionLauncher is where an application decides how every
    // log line this run produces gets rendered - see logging.ts.  Omit it and the
    // engine uses its own console factory
    logFactory?: JsFixLoggerFactory
  ) {
    super(client, server, logFactory)
    this.root = __dirname
    this.bespokeLogon = mode === 'custom-logon'
    this.skeleton = mode === 'skeleton'
  }

  /**
   * Supply this application's own session message factory - the one hook needed to
   * build a Logon the engine could not have derived from the description.  Return
   * null (the default) for the stock factory.
   *
   * Constant extra fields do not need this at all: name them under "Logon" in the
   * session description.  A factory is for values known only at run time.
   */
  protected override makeSessionMsgFactory (
    description: ISessionDescription): ISessionMsgFactory | null {
    if (!this.bespokeLogon || !this.isInitiator(description)) return null
    return new CustomLogonMsgFactory(description)
  }

  protected override makeFactory (config: IJsFixConfig): EngineFactory {
    const isInitiator = this.isInitiator(config.description)
    // skeleton runs the same class on both sides: with no application layer there
    // is nothing left for the roles to differ on
    const Client = this.skeleton
      ? SkeletonSession
      : this.bespokeLogon ? CustomLogonClient : TradeCaptureClient
    const Server = this.skeleton ? SkeletonSession : TradeCaptureServer
    return {
      // take the config handed to us rather than closing over the launcher's.  An
      // acceptor resolves each accepted connection from its own scope, so this is
      // that session's own description, store and message factory - without it
      // every client on a multi-client acceptor would share one identity.
      makeSession: (sessionConfig: IJsFixConfig): AsciiSession => isInitiator
        ? new Client(sessionConfig)
        : new Server(sessionConfig)
    } as EngineFactory
  }
}

// resolve rather than join: mode configs are relative to dist/trade_capture, but a
// --session override has already been made absolute against the working directory
function loadDescription (relativePath: string): any {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8'))
}

function withStore (description: any, store?: string): ISessionDescription {
  if (store) {
    description.store = { ...description.store, type: 'file', directory: store }
  }
  return description as ISessionDescription
}

/**
 * Turn the initiator into one that keeps trying, and that re-establishes a lost
 * transport rather than ending with it.  Two knobs, which are the two questions
 * anyone actually asks: how often, and for how long.
 *
 * The engine's own defaults - 5s between recovery attempts, 60s before giving up -
 * are sensible for a real session and far too slow to watch, so a demo run tries
 * every 3s unless told otherwise.
 */
function withResilience (description: any, opts: CliOptions): ISessionDescription {
  if (!opts.resilient) return description as ISessionDescription
  const retryEvery = opts.retryEvery ?? defaultRetryEvery
  description.application = {
    ...description.application,
    resilient: true,
    // how often: paces attempts whilst connecting, and the wait before going back for
    // a transport that has been lost
    reconnectSeconds: retryEvery,
    recoveryAttemptSeconds: retryEvery,
    backoffFailConnectSeconds: retryEvery,
    // how long: the deadline those attempts run against
    connectTimeoutSeconds: opts.giveUpAfter ?? defaultGiveUpAfter
  }
  return description as ISessionDescription
}

const defaultRetryEvery = 3
const defaultGiveUpAfter = 60

/**
 * Each client in a multi-client run needs its own SenderCompId, otherwise they all
 * present the same identity and the acceptor's session registry - quite correctly -
 * stops each one as the next logs on.  Mirrors the C# demo, which suffixes
 * SenderCompID with _1.._n.
 */
function clientDescription (relativePath: string, index: number, total: number, store?: string): ISessionDescription {
  const description = loadDescription(relativePath)
  if (total > 1) {
    description.SenderCompId = `${description.SenderCompId}_${index}`
    description.application.name = `${description.application.name}_${index}`
  }
  return withStore(description, store)
}

/**
 * A description for one named counterparty.  Only SenderCompId changes - the venue
 * it is calling, the dictionary and the store directory are identical, which is the
 * point: nothing about the acceptor is per counterparty either.
 */
function counterpartyDescription (relativePath: string, name: string, store?: string): ISessionDescription {
  const description = loadDescription(relativePath)
  description.SenderCompId = name
  description.application.name = name
  return withStore(description, store)
}

function storeDirFor (relativePath: string, override?: string): string {
  return override ?? loadDescription(relativePath).store?.directory ?? 'store'
}

/**
 * The whole point of the mode: show what the acceptor knew beforehand (nothing) and
 * what it ends up holding (one identity, and one store, per counterparty).
 */
function describeDynamicRun (opts: CliOptions, acceptorPath: string): void {
  const acceptor = loadDescription(acceptorPath)
  const joiners = opts.counterparties
  console.log('')
  console.log('  dynamic acceptor')
  console.log('  ────────────────')
  console.log(`  the venue listens as SenderCompId '${acceptor.SenderCompId}' with TargetCompID '${acceptor.TargetCompID}',`)
  console.log('  so it has no configuration for, and no prior knowledge of, any counterparty.')
  console.log('')
  console.log('  connecting at start:')
  joiners.forEach(n => { console.log(`    ${n}`) })
  if (opts.lateJoinAfter > 0) {
    console.log(`  joining after ${opts.lateJoinAfter}s, with no restart of the venue:`)
    console.log(`    ${lateCounterparty}`)
  }
  console.log('')
  console.log('  each adopts its own SessionId on Logon, watch for:')
  console.log("    'binding session identity to peer SenderCompID'")
  console.log("    'acceptor census: ... sessions=[...]'")
  console.log('')
}

/** what the venue ended up holding - one store per counterparty it met */
function reportDynamicOutcome (acceptorPath: string, store?: string): void {
  const dir = path.join(__dirname, '../..', storeDirFor(acceptorPath, store))
  console.log('')
  console.log('  the venue now holds a session store per counterparty it met:')
  if (!fs.existsSync(dir)) {
    console.log(`    (nothing under ${dir})`)
    return
  }
  fs.readdirSync(dir).filter(f => f.endsWith('.seqnums')).sort().forEach(f => {
    const seq = fs.readFileSync(path.join(dir, f), 'utf8').trim().replace(/\s+/g, ' ')
    console.log(`    ${f}   [${seq}]`)
  })
  console.log('')
  console.log('  none of those names appear anywhere in the acceptor configuration.')
  console.log('')
}

/**
 * skeleton mode.  Says what is deliberately absent, because the interesting thing
 * about the mode is everything it does not do.
 */
function describeSkeletonRun (opts: CliOptions): void {
  console.log('')
  console.log('  skeleton')
  console.log('  ────────')
  console.log('  no application messages: both sides log on and then hold the session up with')
  console.log('  heartbeats alone.  What it costs is what the engine costs.')
  console.log('')
  if (opts.clients > 1) {
    console.log(`  ${opts.clients} clients against one acceptor - it runs TargetCompID '*', so each takes`)
    console.log('  its identity, and its own session, from whichever client logs on.')
    console.log('')
  }
  console.log('  what to watch for:')
  console.log("    'session ready - heartbeat only'   both sides are up")
  console.log("    '35=0'                            the heartbeats, in jsfix.skeleton_*.txt")
  if (opts.heapEvery > 0) {
    console.log(`    '[heap]'                          gc and heap, every ${opts.heapEvery}s`)
  }
  console.log('')
  console.log('  to point it at a real counterparty, copy data/session/skeleton-initiator.json,')
  console.log('  edit the host, port and comp ids, then:')
  console.log('    node dist/trade_capture/app.js skeleton --client --session ./my-broker.json')
  console.log('')
}

/**
 * custom-logon mode.  Generates a dictionary that declares the counterparty's tags on
 * Logon and returns its absolute path - the second half of the problem, and the half
 * people usually miss.  Putting a field on the Logon object achieves nothing if the
 * dictionary has no field of that name on that message: the encoder has no tag to
 * write it to, so it drops it.
 */
function describeCustomLogonRun (): string {
  const dictionary = ensureBrokerDictionary(path.join(__dirname, '../../data'))
  console.log('')
  console.log('  custom logon')
  console.log('  ────────────')
  console.log('  the counterparty wants tags on Logon that standard FIX 4.4 does not carry:')
  brokerLogonFields.forEach(f => { console.log(`    ${f.name} (${f.tag})`) })
  console.log('')
  console.log('  three things make that work, and all three are needed:')
  console.log('    1. a dictionary declaring those fields on Logon   (generated above)')
  console.log('    2. a "Logon" block in the session description     (custom-logon-initiator.json)')
  console.log('    3. a factory, for what only run time knows        (CustomLogonMsgFactory)')
  console.log('')
  console.log("  the block also names 'NotAFixField', which no dictionary declares - watch the")
  console.log('  engine say so rather than dropping it in silence.')
  console.log('')
  return dictionary
}

/**
 * resilient runs.  The interesting one is the first: with no peer to talk to, the run
 * is nothing but the retry loop, which is exactly what you want to look at when a
 * counterparty's endpoint is down or you have the port wrong.
 */
function describeResilientRun (opts: CliOptions, hasServer: boolean): void {
  const retryEvery = opts.retryEvery ?? defaultRetryEvery
  const giveUpAfter = opts.giveUpAfter ?? defaultGiveUpAfter
  console.log('')
  console.log('  resilient initiator')
  console.log('  ───────────────────')
  console.log('  the session outlives the transport: losing the connection schedules another')
  console.log('  attempt rather than ending the run, and the same session resumes on the new one.')
  console.log('')
  console.log(`  trying every ${retryEvery}s, giving up after ${giveUpAfter}s`)
  console.log('')
  if (!hasServer) {
    console.log('  nothing is listening on the other end, so this run is the retry loop by itself.')
    console.log('  what to watch for:')
    console.log("    'recovery policy: ...'               the settings above, as the engine read them")
    console.log("    'connect: start initiator timeout'   a round of attempts begins")
    console.log(`    'retries N ECONNREFUSED ...'         the attempts, one every ${retryEvery}s`)
    console.log('')
    console.log(`  after ${giveUpAfter}s it gives up, and the reason reaches this application: what run()`)
    console.log('  rejects with is the socket error itself, so a caller can read its code as well')
    console.log('  as its message.  (jspurefix 5.11.1+ - before that the message was empty, because')
    console.log('  a host resolving to both ::1 and 127.0.0.1 fails as an AggregateError.)')
    console.log('')
    console.log('  start its peer in another terminal and it logs on with no restart here:')
    console.log('    npm run skeleton:server')
  } else {
    console.log('  what to watch for once the connection drops:')
    console.log("    'recover session transport - attempt in Ns'   the loss is noticed")
    console.log("    'connect: receive new transport'              it is back")
    console.log("    'session ready'                               a second time, same session")
  }
  console.log('')
}

/** point a description at a dictionary, by absolute path - see broker-dictionary.ts */
function withDictionary (description: any, dictionary?: string): ISessionDescription {
  if (dictionary) {
    description.application.dictionary = dictionary
  }
  return description as ISessionDescription
}

function clearStores (): void {
  storeDirectories.forEach(dir => {
    const full = path.join(__dirname, '../..', dir)
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true })
      console.log(`cleared ${dir}`)
    }
  })
  console.log('stores cleared')
}

function launch (opts: CliOptions): void {
  const paths = getConfigPaths(opts)

  console.log(`mode: ${opts.mode}, client: ${paths.client != null}, server: ${paths.server != null}, clients: ${opts.clients}`)
  if (opts.store) console.log(`store override: ${opts.store}`)
  if (opts.session) console.log(`session override: ${opts.session}`)
  if (opts.mode === 'dynamic' && paths.server) describeDynamicRun(opts, paths.server)
  if (opts.mode === 'skeleton') describeSkeletonRun(opts)
  if (opts.resilient) describeResilientRun(opts, paths.server != null)
  if (opts.jsonLogs) describeJsonLogs()

  // one factory for the whole run, so client and acceptor render the same way
  const logFactory = makeLogFactory(opts.jsonLogs)

  const bespokeLogon = opts.mode === 'custom-logon'
  const dictionary = bespokeLogon ? describeCustomLogonRun() : undefined

  if (opts.disconnectAfter != null) {
    TradeCaptureClient.disconnectAfterSeconds = opts.disconnectAfter
    SkeletonSession.disconnectAfterSeconds = opts.disconnectAfter
  }
  if (opts.dropAfter != null) {
    SkeletonSession.dropClientAfterSeconds = opts.dropAfter
  }
  SkeletonSession.writeFixLog = opts.fixLog
  startHeapReport(opts.heapEvery)

  // The acceptor gets its own launcher so it keeps listening after any one client
  // goes away - a launcher given both roles ends when its client ends.
  const acceptor: AppLauncher | null = paths.server
    ? new AppLauncher(
      null, withDictionary(withStore(loadDescription(paths.server), opts.store), dictionary), opts.mode,
      logFactory)
    : null

  const dynamic = opts.mode === 'dynamic'
  const clientLaunchers: AppLauncher[] = []

  if (paths.client) {
    const clientConfigPath = paths.client
    if (dynamic) {
      opts.counterparties.forEach(name => {
        clientLaunchers.push(new AppLauncher(
          withResilience(counterpartyDescription(clientConfigPath, name, opts.store), opts),
          null, opts.mode, logFactory))
      })
    } else {
      for (let i = 1; i <= opts.clients; ++i) {
        const description = withResilience(withDictionary(
          clientDescription(paths.client, i, opts.clients, opts.store), dictionary), opts)
        clientLaunchers.push(new AppLauncher(description, null, opts.mode, logFactory))
      }
    }
  }

  // stagger the starts so the acceptor is listening first, and so a multi-client
  // run does not arrive as one connection storm
  let slot = 0
  // the acceptor's own run only ends when its listener closes, below
  const acceptorRun = acceptor ? start(acceptor, slot++ * staggerMs) : null
  // one entry per client this run will ever have, each settling when that client's
  // session ends - the late joiner takes its slot now, though it connects later
  const clientRuns: Array<Promise<void>> = clientLaunchers.map(async l => { await start(l, slot++ * staggerMs) })

  // a counterparty the venue has never seen, arriving well after it started - no
  // restart, no config change, it simply logs on and gets its own session
  if (dynamic && paths.client && opts.lateJoinAfter > 0) {
    const clientPath = paths.client
    clientRuns.push((async () => {
      await delay(opts.lateJoinAfter * 1000)
      console.log('')
      console.log(`  >>> previously unseen counterparty '${lateCounterparty}' is connecting now`)
      console.log('')
      await start(
        new AppLauncher(counterpartyDescription(clientPath, lateCounterparty, opts.store), null, opts.mode,
          logFactory), 0)
    })())
  }

  if (opts.timeout != null) {
    setTimeout(() => {
      if (dynamic && paths.server) reportDynamicOutcome(paths.server, opts.store)
      console.log(`timeout after ${opts.timeout}s, shutting down`)
      // close the listener properly rather than letting the exit tear it down, but
      // still guarantee what --timeout promises: this process is gone at N seconds.
      // A resilient initiator needs telling too - it is mid retry loop, and stopping
      // it is what cancels the pending attempt (jspurefix 5.11.0)
      acceptor?.stop()
      clientLaunchers.forEach(l => { l.stop() })
      setTimeout(() => { process.exit(0) }, 250)
    }, opts.timeout * 1000)
  }

  if (acceptor && acceptorRun) {
    shutdownWhenClientsDone(acceptor, acceptorRun, clientRuns, opts, paths, dynamic)
  }
}

/** start a launcher after a delay, resolving when whatever it started has ended */
async function start (launcher: AppLauncher, delayMs: number): Promise<void> {
  await delay(delayMs)
  try {
    await launcher.run()
  } catch (e) {
    console.error(e)
  }
}

async function delay (ms: number): Promise<void> {
  await new Promise<void>(resolve => { setTimeout(resolve, ms) })
}

const staggerMs = 300

/**
 * An acceptor outlives any one client - that is the whole reason it has a launcher of
 * its own, and why nothing closes its listener when a session ends.  But once every
 * client this run will ever have has finished there is nothing left to serve, and the
 * listening socket is then the only thing holding the process open: the run appears to
 * hang long after the logs say everything shut down.
 *
 * So close it, and node exits by itself.  Two runs are deliberately left listening:
 *   --server, where the clients are other processes and this one is the venue
 *   --disconnect-after, whose entire point is to watch the acceptor survive a client
 * both of which say so rather than leaving anyone guessing.
 */
function shutdownWhenClientsDone (
  acceptor: AppLauncher,
  acceptorRun: Promise<void>,
  clientRuns: Array<Promise<void>>,
  opts: CliOptions,
  paths: { server: string | null },
  dynamic: boolean): void {
  // a resilient client never finishes on its own - that is the point of it - so there
  // is no "all clients done" moment to wait for, and waiting would hang the run
  if (clientRuns.length === 0 || opts.disconnectAfter != null || opts.resilient) {
    console.log('acceptor keeps listening - ctrl-c, or --timeout <seconds>, to end the run')
    return
  }
  void (async () => {
    await Promise.all(clientRuns)
    console.log('all clients finished, stopping acceptor')
    acceptor.stop()
    // the launcher's run resolves once the listener has actually closed, by which
    // time each accepted session has written its sequence numbers - report after
    // that, or the venue appears to hold an empty store for its last counterparty
    await acceptorRun
    if (dynamic && paths.server) reportDynamicOutcome(paths.server, opts.store)
  })()
}

const opts = parseCliOptions()
if (opts.mode === 'clear') {
  clearStores()
} else {
  launch(opts)
}
