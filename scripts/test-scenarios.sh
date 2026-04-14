#!/bin/bash
#
# jspf-demo Test Scenarios
# Usage: ./scripts/test-scenarios.sh [client-bounce|server-bounce|broker-reset|all]
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
run_quiet_bg() { "$@" > /dev/null 2>&1 & echo $!; }

CLIENT_SEQNUMS="$STORE_DIR/initiator/FIX4.4-init-comp-accept-comp.seqnums"
SERVER_SEQNUMS="$STORE_DIR/acceptor/FIX4.4-accept-comp-init-comp.seqnums"
BROKER_CLIENT_SEQNUMS="$STORE_DIR/broker-initiator/FIX4.4-init-comp-accept-comp.seqnums"
BROKER_SERVER_SEQNUMS="$STORE_DIR/broker-acceptor/FIX4.4-accept-comp-init-comp.seqnums"

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
    SERVER_PID=$(run_quiet_bg $APP recovery --server --timeout $((LONG_TIMEOUT * 3)))
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
    SERVER_PID=$(run_quiet_bg $APP recovery --server --timeout $LONG_TIMEOUT)
    sleep 2
    CLIENT_PID=$(run_quiet_bg $APP recovery --client --timeout $((LONG_TIMEOUT + 5)))

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
    SERVER_PID=$(run_quiet_bg $APP recovery --server --timeout $LONG_TIMEOUT)
    sleep 2
    CLIENT_PID=$(run_quiet_bg $APP recovery --client --timeout $SHORT_TIMEOUT)

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
    SERVER_PID=$(run_quiet_bg $APP broker-reset --server --timeout $LONG_TIMEOUT)
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
    SERVER_PID=$(run_quiet_bg $APP broker-reset --server --timeout $LONG_TIMEOUT)
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
run_all() {
    local failures=0
    test_client_bounce || failures=$((failures + 1))
    test_server_bounce || failures=$((failures + 1))
    test_broker_reset  || failures=$((failures + 1))
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
    all)            run_all ;;
    *)  echo "Unknown: $SCENARIO (valid: client-bounce, server-bounce, broker-reset, all)"; exit 1 ;;
esac
