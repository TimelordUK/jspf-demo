import { AsciiSessionMsgFactory } from 'jspurefix'
import { ILooseObject } from 'jspurefix/dist/collections/collection'
import { MsgType } from 'jspurefix/dist/types/FIX4.4/repo'
import { TradeCaptureClient } from './trade-capture-client'

/**
 * The third and last way to customise a Logon, for the case the other two cannot
 * cover: a value that is not known until the moment of connecting.
 *
 *   1. constant extra fields  -> the "Logon" block in the session description
 *   2. computed on every send -> an ObjectMutator on the factory
 *   3. a Logon built by hand  -> this
 *
 * Call super and spread.  Rebuilding the object from scratch loses the fields the
 * engine derives from the description, and those are the ones the session itself
 * depends on.
 */
export class CustomLogonMsgFactory extends AsciiSessionMsgFactory {
  public logon (): ILooseObject {
    const stock = super.logon()
    return {
      // the "Logon" block from the description is already folded into `stock`
      ...stock,
      // ... and here is what only run time knows.  A real broker would want an HMAC
      // over the timestamp, or a token fetched from an auth endpoint - the shape is
      // the same, and it belongs here rather than in a config file.
      Password: this.sessionToken()
    }
  }

  private sessionToken (): string {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
    return `${this.description.SenderCompId}-${stamp}`
  }
}

/** prints the Logon it sent, so the effect of all of the above is visible */
export class CustomLogonClient extends TradeCaptureClient {
  protected onEncoded (msgType: string, txt: string): void {
    super.onEncoded(msgType, txt)
    if (msgType !== MsgType.Logon) return
    console.log('')
    console.log('  the logon this client sent:')
    console.log(`    ${txt}`)
    console.log('')
  }
}
