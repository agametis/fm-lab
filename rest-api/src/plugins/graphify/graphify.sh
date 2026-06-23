#!/usr/bin/env bash
# graphify — CLI wrapper (optional, independent parallel entry point).
#
# This is a THIN wrapper over the shared kernel `export-graph.mjs` — the exact
# same script the REST backend spawns. It exists only for convenience on the
# command line; the web export does NOT depend on it, and removing this file
# leaves the backend fully functional. All real logic lives in the Node kernel.
#
# Usage:
#   tools side : ./graphify.sh [--out-dir <dir>] [--out <file>] [--db <path>]
#   from repo  : bash rest-api/src/plugins/graphify/graphify.sh
#
# Output: output/graph_export_<timestamp>.json  (a { meta, nodes, edges } graph).
#
# bash-3.2 compatible (macOS default): no `case` in $(...), no bash-4+ features.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$SCRIPT_DIR/export-graph.mjs"

if [ ! -f "$KERNEL" ]; then
  echo "graphify: kernel not found at $KERNEL" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "graphify: node is required but was not found in PATH" >&2
  exit 1
fi

# Human-readable mode by default (kernel logs progress to stderr). Pass --ndjson
# explicitly for machine-readable output. All args are forwarded verbatim.
exec node "$KERNEL" "$@"
