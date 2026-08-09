import { AsciiSession, IJsFixConfig, IJsFixLogger, MsgView } from 'jspurefix'

/**
 * The smallest thing that is still a FIX session: log on, answer the session layer,
 * hold the connection up with heartbeats, send nothing of your own.  Both roles run
 * this same class - there is nothing role specific left once the application layer
 * is gone.
 *
 * Two uses:
 *
 *  - a baseline.  Whatever a run costs in allocation, timers and sockets with no
 *    application messages at all is the engine's own overhead.  Compare a skeleton
 *    run against `reset` (see --heap-every) and the difference is your application.
 *  - a starting point.  Point the initiator at a broker's UAT endpoint and this is
 *    the first thing you want running: does it log on, does it stay up overnight,
 *    does it recover the connection.  Add message handling once that is true.
 */
export class SkeletonSession extends AsciiSession {
  /** set from --disconnect-after, honoured by the initiator only */
  public static disconnectAfterSeconds: number | undefined
  /** cleared by --no-fix-log, for a run that touches no disk */
  public static writeFixLog: boolean = true

  private readonly logger: IJsFixLogger
  private readonly fixLog: IJsFixLogger | null
  private readonly role: string
  private ignoredAppMsgs: number = 0
  private hasScheduledDisconnect: boolean = false

  constructor (public readonly config: IJsFixConfig) {
    super(config)
    // nothing below reads an application message, so do not pay to render one
    this.logReceivedMsgs = false
    this.role = config.description.application?.type === 'initiator' ? 'client' : 'server'
    this.logger = config.logFactory.logger(`${this.me}:Skeleton`)
    this.fixLog = SkeletonSession.writeFixLog
      ? config.logFactory.plain(`jsfix.${config?.description?.application?.name}.txt`)
      : null
  }

  /**
   * A skeleton run against the demo's own acceptor never gets here - neither side
   * sends anything.  Against a real counterparty it will, and the only sane answer
   * is to say what arrived and drop it: acting on a message is the application, and
   * the point of the mode is that there isn't one.
   */
  protected onApplicationMsg (msgType: string, _view: MsgView): void {
    if (++this.ignoredAppMsgs === 1) {
      this.logger.info(`ignoring application messages - first was '${msgType}'`)
    }
  }

  protected onReady (_view: MsgView): void {
    this.logger.info(`[${this.role}] session ready - heartbeat only, HeartBtInt ${this.config.description.HeartBtInt}s`)
    this.scheduleDisconnect()
  }

  protected onLogon (_view: MsgView, user: string, _password: string): boolean {
    this.logger.info(`[${this.role}] logon accepted from user '${user}'`)
    return true
  }

  protected onStopped (): void {
    const ignored = this.ignoredAppMsgs > 0 ? `, ignored ${this.ignoredAppMsgs} application messages` : ''
    this.logger.info(`[${this.role}] session stopped${ignored}`)
  }

  protected onDecoded (_msgType: string, txt: string): void {
    this.fixLog?.info(txt)
  }

  protected onEncoded (_msgType: string, txt: string): void {
    this.fixLog?.info(txt)
  }

  /**
   * Drop the connection once, so the reconnect path gets exercised without a second
   * process to kill.  Guarded because onReady runs again on every reconnect - the
   * session instance survives, which is the behaviour being demonstrated.
   */
  private scheduleDisconnect (): void {
    const after = SkeletonSession.disconnectAfterSeconds
    if (after == null || this.role !== 'client' || this.hasScheduledDisconnect) return
    this.hasScheduledDisconnect = true
    this.logger.info(`will disconnect after ${after}s for reconnect testing`)
    setTimeout(() => {
      this.logger.info('triggering scheduled disconnect')
      this.stop()
    }, after * 1000)
  }
}
