#!/usr/bin/env bash
# Shared DuckDB-binary resolver. Echoes the resolved `duckdb` path (empty if none found).
# Single source of the fallback chain for skills that must capture the binary into a
# variable (e.g. fm-graph-cluster orchestrating its own tooling). Skills using the plain
# `duckdb db/fm_catalog.duckdb -c "…"` invocation do NOT need this — see CLAUDE.md §2 /
# docs/agents/tooling.md. Never install DuckDB.
DUCKDB="$(command -v duckdb || true)"
[ -z "$DUCKDB" ] && [ -x "$HOME/.duckdb/cli/latest/duckdb" ] && DUCKDB="$HOME/.duckdb/cli/latest/duckdb"
[ -z "$DUCKDB" ] && [ -x /opt/homebrew/bin/duckdb ]        && DUCKDB=/opt/homebrew/bin/duckdb
[ -z "$DUCKDB" ] && [ -x /usr/local/bin/duckdb ]           && DUCKDB=/usr/local/bin/duckdb
printf '%s' "$DUCKDB"
