# jspf-demo

[![Build status](https://ci.appveyor.com/api/projects/status/tae83lmapp30pgku?svg=true)](https://ci.appveyor.com/project/TimelordUK/jspf-demo)

Reference application for [jspurefix](https://github.com/TimelordUK/jspurefix) — demonstrates a FIX 4.4 trade capture client and server with session resilience, persistent message stores, and reconnection support.

This demo is the TypeScript equivalent of the C# [purefix-standalone-demo](https://github.com/TimelordUK/purefix-standalone-demo), built up incrementally and used for smoke and soak testing.

## Quick start

```bash
npm install
npm run build
npm run tcp-tc          # run client + server in-process (default)
```

## What it does

1. **Client** connects to **server** over TCP on localhost
2. Client sends a `SecurityDefinitionRequest` for all securities
3. Server responds with 5 `SecurityDefinition` messages (Gold, Silver, Platinum, Magnesium, Steel)
4. After receiving all 5, client sends a `TradeCaptureReportRequest` (all trades, snapshot + updates)
5. Server responds with `TradeCaptureReportRequestAck` (Accepted), 5 snapshot trades, then `TradeCaptureReportRequestAck` (Completed)
6. Server starts an unsolicited trade timer — sends random trades every 5 seconds
7. Client logs each trade received (ExecID, Symbol, Qty, Price)

## Session modes

The demo supports three session modes that control store type and sequence reset behaviour:

| Mode | Store | ResetSeqNumFlag | Port | Description |
|------|-------|-----------------|------|-------------|
| `reset` (default) | memory | Y (both) | 2344 | Sequences reset on every logon. Stateless. |
| `recovery` | file | N (both) | 2345 | Sequences persist across restarts. Resume where left off. |
| `broker-reset` | file | server=Y, client=N | 2346 | Server forces reset (simulates daily broker reset). Client wants resume but respects server reset. |

```bash
npm run tcp-tc              # reset mode (default)
npm run recovery            # recovery mode (file store)
npm run broker-reset        # broker-reset mode
```

In recovery and broker-reset modes, a QuickFix-compatible file store is created under `store/` with `.seqnums`, `.body`, and `.header` files.

## CLI options

```
Usage: jspf-demo [options] [mode]

Arguments:
  mode                          session mode: reset (default), recovery, broker-reset

Options:
  --client                      run initiator (client) only
  --server                      run acceptor (server) only
  --timeout <seconds>           shutdown after N seconds
  --disconnect-after <seconds>  disconnect client after N seconds (reconnect testing)
  -h, --help                    display help for command
```

### Examples

```bash
# Run server and client in separate terminals
npm run recovery:server                  # terminal 1
npm run recovery:client                  # terminal 2

# Auto-shutdown after 10 seconds
node dist/trade_capture/app.js recovery --timeout 10

# Disconnect client after 5s to test reconnection
node dist/trade_capture/app.js --disconnect-after 5

# Server-only with timeout
node dist/trade_capture/app.js recovery --server --timeout 30
```

## Session resilience

The demo incorporates fixes from extended soak testing (17-day continuous run on the C# equivalent):

- **Timer cleanup on disconnect** — unsolicited trade timers are tracked and cleared in both `onReady()` and `onStopped()`, preventing duplicate timers after reconnect
- **State reset on reconnect** — all application state (trade reports, security counts, guard flags) is explicitly reset in `onReady()` so reconnects start clean
- **Duplicate request guard** — `hasSentTradeRequest` flag prevents the client from sending the trade capture request twice on reconnect
- **Logout timer guard** — logout timeout is tracked and cleared before scheduling a new one

## Project structure

```
src/trade_capture/
  app.ts                    — entry point, CLI dispatch, launcher
  cli.ts                    — commander-based CLI option parsing
  trade-capture-client.ts   — FIX initiator session handler
  trade-capture-server.ts   — FIX acceptor session handler
  trade-factory.ts          — synthetic trade data generator

data/session/
  test-initiator.json       — reset mode client config
  test-acceptor.json        — reset mode server config
  recovery-*.json           — recovery mode configs (file store, no reset)
  broker-reset-*.json       — broker-reset mode configs (server forces reset)
```

## Parsing FIX logs

After running the demo, raw FIX messages are logged to `jsfix.test_client.txt` and `jsfix.test_server.txt`. Use the jspurefix CLI to inspect them:

```bash
# Show trade capture reports as objects
npm run parse-client-trade-captures

# Show all messages as tokenised output
npm run parse-client-tokens
```

## Related

- [jspurefix](https://github.com/TimelordUK/jspurefix) — the FIX protocol engine this demo uses
- [jspf-md-demo](https://github.com/TimelordUK/jspf-md-demo) — market data request/snapshot demo
- [jspf-cserver](https://github.com/TimelordUK/jspf-cserver) — custom dictionary example
