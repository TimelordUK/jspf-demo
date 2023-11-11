import 'reflect-metadata'

import { TradeCaptureServer } from './trade-capture-server'
import { TradeCaptureClient } from './trade-capture-client'
import { EngineFactory, IJsFixConfig, SessionLauncher } from 'jspurefix'

class AppLauncher extends SessionLauncher {
  public constructor (client: string = '../../data/session/test-initiator.json',
    server: string = '../../data/session/test-acceptor.json') {
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

const l = new AppLauncher()
l.exec()
