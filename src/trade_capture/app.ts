import 'reflect-metadata'

import { TradeCaptureServer } from './trade-capture-server'
import { TradeCaptureClient } from './trade-capture-client'
import { EngineFactory, IJsFixConfig, SessionLauncher } from 'jspurefix'
import { parseCliOptions } from './cli'

class AppLauncher extends SessionLauncher {
  public constructor (
    client: string | null = '../../data/session/test-initiator.json',
    server: string | null = '../../data/session/test-acceptor.json'
  ) {
    super(client, server)
    this.root = __dirname
  }

  protected override makeFactory (config: IJsFixConfig): EngineFactory {
    const isInitiator = this.isInitiator(config.description)
    return {
      makeSession: () => isInitiator
        ? new TradeCaptureClient(config)
        : new TradeCaptureServer(config)
    } as EngineFactory
  }
}

const opts = parseCliOptions()

// Determine which configs to pass based on CLI flags
const clientConfig = opts.server ? null : '../../data/session/test-initiator.json'
const serverConfig = opts.client ? null : '../../data/session/test-acceptor.json'

// Override config directory if specified
const configDir = opts.config ?? '../../data/session'
const resolvedClient = clientConfig ? `${configDir}/test-initiator.json` : null
const resolvedServer = serverConfig ? `${configDir}/test-acceptor.json` : null

const launcher = new AppLauncher(resolvedClient, resolvedServer)

// Apply disconnect-after if specified (for reconnect testing)
if (opts.disconnectAfter != null) {
  TradeCaptureClient.disconnectAfterSeconds = opts.disconnectAfter
}

// Apply timeout
if (opts.timeout != null) {
  setTimeout(() => {
    console.log(`timeout after ${opts.timeout}s, shutting down`)
    process.exit(0)
  }, opts.timeout * 1000)
}

launcher.exec()
