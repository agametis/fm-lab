#!/usr/bin/env bash
# stop-servers.sh — Stoppt Frontend (Port 5173) und REST-API (Port 3003)
set -euo pipefail

# Farben (nur bei Terminal-Output)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; NC=''
fi

info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }
header(){ echo -e "\n${BOLD}$1${NC}"; }

# Alle PIDs auf einem Port ermitteln (lsof falls vorhanden, sonst ss — IPv6-safe)
get_listen_pids() {
  local port=$1
  if command -v lsof &>/dev/null; then
    lsof -nP -iTCP:"$port" 2>/dev/null | awk '/LISTEN/ {print $2}' | sort -u
  elif command -v ss &>/dev/null; then
    ss -tlnpH 2>/dev/null | awk -v p="$port" '$4 ~ "[:.]"p"$"' \
      | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
  fi
}

# Prozesse auf einem Port graceful stoppen
stop_port() {
  local port=$1 label=$2
  local pids
  pids=$(get_listen_pids "$port")

  if [ -z "$pids" ]; then
    info "Kein $label auf Port $port aktiv"
    return 1
  fi

  # SIGTERM senden
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done

  # Kurz warten und prüfen
  sleep 1
  local remaining
  remaining=$(get_listen_pids "$port")

  if [ -n "$remaining" ]; then
    # SIGKILL als Fallback
    for pid in $remaining; do
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 0.5
    warn "$label gestoppt (SIGKILL für PID $remaining)"
  else
    info "$label gestoppt (PID $pids)"
  fi
  return 0
}

fe_stopped=false
api_stopped=false

# ─── Frontend zuerst (damit der Browser keine API-Fehler sieht) ──
header "Frontend (Port 5173)"
if stop_port 5173 "Frontend-Server"; then
  fe_stopped=true
fi

# ─── REST-API ────────────────────────────────────────────────
header "REST-API (Port 3003)"
if stop_port 3003 "REST-API-Server"; then
  api_stopped=true
fi

# ─── Zusammenfassung ─────────────────────────────────────────
header "Status"
if [ "$fe_stopped" = true ] || [ "$api_stopped" = true ]; then
  [ "$api_stopped" = true ] && echo "  REST-API:  gestoppt" || echo "  REST-API:  war nicht aktiv"
  [ "$fe_stopped" = true ]  && echo "  Frontend:  gestoppt" || echo "  Frontend:  war nicht aktiv"
else
  echo "  Keine Server waren aktiv."
fi
