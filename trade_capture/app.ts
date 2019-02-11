import { TradeCaptureClient } from './trade-capture-client'
import { TradeCaptureServer } from './trade-capture-server'
import { IJsFixConfig, initiator, acceptor } from 'jspurefix'
import { Launcher } from '../launcher'

class AppLauncher extends Launcher {
  public constructor () {
    super(
      './../test-initiator.json',
      './../test-acceptor.json')
  }

  protected getAcceptor (config: IJsFixConfig): Promise<any> {
    return acceptor(config, c => new TradeCaptureServer(c))
  }

  protected getInitiator (config: IJsFixConfig): Promise<any> {
    return initiator(config, c => new TradeCaptureClient(c))
  }
}

const l = new AppLauncher()
l.run().then(() => {
  console.log('finished.')
})
