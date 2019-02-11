import {
  AsciiSession,
  MsgView,
  IJsFixConfig,
  IJsFixLogger,
  Dictionary,
  MsgType } from 'jspurefix'

import {
  ITradeCaptureReport,
  ITradeCaptureReportRequest,
  ITradeCaptureReportRequestAck
} from 'jspurefix/dist/types/FIX4.4/repo'

import { TradeFactory } from './trade-factory'

export class TradeCaptureClient extends AsciiSession {
  private readonly logger: IJsFixLogger
  private readonly fixLog: IJsFixLogger
  private reports: Dictionary<ITradeCaptureReport>

  constructor (public readonly config: IJsFixConfig) {
    super(config)
    this.logReceivedMsgs = true
    this.reports = new Dictionary<ITradeCaptureReport>()
    this.fixLog = config.logFactory.plain(`jsfix.${config!.description!.application!.name}.txt`)
    this.logger = config.logFactory.logger(`${this.me}:TradeCaptureClient`)
  }

  protected onApplicationMsg (msgType: string, view: MsgView): void {
    this.logger.info(`${view.toJson()}`)
    switch (msgType) {
      case MsgType.TradeCaptureReport: {
        // create an object and cast to the interface
        const tc: ITradeCaptureReport = view.toObject()
        this.reports.addUpdate(tc.TradeReportID, tc)
        this.logger.info(`[reports: ${this.reports.count()}] received tc ExecID = ${tc.ExecID} TradeReportID  = ${tc.TradeReportID} Symbol = ${tc.Instrument.Symbol} ${tc.LastQty} @ ${tc.LastPx}`)
        break
      }

      case MsgType.TradeCaptureReportRequestAck: {
        const tc: ITradeCaptureReportRequestAck = view.toObject()
        this.logger.info(`received tcr ack ${tc.TradeRequestID} ${tc.TradeRequestStatus}`)
        break
      }
    }
  }

  protected onStopped (): void {
    this.logger.info('stopped')
  }

  // use msgType for example to persist only trade capture messages to database
  protected onDecoded (msgType: string, txt: string): void {
    this.fixLog.info(txt)
  }

  // no delimiter substitution on transmit messages
  protected onEncoded (msgType: string, txt: string): void {
    this.fixLog.info(AsciiSession.asPiped(txt))
  }

  protected onReady (view: MsgView): void {
    this.logger.info('ready')
    const tcr: ITradeCaptureReportRequest = TradeFactory.tradeCaptureReportRequest('all-trades', new Date())
    // send request to server
    this.send(MsgType.TradeCaptureReportRequest, tcr)
    const logoutSeconds = 32
    this.logger.info(`will logout after ${logoutSeconds}`)
    setTimeout(() => {
      this.done()
    }, logoutSeconds * 1000)
  }

  protected onLogon (view: MsgView, user: string, password: string): boolean {
    return true
  }
}
