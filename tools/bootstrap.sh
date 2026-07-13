#!/usr/bin/env bash
# bootstrap.sh — shared, idempotent project bootstrap for fm-lab.
#
# Single source of truth for the steps that BOTH the native init (tools/init.sh) and
# the Docker `setup` service need, so the two can never drift (F-B7):
#   1 · seed rest-api/.env + apps/web/.env from the committed examples (idempotent)
#   2 · npm install (workspaces)
#   3 · build packages/shared
#   4 · seed an empty placeholder catalog DB so the READ_ONLY API can boot BEFORE any
#       XML is converted (the convert step / web button replace it later)
#
# Deliberately NOT here (caller-specific): prerequisite/version checks, resource
# preflight, .claude settings + DuckDB PATH injection (native only), server start,
# XML conversion. Those stay in the respective caller.
#
# Usage:  bash tools/bootstrap.sh [PROJECT_ROOT]
# Env:
#   FMLAB_BOOTSTRAP_QUIET=1        pass --silent to npm (default: verbose npm output)
#   DUCKDB_BIN=/path/to/duckdb     binary for the placeholder-DB seed
#                                  (default: `duckdb` from PATH)
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

# 1 · env seeds — cp -n never clobbers an existing .env (idempotent) ───────────────
cp -n rest-api/.env.example rest-api/.env 2>/dev/null || true
cp -n apps/web/.env.example   apps/web/.env   2>/dev/null || true

# 1b · auto-heal stale reference path in an EXISTING rest-api/.env ──────────────────
# The reference DB was renamed + relocated (db/fm_reference.duckdb →
# reference/fm_spec.duckdb). A user who updates an OLD checkout via `git pull` keeps
# their previously-seeded rest-api/.env — the `cp -n` above never overwrites it — so a
# stale `REFERENCE_DUCKDB_PATH=./db/fm_reference.duckdb` would override the corrected
# code default and detach the reference DB (503 on every /api/reference endpoint).
# Rewrite just that one line in place. Surgical (only lines pointing at the vanished old
# filename `fm_reference.duckdb`) and idempotent (a healed .env no longer matches).
# Portable: no `sed -i` (BSD vs GNU differ); awk to a temp file + mv.
_env="rest-api/.env"
if [ -f "$_env" ] && grep -qE '^[[:space:]]*REFERENCE_DUCKDB_PATH=.*fm_reference\.duckdb' "$_env" 2>/dev/null; then
  _tmp="$_env.heal.$$"
  if awk '
        /^[[:space:]]*REFERENCE_DUCKDB_PATH=.*fm_reference\.duckdb/ {
          print "REFERENCE_DUCKDB_PATH=../reference/fm_spec.duckdb"; next
        }
        { print }
      ' "$_env" > "$_tmp" 2>/dev/null && mv "$_tmp" "$_env"; then
    echo "Auto-healed stale REFERENCE_DUCKDB_PATH in rest-api/.env (→ ../reference/fm_spec.duckdb)."
  else
    rm -f "$_tmp"
    echo "⚠  Could not auto-heal rest-api/.env — set REFERENCE_DUCKDB_PATH=../reference/fm_spec.duckdb manually." >&2
  fi
fi

# 1c · remove orphaned OLD reference artifacts left by a pre-rename checkout ─────────
# The reference DB used to live (double-deployed) as rest-api/db/fm_reference.duckdb +
# docs/claris-help/fm_reference.duckdb with a rest-api/db/fm_reference.meta.json sidecar;
# it is now the single canonical reference/fm_spec.duckdb. A `git pull` over an OLD
# checkout brings the new file but leaves the old ones as dead weight (~15–30 MB) and a
# source of confusion. DELETE — never move: these are shipped, regenerable reference
# artifacts (not user data), and the old copies are an OLDER build, so moving one over
# the freshly-pulled reference/fm_spec.duckdb would clobber the correct DB. Guarded on
# the new canonical file being present, so a half-updated checkout never loses its only
# reference DB. fm_catalog.duckdb (the user's converted solution) is deliberately NOT
# touched — only the exact old `fm_reference.*` names.
if [ -f "reference/fm_spec.duckdb" ]; then
  for _stale in \
    rest-api/db/fm_reference.duckdb \
    rest-api/db/fm_reference.duckdb.wal \
    rest-api/db/fm_reference.meta.json \
    rest-api/db/fm_reference.consumer-build.duckdb \
    docs/claris-help/fm_reference.duckdb; do
    if [ -e "$_stale" ]; then
      rm -f "$_stale" && echo "Removed orphaned old reference artifact: $_stale"
    fi
  done
fi

# 2 · dependencies + 3 · shared package ───────────────────────────────────────────
if [ "${FMLAB_BOOTSTRAP_QUIET:-0}" = "1" ]; then
  npm install --silent
  npm run build:shared --silent
else
  npm install
  npm run build:shared
fi

# 4 · placeholder catalog DB (empty) so the READ_ONLY API can boot pre-convert ─────
mkdir -p rest-api/db
if [ ! -f rest-api/db/fm_catalog.duckdb ]; then
  _duckdb="${DUCKDB_BIN:-}"
  if [ -z "$_duckdb" ] && command -v duckdb >/dev/null 2>&1; then _duckdb="duckdb"; fi
  if [ -n "$_duckdb" ] && "$_duckdb" rest-api/db/fm_catalog.duckdb -c "SELECT 1;" >/dev/null 2>&1; then
    echo "Seeded empty placeholder catalog DB (no XML converted yet)."
  else
    echo "⚠  Could not seed placeholder catalog DB (duckdb not found) — convert one XML first." >&2
  fi
fi
