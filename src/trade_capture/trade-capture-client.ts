import { TradeFactory } from './trade-factory'
import { IJsFixConfig, MsgView, AsciiSession, IJsFixLogger } from 'jspurefix'
import {
  ITradeCaptureReport, ITradeCaptureReportRequest,
  ITradeCaptureReportRequestAck, MsgType
} from 'jspurefix/dist/types/FIX4.4/repo'
import { ISecurityDefinition } from 'jspurefix/dist/types/FIX4.4/repo/security_definition'
import { ISecurityDefinitionRequest } from 'jspurefix/dist/types/FIX4.4/repo/security_definition_request'
import { SecurityRequestType } from 'jspurefix/dist/types/FIX4.4/repo/enum/all-enum'

export class TradeCaptureClient extends AsciiSession {
  private readonly logger: IJsFixLogger
  private readonly fixLog: IJsFixLogger
  private readonly reports: Map<string, ITradeCaptureReport>
  private readonly knownSecurities: string[] = []
  private receivedSecurityCount: number = 0
  private hasSentTradeRequest: boolean = false
  private logoutTimerHandle: NodeJS.Timeout | undefined

  constructor (public readonly config: IJsFixConfig) {
    super(config)
    this.logReceivedMsgs = true
    this.reports = new Map<string, ITradeCaptureReport>()
    this.fixLog = config.logFactory.plain(`jsfix.${config?.description?.application?.name}.txt`)
    this.logger = config.logFactory.logger(`${this.me}:TradeCaptureClient`)
  }

  protected onApplicationMsg (msgType: string, view: MsgView): void {
    this.logger.info(`${view.toJson()}`)
    switch (msgType) {
      case MsgType.SecurityDefinition: {
        const sd: ISecurityDefinition = view.toObject() as ISecurityDefinition
        const symbol = sd.Instrument?.Symbol ?? 'unknown'
        this.receivedSecurityCount++
        this.knownSecurities.push(symbol)
        this.logger.info(`[${this.receivedSecurityCount}] received security: ${symbol}`)
        // After receiving all securities, send trade capture request
        if (this.receivedSecurityCount >= 5 && !this.hasSentTradeRequest) {
          this.sendTradeRequest()
        }
        break
      }

      case MsgType.TradeCaptureReport: {
        const tc: ITradeCaptureReport = view.toObject() as ITradeCaptureReport
        this.reports.set(tc.TradeReportID, tc)
        this.logger.info(`[reports: ${this.reports.size}] received tc ExecID = ${tc.ExecID} TradeReportID  = ${tc.TradeReportID} Symbol = ${tc.Instrument.Symbol} ${tc.LastQty} @ ${tc.LastPx}`)
        break
      }

      case MsgType.TradeCaptureReportRequestAck: {
        const tc: ITradeCaptureReportRequestAck = view.toObject() as ITradeCaptureReportRequestAck
        this.logger.info(`received tcr ack ${tc.TradeRequestID} ${tc.TradeRequestStatus}`)
        break
      }
    }
  }

  protected onStopped (): void {
    this.logger.info('stopped')
    if (this.logoutTimerHandle) {
      clearTimeout(this.logoutTimerHandle)
      this.logoutTimerHandle = undefined
    }
  }

  // use msgType for example to persist only trade capture messages to database
  protected onDecoded (msgType: string, txt: string): void {
    this.fixLog.info(txt)
  }

  // delimiter substitution now done in encoding
  protected onEncoded (msgType: string, txt: string): void {
    this.fixLog.info(txt)
  }

  protected scheduleLogout (logoutSeconds: number = 32): void {
    // Guard: clear any existing logout timer from a previous session (reconnect scenario)
    if (this.logoutTimerHandle) {
      clearTimeout(this.logoutTimerHandle)
    }
    this.logoutTimerHandle = setTimeout(() => {
      this.done()
    }, logoutSeconds * 1000)
  }

  protected onReady (view: MsgView): void {
    // Reset all application state on each new session (handles reconnect)
    this.reports.clear()
    this.knownSecurities.length = 0
    this.receivedSecurityCount = 0
    this.hasSentTradeRequest = false
    this.logger.info('ready')
    // First request security definitions — trade request follows once 5 securities received
    this.sendSecurityDefinitionRequest()
  }

  private sendSecurityDefinitionRequest (): void {
    const sdr: Partial<ISecurityDefinitionRequest> = {
      SecurityReqID: 'sec-req-1',
      SecurityRequestType: SecurityRequestType.RequestListSecurities
    }
    this.logger.info('sending SecurityDefinitionRequest')
    this.send(MsgType.SecurityDefinitionRequest, sdr)
  }

  private sendTradeRequest (): void {
    if (this.hasSentTradeRequest) {
      this.logger.info('trade request already sent, skipping')
      return
    }
    this.hasSentTradeRequest = true
    const tcr: Partial<ITradeCaptureReportRequest> = TradeFactory.tradeCaptureReportRequest('all-trades', new Date())
    this.send(MsgType.TradeCaptureReportRequest, tcr)
    const logoutSeconds = 32
    this.logger.info(`will logout after ${logoutSeconds}`)
    this.scheduleLogout(logoutSeconds)
  }

  protected onLogon (view: MsgView, user: string, password: string): boolean {
    this.logger.info(`onLogon user ${user}`)
    return true
  }
}
