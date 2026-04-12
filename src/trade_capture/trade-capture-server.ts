import { IJsFixLogger, AsciiSession, IJsFixConfig, MsgView } from 'jspurefix'

import {
  ITradeCaptureReport,
  ITradeCaptureReportRequest,
  MsgTag,
  MsgType, SessionRejectReason,
  SubscriptionRequestType, TradeRequestStatus
} from 'jspurefix/dist/types/FIX4.4/repo'
import { ISecurityDefinitionRequest } from 'jspurefix/dist/types/FIX4.4/repo/security_definition_request'
import { SecurityResponseType } from 'jspurefix/dist/types/FIX4.4/repo/enum/all-enum'
import { TradeFactory } from './trade-factory'

export class TradeCaptureServer extends AsciiSession {
  private readonly logger: IJsFixLogger
  private readonly fixLog: IJsFixLogger
  private readonly tradeFactory: TradeFactory = new TradeFactory()
  private timerHandle: NodeJS.Timeout | undefined

  constructor (public readonly config: IJsFixConfig) {
    super(config)
    this.logReceivedMsgs = true
    this.logger = config.logFactory.logger(`${this.me}:TradeCaptureServer`)
    this.fixLog = config.logFactory.plain(`jsfix.${config?.description?.application?.name}.txt`)
  }

  protected onApplicationMsg (msgType: string, view: MsgView): void {
    this.logger.info(`${view.toJson()}`)
    switch (msgType) {
      case MsgType.SecurityDefinitionRequest: {
        this.securityDefinitionRequest(view.toObject() as ISecurityDefinitionRequest)
        break
      }

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
    // Reset any running timer from a previous session (reconnect scenario).
    // Without this, a reconnect starts a second timer while the old one keeps firing.
    this.stopUnsolicitedTradeTimer()
    this.logger.info('ready for requests.')
  }

  protected onStopped (): void {
    this.logger.info('stopped')
    this.stopUnsolicitedTradeTimer()
  }

  private stopUnsolicitedTradeTimer (): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle)
      this.timerHandle = undefined
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

  private securityDefinitionRequest (sdr: ISecurityDefinitionRequest): void {
    this.logger.info(`received security definition request ${sdr.SecurityReqID}`)
    const securities = this.tradeFactory.securities
    let responseId = 1
    for (const symbol of securities) {
      this.send(MsgType.SecurityDefinition, {
        SecurityReqID: sdr.SecurityReqID,
        SecurityResponseID: `sec-resp-${responseId++}`,
        SecurityResponseType: SecurityResponseType.AcceptAsIs,
        Instrument: {
          Symbol: symbol,
          SecurityID: `${symbol}.INC`
        },
        Currency: 'USD'
      })
    }
    this.logger.info(`sent ${securities.length} security definitions`)
  }

  private tradeCaptureReportRequest (tcr: ITradeCaptureReportRequest): void {
    this.logger.info(`received tcr ${tcr.TradeRequestID}`)
    // send back an ack.
    this.send(MsgType.TradeCaptureReportRequestAck, TradeFactory.tradeCaptureReportRequestAck(tcr, TradeRequestStatus.Accepted))
    // send some trades
    const batch: Array<Partial<ITradeCaptureReport>> = this.tradeFactory.batchOfTradeCaptureReport(5)
    batch.forEach((tc: Partial<ITradeCaptureReport>) => {
      this.send(MsgType.TradeCaptureReport, tc)
    })
    this.send(MsgType.TradeCaptureReportRequestAck, TradeFactory.tradeCaptureReportRequestAck(tcr, TradeRequestStatus.Completed))
    // start sending the odd 'live' trade
    switch (tcr.SubscriptionRequestType) {
      case SubscriptionRequestType.SnapshotAndUpdates: {
        // Defensive: stop any existing timer before starting a new one
        this.stopUnsolicitedTradeTimer()
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
