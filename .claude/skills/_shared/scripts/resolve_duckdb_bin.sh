#!/usr/bin/env bash
# Shared DuckDB-binary resolver. Echoes the resolved `duckdb` path (empty if none found).
# Single source of the fallback chain for skills that must capture the binary into a
# variable (e.g. fm-graph-cluster orchestrating its own tooling). Skills using the plain
# `duckdb -readonly db/fm_catalog.duckdb -c "…"` invocation do NOT need this — see
# CLAUDE.md §2 / docs/agents/tooling.md. Never install DuckDB.
# The chain itself (PATH → ~/.duckdb/cli/latest → newest ~/.duckdb/cli/<version> →
# Homebrew → /usr/local) lives in tools/lib/duckdb_binding.sh (fmlab_find_duckdb).
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
# shellcheck source=../../../../tools/lib/duckdb_binding.sh
. "$ROOT/tools/lib/duckdb_binding.sh"
fmlab_find_duckdb | tr -d '\n'
