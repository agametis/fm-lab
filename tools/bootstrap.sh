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
