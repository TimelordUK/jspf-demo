import 'reflect-metadata'

import { TradeCaptureServer } from './trade-capture-server'
import { TradeCaptureClient } from './trade-capture-client'
import { EngineFactory, IJsFixConfig, SessionLauncher } from 'jspurefix'
import { getConfigPaths, parseCliOptions } from './cli'

class AppLauncher extends SessionLauncher {
  public constructor (
    client: string | null,
    server: string | null
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
const paths = getConfigPaths(opts)

console.log(`mode: ${opts.mode}, client: ${paths.client != null}, server: ${paths.server != null}`)

const launcher = new AppLauncher(paths.client, paths.server)

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
