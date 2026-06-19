#!/usr/bin/env bash
# init.sh — First-time setup for fm-lab
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INIT_START=$SECONDS

VERBOSE=false
for arg in "$@"; do
  case "$arg" in
    -v|--verbose) VERBOSE=true ;;
  esac
done

# Colors (terminal only)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; NC=''
fi

info()   { echo -e "${GREEN}✓${NC} $1"; }
warn()   { echo -e "${YELLOW}⚠${NC} $1"; }
error()  { echo -e "${RED}✗${NC} $1"; }
header() { echo -e "\n${BOLD}$1${NC}"; }

# Summary tracking
SUMMARY=()
summary_add() { SUMMARY+=("$1"); }

header "fm-lab init"
echo "  Project root: $PROJECT_ROOT"
[ "$VERBOSE" = true ] && echo "  Mode: verbose (--verbose)"

# ─── Prerequisites ────────────────────────────────────────────

header "Checking prerequisites"

ok=true

# DuckDB — check PATH first, then common install locations
DUCKDB_BIN=""
DUCKDB_DIR=""
if command -v duckdb &>/dev/null; then
  DUCKDB_BIN=$(command -v duckdb)
else
  for candidate in \
    "$HOME/.duckdb/cli/latest/duckdb" \
    "/opt/homebrew/bin/duckdb" \
    "/usr/local/bin/duckdb"; do
    if [ -x "$candidate" ]; then
      DUCKDB_BIN="$candidate"
      break
    fi
  done
fi

if [ -n "$DUCKDB_BIN" ]; then
  DUCKDB_VER=$("$DUCKDB_BIN" --version 2>/dev/null | head -1 || echo "unknown")
  DUCKDB_DIR=$(dirname "$DUCKDB_BIN")
  info "DuckDB: $DUCKDB_VER ($DUCKDB_BIN)"
else
  error "DuckDB CLI not found. Install it from https://duckdb.org/docs/installation/"
  ok=false
fi

# Node.js (≥18)
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -ge 18 ]; then
    info "Node.js: $NODE_VER"
  else
    error "Node.js $NODE_VER found, but ≥18 is required."
    ok=false
  fi
else
  error "Node.js not found. Install it from https://nodejs.org/"
  ok=false
fi

# npm (≥9)
if command -v npm &>/dev/null; then
  NPM_VER=$(npm --version)
  NPM_MAJOR=$(echo "$NPM_VER" | sed 's/\([0-9]*\).*/\1/')
  if [ "$NPM_MAJOR" -ge 9 ]; then
    info "npm: $NPM_VER"
  else
    error "npm $NPM_VER found, but ≥9 is required. Run: npm install -g npm"
    ok=false
  fi
else
  error "npm not found."
  ok=false
fi

if [ "$ok" = false ]; then
  echo ""
  error "Prerequisites missing — please install the tools above and run init.sh again."
  exit 1
fi

# ─── npm install ──────────────────────────────────────────────

header "Installing dependencies (this may take 1–2 minutes)"
cd "$PROJECT_ROOT"
T0=$SECONDS
if [ "$VERBOSE" = true ]; then
  npm install
else
  npm install --silent
fi
PKG_COUNT=$(find node_modules -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
info "Dependencies installed (~${PKG_COUNT} packages, $((SECONDS - T0))s)"
summary_add "npm install       ~${PKG_COUNT} packages ($((SECONDS - T0))s)"

# ─── .claude/settings.json ────────────────────────────────────

header "Claude Code settings"
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
if [ ! -f "$SETTINGS_FILE" ]; then
  mkdir -p "$PROJECT_ROOT/.claude"
  cat > "$SETTINGS_FILE" <<'SETTINGSEOF'
{
  "permissions": {
    "allow": [
      "Bash(npm:*)",
      "Bash(duckdb:*)",
      "Bash(bash .claude/skills/*:*)"
    ]
  },
  "extraKnownMarketplaces": {
    "duckdb-skills": {
      "source": { "source": "github", "repo": "duckdb/duckdb-skills" }
    }
  },
  "enabledPlugins": {
    "duckdb-skills@duckdb-skills": true
  }
}
SETTINGSEOF
  info "Created .claude/settings.json"
  summary_add "Claude settings    .claude/settings.json created"
else
  info ".claude/settings.json already exists"
  summary_add "Claude settings    already present (skipped)"
fi

# ─── DuckDB path → .claude/settings.json ─────────────────────
# VS Code / Claude Code inherits a restricted PATH and may not find DuckDB.
# We write the resolved binary directory into env.PATH so Claude Code can
# always locate duckdb without trying to install it.

if [ -n "$DUCKDB_DIR" ] && [ -f "$SETTINGS_FILE" ]; then
  export DUCKDB_DIR PROJECT_ROOT
  node - <<'NODEEOF'
const fs = require('fs');
const path = require('path');
const settingsPath = process.env.PROJECT_ROOT + '/.claude/settings.json';
const duckdbDir   = process.env.DUCKDB_DIR;
const settings    = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
settings.env      = settings.env || {};
const existingPath = settings.env.PATH || '';
if (!existingPath.split(':').includes(duckdbDir)) {
  // Prepend duckdb dir; keep the rest of the explicit PATH if already set,
  // otherwise fall back to common system dirs so other tools still work.
  const base = existingPath || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
  settings.env.PATH = duckdbDir + ':' + base;
}
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
NODEEOF
  info "DuckDB path written to .claude/settings.json"
  summary_add "Claude Code PATH   $DUCKDB_DIR added to .claude/settings.json"
fi

# ─── Build shared package ─────────────────────────────────────

header "Building shared package"
T0=$SECONDS
if [ "$VERBOSE" = true ]; then
  npm run build:shared
else
  npm run build:shared --silent
fi
info "packages/shared built ($((SECONDS - T0))s)"
summary_add "packages/shared   TypeScript → dist/ ($((SECONDS - T0))s)"

# ─── Environment files ────────────────────────────────────────

header "Environment files"

ENV_CREATED=()
if [ ! -f "$PROJECT_ROOT/rest-api/.env" ]; then
  cp "$PROJECT_ROOT/rest-api/.env.example" "$PROJECT_ROOT/rest-api/.env"
  info "Created rest-api/.env"
  ENV_CREATED+=("rest-api/.env")
else
  info "rest-api/.env already exists"
fi

if [ ! -f "$PROJECT_ROOT/apps/web/.env" ]; then
  cp "$PROJECT_ROOT/apps/web/.env.example" "$PROJECT_ROOT/apps/web/.env"
  info "Created apps/web/.env"
  ENV_CREATED+=("apps/web/.env")
else
  info "apps/web/.env already exists"
fi

if [ ${#ENV_CREATED[@]} -gt 0 ]; then
  summary_add "env files         created: ${ENV_CREATED[*]}"
else
  summary_add "env files         already present (skipped)"
fi

# ─── Logs directory ───────────────────────────────────────────

mkdir -p "$PROJECT_ROOT/logs"

# ─── XML conversion ───────────────────────────────────────────

header "FileMaker XML export"

XML_FILES=$(find "$PROJECT_ROOT/xml" -maxdepth 1 -name "*.xml" 2>/dev/null | wc -l | tr -d ' ')

print_summary() {
  local elapsed=$((SECONDS - INIT_START))
  echo ""
  echo -e "${BOLD}══════════════════════════════════════${NC}"
  echo -e "${BOLD}fm-lab setup complete (${elapsed}s)${NC}"
  echo ""
  for line in "${SUMMARY[@]}"; do
    echo -e "  ${GREEN}✓${NC} $line"
  done
  echo -e "${BOLD}══════════════════════════════════════${NC}"
}

if [ "$XML_FILES" -eq 0 ]; then
  warn "No XML files found in xml/."
  summary_add "XML conversion    skipped (no files in xml/)"
  print_summary
  echo ""
  echo "  Next step:"
  echo "  1. Export your FileMaker solution via 'Tools > Save a Copy As XML' + Option 'Include details for analysis tools'"
  echo "  2. Place the .xml file in the xml/ directory"
  echo "  3. Run:  bash tools/convert_fm_xml.sh --batch"
  echo "           (adaptive: chunked streaming + OOM-backoff automatically; even large solutions on tight RAM)"
  echo "  4. Then: bash tools/start-servers.sh"
  echo ""
  exit 0
fi

# --batch picks the adaptive default itself (Turbo + --auto OOM-backoff, plus SAX
# streaming when the patched webbed is present) — no manual mode flag needed; it
# never hard-aborts on tight RAM. FM_FORCE_DOM=1 keeps turbo+auto but on DOM.
CONVERT_ARGS=(--batch)
info "Found $XML_FILES XML file(s) in xml/ — starting conversion (adaptive mode)"
T0=$SECONDS
bash "$SCRIPT_DIR/convert_fm_xml.sh" "${CONVERT_ARGS[@]}"
summary_add "XML conversion    $XML_FILES file(s) → fm_catalog.duckdb ($((SECONDS - T0))s)"

# ─── Start servers ────────────────────────────────────────────

header "Starting servers"
bash "$SCRIPT_DIR/start-servers.sh"
summary_add "servers started   http://localhost:3003  |  http://localhost:5173"

print_summary
echo ""
echo "  Web Client:  http://localhost:5173"
echo "  REST API:    http://localhost:3003"
