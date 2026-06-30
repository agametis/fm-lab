#!/usr/bin/env bash
# Prepare the node_modules named volumes for `npm install`.
#
# Why this exists: in docker-compose.yml / the published devcontainer.json every
# workspace node_modules directory is backed by its own Docker named volume, so the
# host's (macOS/Windows) node_modules is NOT bind-mounted into the Linux container
# (which would drag in wrong-platform native bindings — @duckdb/node-bindings,
# @rollup/rollup-*, @esbuild/*, better-sqlite3, @unrs/resolver, ...). npm-workspaces
# hoisting is incomplete: native binaries live in BOTH the root node_modules AND
# rest-api/node_modules, so isolating only the root is not enough — every workspace
# gets its own volume.
#
# An empty named volume is created owned by root, so the unprivileged `node` user
# (which runs `npm install`) cannot write into it. This script — run via sudo — hands
# the mount points to `node`. It is idempotent and safe to run repeatedly.
#
# NOTE: only node_modules is volume-backed. packages/shared/{dist,generated} are
# platform-independent build artifacts consumed across the bind mount and must stay
# on the bind mount (so host and container share the same build); they are
# deliberately NOT listed here.
set -euo pipefail

WS="${1:-/workspaces/fm-lab}"

# One entry per named volume declared in docker-compose.yml / devcontainer.json.
DIRS=(
  "$WS/node_modules"
  "$WS/rest-api/node_modules"
  "$WS/apps/web/node_modules"
  "$WS/packages/shared/node_modules"
)

for dir in "${DIRS[@]}"; do
  mkdir -p "$dir"
  # -R covers the rare case where Docker seeded the volume from bind-mount content
  # (root-owned children); on a fresh empty volume this is instant.
  chown -R node:node "$dir"
done

echo "init-node-modules: ownership set for ${#DIRS[@]} node_modules volume(s)."

# DuckDB spill volume (target=/duckdb_spill, env DUCKDB_TEMP_DIR). "node" here means
# the OS USER (uid 1000), NOT the Node.js runtime: the DuckDB-CLI ingestion runs as
# this user and must be able to write to /duckdb_spill. Docker creates the empty
# named volume root-owned → without chown, spilling fails with permission-denied.
# Idempotent; only run when the volume is mounted.
SPILL_DIR="/duckdb_spill"
if [ -d "$SPILL_DIR" ]; then
  chown node:node "$SPILL_DIR"
  echo "init-node-modules: ownership set for DuckDB spill volume ($SPILL_DIR)."
fi
