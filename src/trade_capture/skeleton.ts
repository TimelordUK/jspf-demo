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
  /** set from --drop-after, honoured by the acceptor only */
  public static dropClientAfterSeconds: number | undefined
  /** the drop happens once per run, not to every session the acceptor goes on to take */
  private static hasDropped: boolean = false
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
    // context bound once, repeated on every line this logger writes.  Nothing below
    // has to pass it again, and with --json-logs it arrives as fix.component,
    // fix.app and fix.role rather than as text inside the message
    this.logger = config.logFactory.logger(`${this.me}:Skeleton`, {
      component: 'SkeletonSession',
      app: this.me,
      role: this.role
    })
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
  /*
   * The four handlers below carry per call fields as well.
   *
   * Note that the messages are unchanged - the prose still says everything it said
   * before, and the fields repeat some of it.  That duplication is deliberate.  A
   * person reading a terminal wants a sentence; a query wants a number it does not
   * have to parse out of one.  Writing the sentence to suit the query gives you
   * neither, and moving a value out of the message breaks whatever was grepping for
   * it.
   *
   * `event` is the field to reach for first: a stable name for a line whose wording
   * you may want to improve later without breaking a dashboard built on it.
   */

  protected onApplicationMsg (msgType: string, _view: MsgView): void {
    if (++this.ignoredAppMsgs === 1) {
      this.logger.info(`ignoring application messages - first was '${msgType}'`,
        { event: 'app_msg_ignored', msg_type: msgType })
    }
  }

  protected onReady (_view: MsgView): void {
    const heartBtInt = this.config.description.HeartBtInt
    this.logger.info(`[${this.role}] session ready - heartbeat only, HeartBtInt ${heartBtInt}s`,
      { event: 'session_ready', heart_bt_int: heartBtInt })
    this.scheduleDisconnect()
  }

  protected onLogon (_view: MsgView, user: string, _password: string): boolean {
    this.logger.info(`[${this.role}] logon accepted from user '${user}'`,
      { event: 'logon_accepted', user })
    return true
  }

  protected onStopped (): void {
    const ignored = this.ignoredAppMsgs > 0 ? `, ignored ${this.ignoredAppMsgs} application messages` : ''
    this.logger.info(`[${this.role}] session stopped${ignored}`,
      { event: 'session_stopped', ignored_app_msgs: this.ignoredAppMsgs })
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
   *
   * Which side does it matters, and the two are not interchangeable:
   *
   *  --disconnect-after  the client stops its own session.  A deliberate stop is not
   *                      a lost transport, so a resilient initiator does not recover
   *                      from it - the run ends, which is correct.
   *  --drop-after        the acceptor drops the client.  Now the initiator's transport
   *                      fails underneath it, which is what recovery is for.
   */
  private scheduleDisconnect (): void {
    if (this.role === 'client') {
      this.scheduleStop(SkeletonSession.disconnectAfterSeconds,
        'will disconnect after', 'triggering scheduled disconnect')
      return
    }
    // one drop per run - otherwise every session the acceptor takes on reconnect
    // schedules another, and the client never gets to stay up
    if (SkeletonSession.hasDropped) return
    const after = SkeletonSession.dropClientAfterSeconds
    if (after == null) return
    SkeletonSession.hasDropped = true
    this.scheduleStop(after, 'will drop the client after',
      'dropping the client - a resilient initiator should get itself back')
  }

  private scheduleStop (after: number | undefined, announce: string, act: string): void {
    if (after == null || this.hasScheduledDisconnect) return
    this.hasScheduledDisconnect = true
    this.logger.info(`[${this.role}] ${announce} ${after}s`,
      { event: 'stop_scheduled', after_seconds: after })
    setTimeout(() => {
      this.logger.info(`[${this.role}] ${act}`, { event: 'stop_triggered' })
      this.stop()
    }, after * 1000)
  }
}
