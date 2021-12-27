import 'reflect-metadata'

import { TradeCaptureServer } from './trade-capture-server'
import { TradeCaptureClient } from './trade-capture-client'
import { SessionLauncher, EngineFactory, IJsFixConfig } from 'jspurefix'

class AppLauncher extends SessionLauncher {
  public constructor (client: string = './test-initiator.json',
                      server: string = './test-acceptor.json') {
    super(client, server)
  }

  protected override makeFactory (config: IJsFixConfig): EngineFactory {
    const isInitiator = this.isInitiator(config.description)
    return {
      makeSession: () => isInitiator ?
        new TradeCaptureClient(config) :
        new TradeCaptureServer(config)
    } as EngineFactory
  }
}

const l = new AppLauncher()
l.exec()
