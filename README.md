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
| `multi-client` | file | N (both) | 2345 | Acceptor runs `TargetCompID: "*"`. Several clients share one listener, each with its own identity and store. |
| `dynamic` | file | N (both) | 2347 | Same wildcard acceptor, but the counterparties are unrelated names it has never been configured with — including one that joins after startup. |
| `clear` | — | — | — | Delete every store directory and exit. |

```bash
npm run tcp-tc              # reset mode (default)
npm run recovery            # recovery mode (file store)
npm run broker-reset        # broker-reset mode
npm run multi-client        # three clients against one wildcard acceptor
npm run dynamic             # counterparties the venue has never heard of
npm run clear               # wipe the stores
```

In recovery and broker-reset modes, a QuickFix-compatible file store is created under `store/` with `.seqnums`, `.body`, and `.header` files.

## CLI options

```
Usage: jspf-demo [options] [mode]

Arguments:
  mode                          session mode: reset, recovery, broker-reset, multi-client, dynamic, clear

Options:
  --client                      run initiator (client) only
  --server                      run acceptor (server) only
  --clients <n>                 number of clients to spawn, 1-5 (multi-client acceptor testing)
  --store <dir>                 override the store directory from the session config
  --counterparties <names>      dynamic mode: comma separated SenderCompIds to connect
  --late-join-after <seconds>   dynamic mode: seconds before an unseen counterparty joins (0 disables)
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

# Three clients against one wildcard acceptor
node dist/trade_capture/app.js multi-client --clients 3 --timeout 25
```

## Dynamic acceptor — counterparties known only at logon

`dynamic` mode is the one to run if you want to see what `TargetCompID: "*"` buys
you. The acceptor is configured as a venue and nothing else:

```json
{
  "SenderCompId": "venue",
  "TargetCompID": "*"
}
```

No counterparty appears anywhere in its configuration. Four then connect — three at
startup, and `prop-desk-d` eight seconds later, with no restart and no config
change:

```
wildcard acceptor: binding session identity to peer SenderCompID 'hedge-fund-a'
accepted counterparty 'hedge-fund-a' (user js-client) - session is now venue -> hedge-fund-a
...
  >>> previously unseen counterparty 'prop-desk-d' is connecting now
wildcard acceptor: binding session identity to peer SenderCompID 'prop-desk-d'
```

and the venue ends the run holding one persisted session per counterparty it met:

```
  the venue now holds a session store per counterparty it met:
    FIX4.4-venue-hedge-fund-a.seqnums     [15 : 4]
    FIX4.4-venue-market-maker-b.seqnums   [16 : 4]
    FIX4.4-venue-prop-desk-d.seqnums      [15 : 4]
    FIX4.4-venue-retail-broker-c.seqnums  [14 : 4]

  none of those names appear anywhere in the acceptor configuration.
```

Each of those is a full FIX session: its own sequence numbers, its own resend
history, recovered independently on reconnect. That is the difference between a
wildcard that only fixes the outbound header and one that binds a real identity —
the acceptor defers building its `SessionId` and store until the Logon tells it who
the peer is.

Bring your own names:

```bash
node dist/trade_capture/app.js dynamic --counterparties acme-capital,zeta-trading
node dist/trade_capture/app.js dynamic --late-join-after 0     # disable the late joiner
```

Note the demo's `onLogon` does nothing but log. There is no `addCompIdMapping` call
and no per-counterparty wiring — adopting the identity is the engine's job.

## Multiple clients on one acceptor

`multi-client` mode is the reference setup for an acceptor serving several
counterparties. The acceptor config sets `"TargetCompID": "*"`, so it does not have
to know its counterparties in advance — each accepted connection adopts the
`SenderCompID` from that client's Logon, and from it derives:

- its own `SessionId`, and therefore its own store files under `store/multi-acceptor/`
- its own entry in the engine's session registry
- its own log prefix, e.g. `[test_server:init-comp_2:FixSession]`

Each spawned client gets a `_1.._n` suffix on its `SenderCompId` so the acceptor
sees genuinely distinct counterparties. The server log carries a census line
whenever the population changes:

```
[acceptor] info: acceptor census: transports=3 [1@::1:55641 up 1s, 2@::1:55642 up 0s, 3@::1:55643 up 0s]
                 sessions=2 [FIX4.4-accept-comp-init-comp_1, FIX4.4-accept-comp-init-comp_2]
```

If the same counterparty reconnects while its previous socket is still open — the
half-open socket case in
[jspurefix#153](https://github.com/TimelordUK/jspurefix/issues/153) — the registry
stops the stale session so only one remains per CompID pair.

## Test scenarios

`scripts/test-scenarios.sh` drives the demo through the recovery cases that matter,
asserting on the persisted sequence files afterwards.

```bash
./scripts/test-scenarios.sh client-bounce      # client restarts, server keeps running
./scripts/test-scenarios.sh server-bounce      # server restarts, both recover from store
./scripts/test-scenarios.sh broker-reset       # server forces ResetSeqNumFlag=Y
./scripts/test-scenarios.sh multi-client       # 3 clients, 3 identities, 3 stores
./scripts/test-scenarios.sh dynamic            # unknown counterparties adopted at logon
./scripts/test-scenarios.sh stale-transport    # half-open socket reconnect (jspurefix#153)
./scripts/test-scenarios.sh all
```

All six pass. If you are adding a scenario, note `run_quiet_bg` publishes the pid in
`BG_PID` rather than echoing it — assigning it via command substitution runs the
function in a subshell, so `$!` is a pid the calling shell does not own and `wait`
on it fails instantly instead of blocking.

`stale-transport` uses `scripts/stale-transport.js`, which plays the counterparty
directly over a raw socket: it logs on, then stops participating without ever
closing. Killing a process would not reproduce this — the kernel still closes its
file descriptors — so the script holds the socket open itself.

## Working against an unpublished jspurefix

To test engine changes without publishing to npm:

```bash
cd ../jspurefix && npm run pack:local   # builds and packs to ../.local-packages
cd ../jspf-demo && npm run use:local    # install that tarball
npm run use:npm                         # go back to the registry version
```

A tarball rather than `npm link` on purpose: a symlinked dependency loads its own
copy of `reflect-metadata` and `tsyringe`, and two decorator metadata registries
means tsyringe silently fails to resolve anything registered through the other one.

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
  multi-client-*.json       — multi-client configs (acceptor uses TargetCompID "*")
  dynamic-*.json            — dynamic acceptor configs (venue + unknown counterparties)

scripts/
  test-scenarios.sh         — recovery and multi-client scenario runner
  stale-transport.js        — raw-socket counterparty for the half-open reconnect case
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
