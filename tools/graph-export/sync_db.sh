#!/usr/bin/env bash
#
# sync_db.sh — publish the master DB to the rest-api read copy + trigger reload
#
# Extracted from cluster.sh step 5 so the
# sync is reusable: cluster.sh calls it after its load, and the fm-graph-cluster
# skill calls it once at the very end of its run — after the final
# cluster load AND the semantic naming, so the Explorer sees the named partition
# in a single reload (sync at the very end).
#
# This script ALWAYS performs the sync when invoked — the NO_SYNC gating lives in
# the callers (cluster.sh guards on FMLAB_CLUSTER_NO_SYNC; the skill on --no-sync),
# so "call sync_db.sh" unambiguously means "publish now".
#
# Usage:  bash sync_db.sh [db_file]
#   db_file   master DB to publish     (default: <repo>/db/fm_catalog.duckdb)
#
# Env:
#   REST_API_RELOAD_URL   reload endpoint   (default http://localhost:3003/api/admin/reload)
#
# Exit: 0 on success (reload reachable or server simply not running — both ok),
#       non-zero only if the copy itself fails.
#
# bash-3.2 compatible (macOS system bash): no `case` inside $(…), no bash-4+ features.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Multi-solution: publish into the per-solution API copy. FMLAB_SOLUTION
# overrides; default = active solution from the pointer file; 'default' last.
SOLUTION="${FMLAB_SOLUTION:-}"
if [ -z "$SOLUTION" ] && [ -f "$PROJECT_ROOT/.fmlab/active_solution.json" ]; then
  SOLUTION=$(sed -n 's/.*"active"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_ROOT/.fmlab/active_solution.json" | head -n1)
fi
[ -z "$SOLUTION" ] && SOLUTION="default"

if [ -f "$PROJECT_ROOT/solutions/$SOLUTION/db/fm_catalog.duckdb" ]; then
  _DEFAULT_DB="$PROJECT_ROOT/solutions/$SOLUTION/db/fm_catalog.duckdb"
else
  _DEFAULT_DB="$PROJECT_ROOT/db/fm_catalog.duckdb"
fi
DB_FILE="${1:-$_DEFAULT_DB}"
REST_API_DB_DIR="$PROJECT_ROOT/rest-api/db/solutions/$SOLUTION"
REST_API_DB_FILE="$REST_API_DB_DIR/fm_catalog.duckdb"
REST_API_RELOAD_URL="${REST_API_RELOAD_URL:-http://localhost:3003/api/admin/reload}"

if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: DB to sync not found at $DB_FILE" >&2
  exit 1
fi

if [ -d "$REST_API_DB_DIR" ] || mkdir -p "$REST_API_DB_DIR" 2>/dev/null; then
  if cp "$DB_FILE" "$REST_API_DB_FILE.tmp" && mv -f "$REST_API_DB_FILE.tmp" "$REST_API_DB_FILE"; then
    echo "→ synced master DB to rest-api/db/solutions/$SOLUTION/"
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' -d "{\"solution\":\"$SOLUTION\"}" \
      "$REST_API_RELOAD_URL" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      echo "  REST-API reload triggered"
    else
      echo "  REST-API not reachable at $REST_API_RELOAD_URL (ok if not running)"
    fi
  else
    echo "  WARN: sync to rest-api/db/ failed" >&2
    rm -f "$REST_API_DB_FILE.tmp" 2>/dev/null
    exit 2
  fi
else
  echo "  WARN: cannot create $REST_API_DB_DIR" >&2
  exit 2
fi
