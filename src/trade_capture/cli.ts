import { Command } from 'commander'

export type SessionMode =
  'reset' | 'recovery' | 'broker-reset' | 'multi-client' | 'dynamic' | 'custom-logon' | 'clear'

export interface CliOptions {
  mode: SessionMode
  client: boolean
  server: boolean
  timeout?: number
  disconnectAfter?: number
  /** number of initiators to spawn, each with a unique SenderCompId suffix */
  clients: number
  /** override the store directory from the session config */
  store?: string
  /** dynamic mode: the counterparties to connect, none known to the acceptor */
  counterparties: string[]
  /** dynamic mode: seconds before the late joiner connects, 0 to disable */
  lateJoinAfter: number
}

/**
 * Counterparties for `dynamic` mode.  Deliberately unrelated names - the point is
 * that the acceptor is configured with TargetCompID '*' and has never heard of any
 * of them until they log on.
 */
export const defaultCounterparties: string[] = [
  'hedge-fund-a',
  'market-maker-b',
  'retail-broker-c'
]

/** joins after the others, to show the acceptor needs no restart to take a new one */
export const lateCounterparty = 'prop-desk-d'

/**
 * Config file pairs for each session mode.
 * Paths are relative to __dirname (dist/trade_capture/).
 */
const modeConfigs: Record<Exclude<SessionMode, 'clear'>, { initiator: string, acceptor: string }> = {
  reset: {
    initiator: '../../data/session/test-initiator.json',
    acceptor: '../../data/session/test-acceptor.json'
  },
  recovery: {
    initiator: '../../data/session/recovery-initiator.json',
    acceptor: '../../data/session/recovery-acceptor.json'
  },
  'broker-reset': {
    initiator: '../../data/session/broker-reset-initiator.json',
    acceptor: '../../data/session/broker-reset-acceptor.json'
  },
  // the acceptor here runs TargetCompID '*', so each accepted session takes its
  // identity - and therefore its own store - from whichever client logs on
  'multi-client': {
    initiator: '../../data/session/multi-client-initiator.json',
    acceptor: '../../data/session/multi-client-acceptor.json'
  },
  // same wildcard acceptor, but the counterparties are unrelated names the venue
  // has never been configured with - the point of the mode is that it does not
  // need to know them in advance
  dynamic: {
    initiator: '../../data/session/dynamic-initiator.json',
    acceptor: '../../data/session/dynamic-acceptor.json'
  },
  // a Logon carrying tags standard FIX 4.4 does not have, against a dictionary
  // generated at start up to admit them - jspurefix issues #93, #39, #96
  'custom-logon': {
    initiator: '../../data/session/custom-logon-initiator.json',
    acceptor: '../../data/session/custom-logon-acceptor.json'
  }
}

/** store directories written by the modes above, emptied by `clear` */
export const storeDirectories: string[] = [
  'store/initiator',
  'store/acceptor',
  'store/broker-initiator',
  'store/broker-acceptor',
  'store/multi-initiator',
  'store/multi-acceptor',
  'store/dynamic-initiator',
  'store/dynamic-acceptor'
]

export function getConfigPaths (opts: CliOptions): { client: string | null, server: string | null } {
  if (opts.mode === 'clear') return { client: null, server: null }
  const configs = modeConfigs[opts.mode]
  return {
    client: opts.server ? null : configs.initiator,
    server: opts.client ? null : configs.acceptor
  }
}

const validModes: SessionMode[] =
  ['reset', 'recovery', 'broker-reset', 'multi-client', 'dynamic', 'custom-logon', 'clear']

export function parseCliOptions (argv?: string[]): CliOptions {
  const program = new Command()

  program
    .name('jspf-demo')
    .description('jspurefix trade capture demo — reference application')
    .argument('[mode]', `session mode: ${validModes.join(', ')}`, 'reset')
    .option('--client', 'run initiator (client) only')
    .option('--server', 'run acceptor (server) only')
    .option('--clients <n>', 'number of clients to spawn, 1-5 (multi-client acceptor testing)', parseInt)
    .option('--counterparties <names>', 'dynamic mode: comma separated SenderCompIds to connect')
    .option('--late-join-after <seconds>', 'dynamic mode: seconds before a previously unseen counterparty joins, 0 to disable', parseInt)
    .option('--store <dir>', 'override the store directory from the session config')
    .option('--timeout <seconds>', 'shutdown after N seconds', parseInt)
    .option('--disconnect-after <seconds>', 'disconnect client after N seconds (reconnect testing)', parseInt)

  program.parse(argv ?? process.argv)
  const opts = program.opts()
  const mode = program.args[0] as SessionMode ?? 'reset'

  if (opts.client && opts.server) {
    console.error('error: --client and --server are mutually exclusive. Omit both to run both.')
    process.exit(1)
  }

  if (!validModes.includes(mode)) {
    console.error(`error: unknown mode '${mode}'. Valid modes: ${validModes.join(', ')}`)
    process.exit(1)
  }

  const clients = opts.clients ?? 1
  if (!Number.isInteger(clients) || clients < 1 || clients > 5) {
    console.error('error: --clients must be an integer between 1 and 5')
    process.exit(1)
  }

  if (clients > 1 && opts.server === true) {
    console.error('error: --clients has no meaning with --server (the acceptor does not spawn clients)')
    process.exit(1)
  }

  const counterparties: string[] = opts.counterparties
    ? String(opts.counterparties).split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
    : defaultCounterparties

  if (counterparties.length === 0) {
    console.error('error: --counterparties needs at least one name')
    process.exit(1)
  }

  return {
    mode,
    client: opts.client ?? false,
    server: opts.server ?? false,
    timeout: opts.timeout,
    disconnectAfter: opts.disconnectAfter,
    clients,
    store: opts.store,
    counterparties,
    lateJoinAfter: opts.lateJoinAfter ?? 8
  }
}
