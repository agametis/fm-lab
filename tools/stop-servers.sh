#!/usr/bin/env bash
# stop-servers.sh — Stops the frontend (port 5173) and/or the REST API (port 3003).
#
# Usage:  stop-servers.sh [api|frontend|all]   (default: all)
#   api        stop ONLY the API. The frontend deliberately keeps running: killing the
#              Vite dev server mid-session drives the browser's HMR client into a
#              reload loop (Safari: endless reload; the former tab-opening/focus-stealing
#              side is defused since onAutoForward on 5173 is "notify", not "openBrowser").
#              While the API is down the web client degrades gracefully (transport-error
#              handling) and recovers on its own.
#   frontend   stop only the frontend
#   all        stop frontend + API   (frontend first, so the browser doesn't sit on a
#              dead API longer than necessary)
#
# In the Docker Compose topology (FMLAB_RUNTIME=container) the servers run under
# `restart: unless-stopped`; a plain kill is immediately resurrected. This script
# refuses to kill there and points at `docker compose stop` on the host instead.
set -euo pipefail

TARGET="${1:-all}"
case "$TARGET" in
  api|all) ;;
  frontend|web) TARGET="frontend" ;;
  *) echo "Usage: $(basename "$0") [api|frontend|all]" >&2; exit 2 ;;
esac

# Colors (only for terminal output)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; NC=''
fi

info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }
header(){ echo -e "\n${BOLD}$1${NC}"; }

# NOTE — no FMLAB_RUNTIME guard here (see the matching note in start-servers.sh). The VS
# Code Dev Container sets FMLAB_RUNTIME=container but starts the servers via THIS toolset
# (overrideCommand → node/vite are ordinary child processes, not PID 1), so stopping them
# here is correct and does NOT bounce the container. Only in the pure `docker compose up`
# path is node PID 1 under a restart policy — but there you stop with `docker compose
# stop`, not this script, so a guard here would only have broken the dev-container path.

# Determine all PIDs on a port (lsof if available, otherwise ss — IPv6-safe). The base
# dev container has NEITHER lsof NOR ss; there we fall back to fuser (which the ss/lsof
# absence otherwise left with no port→PID resolver). No lsof → no false "nothing found".
get_listen_pids() {
  local port=$1
  if command -v lsof &>/dev/null; then
    lsof -nP -iTCP:"$port" 2>/dev/null | awk '/LISTEN/ {print $2}' | sort -u
  elif command -v ss &>/dev/null; then
    ss -tlnpH 2>/dev/null | awk -v p="$port" '$4 ~ "[:.]"p"$"' \
      | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
  elif command -v fuser &>/dev/null; then
    fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u
  fi
}

# Gracefully stop processes on a port
stop_port() {
  local port=$1 label=$2
  local pids
  pids=$(get_listen_pids "$port")

  if [ -z "$pids" ]; then
    info "No $label active on port $port"
    return 1
  fi

  # Send SIGTERM (never kill ourselves — a port resolver could, in theory, match this
  # shell if it were bound to the port; exclude our own PID defensively).
  for pid in $pids; do
    [ "$pid" = "$$" ] && continue
    kill "$pid" 2>/dev/null || true
  done

  # Wait briefly and check
  sleep 1
  local remaining
  remaining=$(get_listen_pids "$port")

  if [ -n "$remaining" ]; then
    # SIGKILL as a fallback
    for pid in $remaining; do
      [ "$pid" = "$$" ] && continue
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 0.5
    warn "$label stopped (SIGKILL for PID $remaining)"
  else
    info "$label stopped (PID $pids)"
  fi
  return 0
}

fe_stopped=false
api_stopped=false

# ─── Frontend first (so the browser doesn't see API errors) ──
# Skipped for the `api` target: the Vite dev server must survive an API restart,
# otherwise the browser's HMR client enters its reload loop (see header).
if [ "$TARGET" != "api" ]; then
  header "Frontend (Port 5173)"
  if stop_port 5173 "frontend server"; then
    fe_stopped=true
  fi
fi

# ─── REST API (only when the API is a stop target) ───────────
if [ "$TARGET" != "frontend" ]; then
  header "REST API (Port 3003)"
  if stop_port 3003 "REST API server"; then
    api_stopped=true
  fi
fi

# ─── Summary ─────────────────────────────────────────────────
header "Status"
if [ "$fe_stopped" = true ] || [ "$api_stopped" = true ]; then
  if [ "$TARGET" != "frontend" ]; then
    [ "$api_stopped" = true ] && echo "  REST API:  stopped" || echo "  REST API:  was not active"
  fi
  if [ "$TARGET" != "api" ]; then
    [ "$fe_stopped" = true ]  && echo "  Frontend:  stopped" || echo "  Frontend:  was not active"
  fi
  if [ "$TARGET" = "frontend" ]; then
    echo "  REST API:  untouched (still running on 3003 if it was up)"
  fi
  if [ "$TARGET" = "api" ]; then
    echo "  Frontend:  untouched (keeps running on 5173 if it was up)"
  fi
else
  echo "  No servers were active."
fi
exit 0
