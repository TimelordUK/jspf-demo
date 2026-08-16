import { JsFixLoggerFactory, JsFixWinstonLogFactory, WinstonLogger } from 'jspurefix'

/**
 * Choosing how the engine's logs are rendered.
 *
 * Every log line jspurefix writes carries two things beyond its message: *context*
 * bound when the logger was made (which component, which application, which
 * counterparty) and *fields* supplied per call (a sequence number, a msgType, a byte
 * count).  Neither is formatted into the message.  What a run actually emits is
 * therefore a choice made here, once, and nothing in the session code changes with it.
 *
 *   consoleOptions   the format jspurefix has emitted since it shipped.  It names four
 *                    fields - timestamp, logger name, level, message - so the context
 *                    and fields are simply not rendered.  Anything you already grep
 *                    for still matches.
 *
 *   ecsOptions       one JSON object per line, Elastic Common Schema names, engine
 *                    specific values under fix.*.  This is what Filebeat harvests.
 *
 * That is the whole integration.  There is no shipper, no agent and no endpoint in the
 * engine: Filebeat is a *push* pipeline, so structured stdout is the entire contract.
 *
 * ecsFileOptions(path) writes the same JSON to a file instead, which is what you want
 * under a process manager that does not capture stdout.
 */
export function makeLogFactory (jsonLogs: boolean): JsFixLoggerFactory {
  return new JsFixWinstonLogFactory(
    jsonLogs
      ? WinstonLogger.ecsOptions('info')
      : WinstonLogger.consoleOptions('info'))
}

/**
 * What the run is about to emit, and what to do with it.  Printed rather than left in a
 * readme because the fields are only obvious once they are in front of you.
 */
export function describeJsonLogs (): void {
  console.log('')
  console.log('  structured logs')
  console.log('  ───────────────')
  console.log('  every line below is one JSON object.  The engine binds context to each of its')
  console.log('  loggers, so a field like fix.component is on every line that logger writes -')
  console.log('  no session code had to pass it.')
  console.log('')
  console.log('  fields worth filtering on:')
  console.log('    fix.component   FixSession, TcpAcceptor, TcpInitiator, SkeletonSession ...')
  console.log('    fix.app         the application name from the session description')
  console.log('    fix.peer        the counterparty, once a wildcard acceptor has bound one')
  console.log('    fix.role        initiator or acceptor')
  console.log('    fix.event       set by this demo on the lines worth counting')
  console.log('    log.level       info, warn, error')
  console.log('')
  console.log('  try it without an Elastic stack:')
  console.log('    npm run skeleton:json | grep FixSession')
  console.log("    npm run skeleton:json | jq -c 'select(.\"fix.event\") | {t:.\"@timestamp\", e:.\"fix.event\"}'")
  console.log('')
  console.log('  and with one - the shipper needs no parsing rules, the lines are already')
  console.log('  objects:')
  console.log('')
  console.log('    filebeat.inputs:')
  console.log('      - type: filestream')
  console.log('        paths: [ /var/log/myapp/fix.ndjson ]')
  console.log('        parsers:')
  console.log('          - ndjson:')
  console.log('              target: ""')
  console.log('              overwrite_keys: true')
  console.log('')
  console.log('  to write that file rather than stdout, swap ecsOptions for')
  console.log('  ecsFileOptions(path) in logging.ts.')
  console.log('')
}
