import 'reflect-metadata'

import * as fs from 'fs'
import * as path from 'path'

import { TradeCaptureServer } from './trade-capture-server'
import { TradeCaptureClient } from './trade-capture-client'
import { EngineFactory, IJsFixConfig, ISessionDescription, SessionLauncher } from 'jspurefix'
import { CliOptions, getConfigPaths, lateCounterparty, parseCliOptions, storeDirectories } from './cli'

class AppLauncher extends SessionLauncher {
  public constructor (
    client: string | ISessionDescription | null,
    server: string | ISessionDescription | null
  ) {
    super(client, server)
    this.root = __dirname
  }

  protected override makeFactory (config: IJsFixConfig): EngineFactory {
    const isInitiator = this.isInitiator(config.description)
    return {
      // take the config handed to us rather than closing over the launcher's.  An
      // acceptor resolves each accepted connection from its own scope, so this is
      // that session's own description, store and message factory - without it
      // every client on a multi-client acceptor would share one identity.
      makeSession: (sessionConfig: IJsFixConfig) => isInitiator
        ? new TradeCaptureClient(sessionConfig)
        : new TradeCaptureServer(sessionConfig)
    } as EngineFactory
  }
}

function loadDescription (relativePath: string): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'))
}

function withStore (description: any, store?: string): ISessionDescription {
  if (store) {
    description.store = { ...description.store, type: 'file', directory: store }
  }
  return description as ISessionDescription
}

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
  if (opts.mode === 'dynamic' && paths.server) describeDynamicRun(opts, paths.server)

  if (opts.disconnectAfter != null) {
    TradeCaptureClient.disconnectAfterSeconds = opts.disconnectAfter
  }

  const launchers: AppLauncher[] = []

  // The acceptor gets its own launcher so it keeps listening after any one client
  // goes away - a launcher given both roles ends when its client ends.
  if (paths.server) {
    launchers.push(new AppLauncher(null, withStore(loadDescription(paths.server), opts.store)))
  }

  const dynamic = opts.mode === 'dynamic'

  if (paths.client) {
    const clientConfigPath = paths.client
    if (dynamic) {
      opts.counterparties.forEach(name => {
        launchers.push(new AppLauncher(counterpartyDescription(clientConfigPath, name, opts.store), null))
      })
    } else {
      for (let i = 1; i <= opts.clients; ++i) {
        launchers.push(new AppLauncher(clientDescription(paths.client, i, opts.clients, opts.store), null))
      }
    }
  }

  if (opts.timeout != null) {
    setTimeout(() => {
      if (dynamic && paths.server) reportDynamicOutcome(paths.server, opts.store)
      console.log(`timeout after ${opts.timeout}s, shutting down`)
      process.exit(0)
    }, opts.timeout * 1000)
  }

  // a counterparty the venue has never seen, arriving well after it started - no
  // restart, no config change, it simply logs on and gets its own session
  if (dynamic && paths.client && opts.lateJoinAfter > 0) {
    const clientPath = paths.client
    setTimeout(() => {
      console.log('')
      console.log(`  >>> previously unseen counterparty '${lateCounterparty}' is connecting now`)
      console.log('')
      new AppLauncher(counterpartyDescription(clientPath, lateCounterparty, opts.store), null).exec()
    }, opts.lateJoinAfter * 1000)
  }

  // stagger the starts so the acceptor is listening first, and so a multi-client
  // run does not arrive as one connection storm
  launchers.forEach((launcher, i) => {
    setTimeout(() => {
      launcher.exec()
    }, i * 300)
  })
}

const opts = parseCliOptions()
if (opts.mode === 'clear') {
  clearStores()
} else {
  launch(opts)
}
