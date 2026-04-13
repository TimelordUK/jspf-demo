import { Command } from 'commander'

export type SessionMode = 'reset' | 'recovery' | 'broker-reset'

export interface CliOptions {
  mode: SessionMode
  client: boolean
  server: boolean
  timeout?: number
  disconnectAfter?: number
}

/**
 * Config file pairs for each session mode.
 * Paths are relative to __dirname (dist/trade_capture/).
 */
const modeConfigs: Record<SessionMode, { initiator: string, acceptor: string }> = {
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
  }
}

export function getConfigPaths (opts: CliOptions): { client: string | null, server: string | null } {
  const configs = modeConfigs[opts.mode]
  return {
    client: opts.server ? null : configs.initiator,
    server: opts.client ? null : configs.acceptor
  }
}

export function parseCliOptions (argv?: string[]): CliOptions {
  const program = new Command()

  program
    .name('jspf-demo')
    .description('jspurefix trade capture demo — reference application')
    .argument('[mode]', 'session mode: reset (default), recovery, broker-reset', 'reset')
    .option('--client', 'run initiator (client) only')
    .option('--server', 'run acceptor (server) only')
    .option('--timeout <seconds>', 'shutdown after N seconds', parseInt)
    .option('--disconnect-after <seconds>', 'disconnect client after N seconds (reconnect testing)', parseInt)

  program.parse(argv ?? process.argv)
  const opts = program.opts()
  const mode = program.args[0] as SessionMode ?? 'reset'

  if (opts.client && opts.server) {
    console.error('error: --client and --server are mutually exclusive. Omit both to run both.')
    process.exit(1)
  }

  const validModes: SessionMode[] = ['reset', 'recovery', 'broker-reset']
  if (!validModes.includes(mode)) {
    console.error(`error: unknown mode '${mode}'. Valid modes: ${validModes.join(', ')}`)
    process.exit(1)
  }

  return {
    mode,
    client: opts.client ?? false,
    server: opts.server ?? false,
    timeout: opts.timeout,
    disconnectAfter: opts.disconnectAfter
  }
}
