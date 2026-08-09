#!/bin/bash
#
# jspf-demo Test Scenarios
# Usage: ./scripts/test-scenarios.sh [client-bounce|server-bounce|broker-reset|multi-client|dynamic|stale-transport|skeleton|all]
#

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

APP="node dist/trade_capture/app.js"
STORE_DIR="store"
SHORT_TIMEOUT=5
LONG_TIMEOUT=10

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'

print_banner()  { echo -e "\n${MAGENTA}══ $1 ══${NC}"; }
print_header()  { echo -e "\n${CYAN}── $1${NC}"; }
print_step()    { echo -e "${YELLOW}>>> $1${NC}"; }
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error()   { echo -e "${RED}✗ $1${NC}"; }
print_info()    { echo -e "${BLUE}  $1${NC}"; }

run_quiet() { "$@" > /dev/null 2>&1; }
# Start a background job and publish its pid in BG_PID.
#
# Deliberately not assigned via command substitution: that runs the function
# in a subshell, so $! is a pid the calling shell does not own.  `wait` on it fails
# immediately with "not a child of this shell" - which silently turned every
# "wait for the server to finish" into a no-op, and left servers running that the
# next step then tried to start a second copy of on the same port.
run_quiet_bg() { "$@" > /dev/null 2>&1 & BG_PID=$!; }

CLIENT_SEQNUMS="$STORE_DIR/initiator/FIX4.4-init-comp-accept-comp.seqnums"
SERVER_SEQNUMS="$STORE_DIR/acceptor/FIX4.4-accept-comp-init-comp.seqnums"
BROKER_CLIENT_SEQNUMS="$STORE_DIR/broker-initiator/FIX4.4-init-comp-accept-comp.seqnums"
BROKER_SERVER_SEQNUMS="$STORE_DIR/broker-acceptor/FIX4.4-accept-comp-init-comp.seqnums"
MULTI_CLIENT_STORE="$STORE_DIR/multi-initiator"
MULTI_SERVER_STORE="$STORE_DIR/multi-acceptor"
DYNAMIC_SERVER_STORE="$STORE_DIR/dynamic-acceptor"

get_sender_seq() { [ -f "$1" ] && awk -F':' '{print $1}' "$1" | tr -d ' ' || echo "0"; }

show_seqnums() {
    local label="$1" cfile="$2" sfile="$3"
    print_step "$label"
    [ -f "$cfile" ] && echo "  Client: $(cat "$cfile")" || echo "  Client: (no store)"
    [ -f "$sfile" ] && echo "  Server: $(cat "$sfile")" || echo "  Server: (no store)"
}

clean_dir() {
    rm -rf "$@"
    mkdir -p "$@"
}

# ─────────────────────────────────────────────────────────────────────────────
test_client_bounce() {
    print_banner "SCENARIO: Client Bounce Recovery"
    echo "Server keeps running while client disconnects and reconnects."

    print_header "STEP 1: Clean Start"
    clean_dir "$STORE_DIR/initiator" "$STORE_DIR/acceptor"
    print_success "Store cleaned"

    print_header "STEP 2: Start Server (long running)"
    run_quiet_bg $APP recovery --server --timeout $((LONG_TIMEOUT * 3)); SERVER_PID=$BG_PID
    sleep 2

    print_header "STEP 3: First Client Session (${SHORT_TIMEOUT}s)"
    run_quiet $APP recovery --client --timeout $SHORT_TIMEOUT

    print_header "STEP 4: State After Client Exit"
    show_seqnums "Persisted sequences" "$CLIENT_SEQNUMS" "$SERVER_SEQNUMS"
    INITIAL_CLIENT=$(get_sender_seq "$CLIENT_SEQNUMS")
    INITIAL_SERVER=$(get_sender_seq "$SERVER_SEQNUMS")
    print_info "Client sender: $INITIAL_CLIENT, Server sender: $INITIAL_SERVER"

    print_header "STEP 5: Client Downtime (3s)"
    sleep 3

    print_header "STEP 6: Reconnect Client"
    run_quiet $APP recovery --client --timeout $SHORT_TIMEOUT

    print_step "Stopping server..."
    kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null || true

    print_header "STEP 7: Verify Recovery"
    show_seqnums "Final sequences" "$CLIENT_SEQNUMS" "$SERVER_SEQNUMS"
    FINAL_CLIENT=$(get_sender_seq "$CLIENT_SEQNUMS")
    FINAL_SERVER=$(get_sender_seq "$SERVER_SEQNUMS")

    print_header "RESULT"
    if [ "$FINAL_CLIENT" -gt "$INITIAL_CLIENT" ] 2>/dev/null && \
       [ "$FINAL_SERVER" -gt "$INITIAL_SERVER" ] 2>/dev/null; then
        print_success "Client reconnected and session resumed"
        echo "  Client sender: $INITIAL_CLIENT -> $FINAL_CLIENT"
        echo "  Server sender: $INITIAL_SERVER -> $FINAL_SERVER"
        return 0
    else
        print_error "Sequences did not progress"
        echo "  Client sender: $INITIAL_CLIENT -> $FINAL_CLIENT"
        echo "  Server sender: $INITIAL_SERVER -> $FINAL_SERVER"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
test_server_bounce() {
    print_banner "SCENARIO: Server Bounce Recovery"
    echo "Server stops and restarts. Both sides recover from file store."

    print_header "STEP 1: Clean Start"
    clean_dir "$STORE_DIR/initiator" "$STORE_DIR/acceptor"
    print_success "Store cleaned"

    print_header "STEP 2: Initial Session (server runs ${LONG_TIMEOUT}s)"
    run_quiet_bg $APP recovery --server --timeout $LONG_TIMEOUT; SERVER_PID=$BG_PID
    sleep 2
    run_quiet_bg $APP recovery --client --timeout $((LONG_TIMEOUT + 5)); CLIENT_PID=$BG_PID

    print_info "Waiting for server to timeout..."
    wait $SERVER_PID 2>/dev/null || true
    sleep 2
    kill $CLIENT_PID 2>/dev/null; wait $CLIENT_PID 2>/dev/null || true

    print_header "STEP 3: State After Server Bounce"
    show_seqnums "Persisted sequences" "$CLIENT_SEQNUMS" "$SERVER_SEQNUMS"
    INITIAL_CLIENT=$(get_sender_seq "$CLIENT_SEQNUMS")
    INITIAL_SERVER=$(get_sender_seq "$SERVER_SEQNUMS")
    print_info "Client sender: $INITIAL_CLIENT, Server sender: $INITIAL_SERVER"

    print_header "STEP 4: Downtime (3s)"
    sleep 3

    print_header "STEP 5: Restart Both"
    run_quiet_bg $APP recovery --server --timeout $LONG_TIMEOUT; SERVER_PID=$BG_PID
    sleep 2
    run_quiet_bg $APP recovery --client --timeout $SHORT_TIMEOUT; CLIENT_PID=$BG_PID

    wait $SERVER_PID 2>/dev/null || true
    wait $CLIENT_PID 2>/dev/null || true

    print_header "STEP 6: Verify Recovery"
    show_seqnums "Final sequences" "$CLIENT_SEQNUMS" "$SERVER_SEQNUMS"
    FINAL_CLIENT=$(get_sender_seq "$CLIENT_SEQNUMS")
    FINAL_SERVER=$(get_sender_seq "$SERVER_SEQNUMS")

    print_header "RESULT"
    if [ "$FINAL_CLIENT" -gt "$INITIAL_CLIENT" ] 2>/dev/null && \
       [ "$FINAL_SERVER" -gt "$INITIAL_SERVER" ] 2>/dev/null; then
        print_success "Both sides recovered from file store"
        echo "  Client sender: $INITIAL_CLIENT -> $FINAL_CLIENT"
        echo "  Server sender: $INITIAL_SERVER -> $FINAL_SERVER"
        return 0
    else
        print_error "Sequences did not progress"
        echo "  Client sender: $INITIAL_CLIENT -> $FINAL_CLIENT"
        echo "  Server sender: $INITIAL_SERVER -> $FINAL_SERVER"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
test_broker_reset() {
    print_banner "SCENARIO: Broker Controlled Reset"
    echo "Server sends ResetSeqNumFlag=Y to force reset."

    print_header "STEP 1: Clean Start"
    clean_dir "$STORE_DIR/broker-initiator" "$STORE_DIR/broker-acceptor"
    print_success "Store cleaned"

    print_header "STEP 2: First Session — Build Up Sequences"
    run_quiet_bg $APP broker-reset --server --timeout $LONG_TIMEOUT; SERVER_PID=$BG_PID
    sleep 2
    run_quiet $APP broker-reset --client --timeout $SHORT_TIMEOUT
    sleep 1
    kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null || true

    print_header "STEP 3: State After First Session"
    show_seqnums "Persisted sequences" "$BROKER_CLIENT_SEQNUMS" "$BROKER_SERVER_SEQNUMS"
    FIRST_CLIENT=$(get_sender_seq "$BROKER_CLIENT_SEQNUMS")
    FIRST_SERVER=$(get_sender_seq "$BROKER_SERVER_SEQNUMS")
    print_info "Client sender: $FIRST_CLIENT, Server sender: $FIRST_SERVER"

    print_header "STEP 4: Broker Reset Time (3s)"
    sleep 3

    print_header "STEP 5: Reconnect — Server Forces Reset"
    run_quiet_bg $APP broker-reset --server --timeout $LONG_TIMEOUT; SERVER_PID=$BG_PID
    sleep 2
    run_quiet $APP broker-reset --client --timeout $SHORT_TIMEOUT
    sleep 1
    kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null || true

    print_header "STEP 6: Verify Reset"
    show_seqnums "Final sequences" "$BROKER_CLIENT_SEQNUMS" "$BROKER_SERVER_SEQNUMS"
    FINAL_CLIENT=$(get_sender_seq "$BROKER_CLIENT_SEQNUMS")

    print_header "RESULT"
    if [ "$FINAL_CLIENT" -le "$FIRST_CLIENT" ] 2>/dev/null; then
        print_success "Broker reset worked — sequences reset"
        echo "  Client sender: $FIRST_CLIENT -> $FINAL_CLIENT (reset)"
        echo "  Server sender: $FIRST_SERVER -> $(get_sender_seq "$BROKER_SERVER_SEQNUMS") (reset)"
        return 0
    else
        print_error "Sequences continued instead of resetting"
        echo "  Client sender: $FIRST_CLIENT -> $FINAL_CLIENT"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Multiple counterparties on one acceptor.  The acceptor runs TargetCompID '*', so
# each accepted connection takes its identity - and its own store - from whichever
# client logs on.  Before per-session isolation landed, all of them shared one
# parse buffer, one description and one store file.
test_multi_client() {
    print_banner "SCENARIO: Multi Client Acceptor"
    echo "Three clients connect concurrently to one wildcard acceptor."

    print_header "STEP 1: Clean Start"
    clean_dir "$MULTI_CLIENT_STORE" "$MULTI_SERVER_STORE"
    print_success "Store cleaned"

    print_header "STEP 2: Run acceptor with 3 clients"
    run_quiet $APP multi-client --clients 3 --timeout $((LONG_TIMEOUT * 2))

    print_header "STEP 3: Verify each client got its own session"
    local server_stores client_stores
    server_stores=$(ls "$MULTI_SERVER_STORE"/*.seqnums 2>/dev/null | wc -l)
    client_stores=$(ls "$MULTI_CLIENT_STORE"/*.seqnums 2>/dev/null | wc -l)
    print_info "acceptor side stores: $server_stores"
    print_info "client side stores:   $client_stores"
    for f in "$MULTI_SERVER_STORE"/*.seqnums; do
        [ -f "$f" ] && echo "  $(basename "$f"): $(cat "$f")"
    done

    print_header "RESULT"
    if [ "$server_stores" -eq 3 ] && [ "$client_stores" -eq 3 ]; then
        print_success "Three independent sessions, three independent stores - no cross talk"
        return 0
    else
        print_error "Expected 3 stores per side, got server=$server_stores client=$client_stores"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# github.com/TimelordUK/jspurefix/issues/153 - a counterparty whose socket has gone
# half open reconnects.  The acceptor must stop the stale session and keep the new
# one, rather than running both against a single store.
test_stale_transport() {
    print_banner "SCENARIO: Stale Transport Replacement (issue #153)"
    echo "Client goes silent without closing, then reconnects with the same CompID."

    print_header "STEP 1: Clean Start"
    clean_dir "$MULTI_SERVER_STORE"
    print_success "Store cleaned"

    print_header "STEP 2: Start acceptor"
    local log="$STORE_DIR/stale-transport-server.log"
    $APP multi-client --server --timeout $((LONG_TIMEOUT * 2)) > "$log" 2>&1 &
    local server_pid=$!
    sleep 3

    print_header "STEP 3: Drive the half open reconnect"
    node scripts/stale-transport.js || true

    print_step "Stopping server..."
    kill $server_pid 2>/dev/null; wait $server_pid 2>/dev/null || true

    print_header "STEP 4: Verify the acceptor replaced the stale session"
    local replaced remaining
    replaced=$(grep -c "FOUND EXISTING SESSION" "$log" || true)
    remaining=$(grep "acceptor census" "$log" | tail -1)
    print_info "stale sessions replaced: $replaced"
    print_info "final $remaining"

    print_header "RESULT"
    if [ "$replaced" -ge 1 ]; then
        print_success "Stale session was stopped and replaced by the new connection"
        grep -E "FOUND EXISTING SESSION|requestStop|successfully unregistered" "$log" | sed 's/^/  /'
        return 0
    else
        print_error "Acceptor did not replace the stale session"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# A venue configured with TargetCompID '*' and no knowledge of any counterparty.
# Four unrelated names log on - one of them well after the venue started - and each
# ends up with its own SessionId and its own persisted store.
test_dynamic() {
    print_banner "SCENARIO: Dynamic Acceptor (TargetCompID '*')"
    echo "Counterparties the venue was never configured with log on and are adopted."

    print_header "STEP 1: Clean Start"
    clean_dir "$DYNAMIC_SERVER_STORE" "$STORE_DIR/dynamic-initiator"
    print_success "Store cleaned"

    print_header "STEP 2: Run venue with three counterparties, a fourth joining later"
    local log="$STORE_DIR/dynamic.log"
    $APP dynamic --timeout $((LONG_TIMEOUT * 2)) > "$log" 2>&1 || true

    print_header "STEP 3: Which identities did the venue adopt?"
    grep -oE "binding session identity to peer SenderCompID '[^']*'" "$log" | sed "s/^/  /" || true

    print_header "STEP 4: Stores written, one per counterparty"
    local stores
    stores=$(ls "$DYNAMIC_SERVER_STORE"/*.seqnums 2>/dev/null | wc -l)
    for f in "$DYNAMIC_SERVER_STORE"/*.seqnums; do
        [ -f "$f" ] && echo "  $(basename "$f"): $(cat "$f")"
    done

    print_header "RESULT"
    local configured
    configured=$(grep -c "hedge-fund-a\|prop-desk-d" data/session/dynamic-acceptor.json || true)
    if [ "$stores" -eq 4 ] && [ "$configured" -eq 0 ]; then
        print_success "Four counterparties adopted, four stores, none named in the acceptor config"
        return 0
    else
        print_error "Expected 4 stores and 0 configured names, got stores=$stores configured=$configured"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Logon, heartbeats, nothing else.  The assertion is about what is absent: every
# message on the wire must be a session message, because the mode has no
# application layer to produce anything else.
test_skeleton() {
    print_banner "SCENARIO: Skeleton (logon and heartbeat only)"
    echo "Two clients on one acceptor hold sessions up with no application messages."

    print_header "STEP 1: Clean Start"
    rm -f jsfix.skeleton_client_1.txt jsfix.skeleton_client_2.txt jsfix.skeleton_server.txt
    mkdir -p "$STORE_DIR"
    print_success "Previous FIX logs removed"

    print_header "STEP 2: Run two skeleton clients against one acceptor"
    local log="$STORE_DIR/skeleton.log"
    # long enough for at least one heartbeat interval to elapse on both sessions
    $APP skeleton --clients 2 --timeout $((LONG_TIMEOUT * 2 + 5)) --heap-every $LONG_TIMEOUT > "$log" 2>&1 || true

    print_header "STEP 3: Identities adopted by the acceptor"
    grep -oE "binding session identity to peer SenderCompID '[^']*'" "$log" | sed 's/^/  /' || true

    print_header "STEP 4: What went on the wire"
    local types heartbeats ready unexpected
    types=$(grep -ohE "\|35=[^|]*\|" jsfix.skeleton_client_*.txt | sort -u | tr -d '|' | tr '\n' ' ')
    heartbeats=$(grep -c "35=0" jsfix.skeleton_client_1.txt || true)
    # session level message types only: Logon, Heartbeat, TestRequest, ResendRequest,
    # Reject, SequenceReset, Logout.  Anything else came from an application.
    unexpected=$(grep -ohE "\|35=[^|]*\|" jsfix.skeleton_client_*.txt | grep -vcE "\|35=[A0-5]\|" || true)
    print_info "message types seen: $types"
    print_info "heartbeats in client 1 log: $heartbeats"
    print_info "application messages: $unexpected"

    print_header "STEP 5: Heap report"
    grep -E "^\s+\[heap\]" "$log" | tail -3 | sed 's/^/  /' || true

    print_header "RESULT"
    # two initiator sessions and the two the acceptor made for them
    ready=$(grep -c "session ready - heartbeat only" "$log" || true)
    if [ "$ready" -ge 4 ] && [ "$heartbeats" -ge 2 ] && [ "$unexpected" -eq 0 ]; then
        print_success "Four sessions up, heartbeats flowing, not one application message"
        return 0
    else
        print_error "Expected ready>=4 heartbeats>=2 app-msgs=0, got ready=$ready heartbeats=$heartbeats app-msgs=$unexpected"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
run_all() {
    local failures=0
    test_client_bounce || failures=$((failures + 1))
    test_server_bounce || failures=$((failures + 1))
    test_broker_reset  || failures=$((failures + 1))
    test_multi_client  || failures=$((failures + 1))
    test_dynamic       || failures=$((failures + 1))
    test_stale_transport || failures=$((failures + 1))
    test_skeleton      || failures=$((failures + 1))
    echo ""
    print_banner "SUMMARY"
    if [ $failures -eq 0 ]; then
        print_success "All scenarios passed"
    else
        print_error "$failures scenario(s) failed"
    fi
    return $failures
}

SCENARIO="${1:-all}"
case "$SCENARIO" in
    client-bounce)  test_client_bounce ;;
    server-bounce)  test_server_bounce ;;
    broker-reset)   test_broker_reset ;;
    multi-client)   test_multi_client ;;
    dynamic)        test_dynamic ;;
    stale-transport) test_stale_transport ;;
    skeleton)       test_skeleton ;;
    all)            run_all ;;
    *)  echo "Unknown: $SCENARIO (valid: client-bounce, server-bounce, broker-reset, multi-client, dynamic, stale-transport, skeleton, all)"; exit 1 ;;
esac
