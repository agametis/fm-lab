#!/usr/bin/env bash
# start-servers.sh — Startet REST-API (Port 3003) und Frontend (Port 5173)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

# Lauscht ein Prozess auf dem Port? (lsof falls vorhanden, sonst ss — Linux)
port_listening() {
  local port=$1
  if command -v lsof &>/dev/null; then
    lsof -nP -iTCP:"$port" 2>/dev/null | grep -q LISTEN
  elif command -v ss &>/dev/null; then
    ss -tlnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$"
  else
    return 1
  fi
}

# PID auf einem Port ermitteln (lsof falls vorhanden, sonst ss — IPv6-safe)
get_listen_pid() {
  local port=$1
  if command -v lsof &>/dev/null; then
    lsof -nP -iTCP:"$port" 2>/dev/null | awk '/LISTEN/ {print $2}' | sort -u | head -1
  elif command -v ss &>/dev/null; then
    ss -tlnpH 2>/dev/null | awk -v p="$port" '$4 ~ "[:.]"p"$"' \
      | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
  fi
}

# Warte bis ein Port antwortet (max $2 Sekunden)
wait_for_port() {
  local port=$1 max=${2:-5} i=0
  while [ $i -lt $max ]; do
    if port_listening "$port"; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# ─── Locate node/npm binaries ────────────────────────────────
# nohup inherits a restricted PATH; resolve the full binary path so the
# server starts reliably regardless of how Node was installed.
NODE_BIN=""
NPM_BIN=""

if command -v node &>/dev/null; then
  NODE_BIN=$(command -v node)
  NPM_BIN=$(command -v npm)
else
  # Homebrew (Apple Silicon / Intel)
  for _candidate in "/opt/homebrew/bin/node" "/usr/local/bin/node"; do
    if [ -x "$_candidate" ]; then
      NODE_BIN="$_candidate"
      NPM_BIN="$(dirname "$_candidate")/npm"
      break
    fi
  done

  # nvm — resolve via default alias, fall back to most recent installed version
  if [ -z "$NODE_BIN" ]; then
    _nvm_dir="${NVM_DIR:-$HOME/.nvm}"
    _nvm_default="$_nvm_dir/alias/default"
    if [ -f "$_nvm_default" ]; then
      _ver=$(cat "$_nvm_default" | tr -d '[:space:]')
      _candidate="$_nvm_dir/versions/node/$_ver/bin/node"
      if [ ! -x "$_candidate" ]; then
        # alias may point to another alias (e.g. "lts/*") — take latest installed
        _candidate=$(ls -t "$_nvm_dir/versions/node/"*/bin/node 2>/dev/null | head -1)
      fi
      if [ -x "$_candidate" ]; then
        NODE_BIN="$_candidate"
        NPM_BIN="$(dirname "$_candidate")/npm"
      fi
    fi
  fi
fi

if [ -z "$NODE_BIN" ]; then
  error "Node.js not found. Install it from https://nodejs.org/"
  exit 1
fi

# Ensure node's bin directory is in PATH so nohup child processes
# (e.g. vite with #!/usr/bin/env node) can find node regardless of
# how it was installed (nvm, Homebrew, system).
export PATH="$(dirname "$NODE_BIN"):$PATH"

api_started=false
frontend_started=false

# ─── REST-API ────────────────────────────────────────────────
header "REST-API (Port 3003)"

# Prüfe DB-Kopie
if [ ! -f "$PROJECT_ROOT/rest-api/db/fm_catalog.duckdb" ]; then
  error "Datenbank nicht gefunden: rest-api/db/fm_catalog.duckdb"
  error "Bitte zuerst 'convert-xml --batch' ausführen."
  exit 1
fi

# Prüfe ob bereits aktiv
API_PID=$(get_listen_pid 3003 || true)
if [ -n "$API_PID" ]; then
  info "REST-API läuft bereits (PID $API_PID)"
else
  # Server starten
  cd "$PROJECT_ROOT/rest-api"
  nohup "$NODE_BIN" src/index.js > "$PROJECT_ROOT/logs/rest-api.log" 2>&1 &
  API_PID=$!
  cd "$PROJECT_ROOT"

  if wait_for_port 3003 5; then
    info "REST-API gestartet (PID $API_PID)"
    api_started=true
  else
    error "REST-API konnte nicht gestartet werden. Log:"
    tail -20 "$PROJECT_ROOT/logs/rest-api.log" 2>/dev/null || true
    exit 1
  fi
fi

# Version abrufen
API_VERSION=$(curl -s http://localhost:3003/api/version 2>/dev/null || echo "")
if [ -n "$API_VERSION" ]; then
  TABLE_COUNT=$(echo "$API_VERSION" | grep -o '"tableCount":[0-9]*' | grep -o '[0-9]*' || echo "?")
  info "API antwortet — $TABLE_COUNT Tabellen geladen"
else
  warn "API läuft, aber /api/version antwortet nicht"
fi

# ─── Frontend ────────────────────────────────────────────────
header "Frontend (Port 5173)"

# Prüfe Vite-Installation
if [ ! -f "$PROJECT_ROOT/node_modules/.bin/vite" ]; then
  error "Vite nicht gefunden. Bitte im Projekt-Root 'npm install' ausführen."
  exit 1
fi

# Prüfe ob bereits aktiv
FE_PID=$(get_listen_pid 5173 || true)
if [ -n "$FE_PID" ]; then
  info "Frontend läuft bereits (PID $FE_PID)"
else
  # Vite starten
  cd "$PROJECT_ROOT/apps/web"
  nohup "$NPM_BIN" run dev > "$PROJECT_ROOT/logs/frontend.log" 2>&1 &
  FE_PID=$!
  cd "$PROJECT_ROOT"

  if wait_for_port 5173 8; then
    # PID nochmal lesen (npm spawnt Child-Prozess)
    FE_PID=$(get_listen_pid 5173 || true)
    info "Frontend gestartet (PID $FE_PID)"
    frontend_started=true
  else
    error "Frontend konnte nicht gestartet werden. Log:"
    tail -20 "$PROJECT_ROOT/logs/frontend.log" 2>/dev/null || true
    exit 1
  fi
fi

# ─── Zusammenfassung ─────────────────────────────────────────
header "Status"
echo "  REST-API:  http://localhost:3003  $([ "$api_started" = true ] && echo '(neu gestartet)' || echo '(lief bereits)')"
echo "  Frontend:  http://localhost:5173  $([ "$frontend_started" = true ] && echo '(neu gestartet)' || echo '(lief bereits)')"
echo ""
echo "  Stoppen:   tools/stop-servers.sh"
echo "  API-Log:   logs/rest-api.log"
echo "  FE-Log:    logs/frontend.log"
