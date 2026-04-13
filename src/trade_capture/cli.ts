import { Command } from 'commander'

export interface CliOptions {
  client: boolean
  server: boolean
  timeout?: number
  disconnectAfter?: number
  config?: string
}

export function parseCliOptions (argv?: string[]): CliOptions {
  const program = new Command()

  program
    .name('jspf-demo')
    .description('jspurefix trade capture demo — reference application')
    .option('--client', 'run initiator (client) only')
    .option('--server', 'run acceptor (server) only')
    .option('--timeout <seconds>', 'shutdown after N seconds', parseInt)
    .option('--disconnect-after <seconds>', 'disconnect client after N seconds (reconnect testing)', parseInt)
    .option('--config <path>', 'path to session config directory (default: data/session)')

  program.parse(argv ?? process.argv)
  const opts = program.opts()

  if (opts.client && opts.server) {
    console.error('error: --client and --server are mutually exclusive. Omit both to run both.')
    process.exit(1)
  }

  return {
    client: opts.client ?? false,
    server: opts.server ?? false,
    timeout: opts.timeout,
    disconnectAfter: opts.disconnectAfter,
    config: opts.config
  }
}
