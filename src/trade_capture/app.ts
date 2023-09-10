import 'reflect-metadata'

import { TradeCaptureClient } from './trade-capture-client'
import { TradeCaptureServer } from './trade-capture-server'
import { EngineFactory, IJsFixConfig, SessionLauncher } from 'jspurefix'

class AppLauncher extends SessionLauncher {
  public constructor (client: string, server: string) {
    super(client, server)
    this.root = __dirname
  }

  protected override makeFactory (config: IJsFixConfig): EngineFactory {
    const isInitiator = this.isInitiator(config.description)
    return {
      makeSession: () => isInitiator
        ?  new TradeCaptureClient(config)
        :  new TradeCaptureServer(config)
    }
  }
}

// omit server for client only no test mock server
const l = new AppLauncher('../../test-initiator.json', '../../test-acceptor.json')
l.exec()
