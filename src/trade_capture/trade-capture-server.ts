import { IJsFixLogger, AsciiSession, IJsFixConfig, MsgView } from 'jspurefix'

import {
  ITradeCaptureReport,
  ITradeCaptureReportRequest,
  MsgTag,
  MsgType, SessionRejectReason,
  SubscriptionRequestType, TradeRequestStatus
} from 'jspurefix/dist/types/FIX4.4/repo'
import { TradeFactory } from './trade-factory'

export class TradeCaptureServer extends AsciiSession {
  private readonly logger: IJsFixLogger
  private readonly fixLog: IJsFixLogger
  private readonly tradeFactory: TradeFactory = new TradeFactory()
  private timerHandle: NodeJS.Timeout

  constructor (public readonly config: IJsFixConfig) {
    super(config)
    this.logReceivedMsgs = true
    this.logger = config.logFactory.logger(`${this.me}:TradeCaptureServer`)
    this.fixLog = config.logFactory.plain(`jsfix.${config?.description?.application?.name}.txt`)
  }

  protected onApplicationMsg (msgType: string, view: MsgView): void {
    this.logger.info(`${view.toJson()}`)
    switch (msgType) {
      case MsgType.TradeCaptureReportRequest: {
        this.tradeCaptureReportRequest(view.toObject() as ITradeCaptureReportRequest)
        break
      }

      default: {
        const seqNum = view.getTyped(MsgTag.MsgSeqNum) as number
        const msg: string = `${this.me}: unexpected msg type '${msgType}'`
        const fact = this.config.factory
        if (fact != null) {
          this.send(msgType, fact.reject(msgType, seqNum, msg, SessionRejectReason.InvalidMsgType))
        }
        break
      }
    }
  }

  protected onReady (view: MsgView): void {
    // server waits for client to make a request
    this.logger.info('ready for requests.')
  }

  protected onStopped (): void {
    this.logger.info('stopped')
    if (this.timerHandle) {
      clearInterval(this.timerHandle)
    }
  }

  protected onLogon (view: MsgView, user: string, password: string): boolean {
    return true
  }

  // use msgType for example to persist only trade capture messages to database
  protected onDecoded (msgType: string, txt: string): void {
    this.fixLog.info(txt)
  }

  // delimiter substitution now done in encoding
  protected onEncoded (msgType: string, txt: string): void {
    this.fixLog.info(txt)
  }

  private tradeCaptureReportRequest (tcr: ITradeCaptureReportRequest): void {
    this.logger.info(`received tcr ${tcr.TradeRequestID}`)
    // send back an ack.
    this.send(MsgType.TradeCaptureReportRequestAck, TradeFactory.tradeCaptureReportRequestAck(tcr, TradeRequestStatus.Accepted))
    // send some trades
    const batch: Array<Partial<ITradeCaptureReport>> = this.tradeFactory.batchOfTradeCaptureReport(5)
    batch.forEach((tc: ITradeCaptureReport) => {
      this.send(MsgType.TradeCaptureReport, tc)
    })
    this.send(MsgType.TradeCaptureReportRequestAck, TradeFactory.tradeCaptureReportRequestAck(tcr, TradeRequestStatus.Completed))
    // start sending the odd 'live' trade
    switch (tcr.SubscriptionRequestType) {
      case SubscriptionRequestType.SnapshotAndUpdates: {
        this.timerHandle = setInterval(() => {
          if (Math.random() < 0.4) {
            const tc: Partial<ITradeCaptureReport> = this.tradeFactory.singleTradeCaptureReport()
            this.send(MsgType.TradeCaptureReport, tc)
          }
        }, 5000)
        break
      }
    }
  }
}
