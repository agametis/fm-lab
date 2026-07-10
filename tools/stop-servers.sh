#!/usr/bin/env bash
# stop-servers.sh — Stops frontend (port 5173) and REST API (port 3003)
set -euo pipefail

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

# Determine all PIDs on a port (lsof if available, otherwise ss — IPv6-safe)
get_listen_pids() {
  local port=$1
  if command -v lsof &>/dev/null; then
    lsof -nP -iTCP:"$port" 2>/dev/null | awk '/LISTEN/ {print $2}' | sort -u
  elif command -v ss &>/dev/null; then
    ss -tlnpH 2>/dev/null | awk -v p="$port" '$4 ~ "[:.]"p"$"' \
      | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
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

  # Send SIGTERM
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done

  # Wait briefly and check
  sleep 1
  local remaining
  remaining=$(get_listen_pids "$port")

  if [ -n "$remaining" ]; then
    # SIGKILL as a fallback
    for pid in $remaining; do
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
header "Frontend (Port 5173)"
if stop_port 5173 "frontend server"; then
  fe_stopped=true
fi

# ─── REST API ────────────────────────────────────────────────
header "REST API (Port 3003)"
if stop_port 3003 "REST API server"; then
  api_stopped=true
fi

# ─── Summary ─────────────────────────────────────────────────
header "Status"
if [ "$fe_stopped" = true ] || [ "$api_stopped" = true ]; then
  [ "$api_stopped" = true ] && echo "  REST API:  stopped" || echo "  REST API:  was not active"
  [ "$fe_stopped" = true ]  && echo "  Frontend:  stopped" || echo "  Frontend:  was not active"
else
  echo "  No servers were active."
fi
