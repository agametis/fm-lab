#!/usr/bin/env bash
#
# cluster.sh — Community-Detection batch (P5)
#
# Builds ObjectClusters + CommunityNames in the master DB from the cleaned
# logical graph. Engine: Louvain (Node/graphology) by default, Leiden
# (Python/igraph) when available. Standalone batch — NOT a convert-xml phase
# yet (wire in only after the perf numbers below justify it).
#
# Pipeline:
#   1. duckdb master < graph_export_logical.sql   → edges.csv  (logical, no builtins/orphans)
#   2. <engine>      edges.csv communities.csv     → node→community
#   3. duckdb master . cluster_load.sql            → ObjectClusters + CommunityNames (heuristic names)
#   4. (opt) sync master → rest-api/db + /api/admin/reload
#
# Env knobs:
#   FMLAB_CLUSTER_ENGINE      auto | leiden | louvain     (default auto)
#   FMLAB_CLUSTER_RESOLUTION  Louvain/Leiden resolution   (default 1.0)
#   FMLAB_CLUSTER_SEED        PRNG seed (reproducible)     (default 42)
#   FMLAB_CLUSTER_NO_SYNC     set to 1 to skip rest-api sync/reload
#   REST_API_RELOAD_URL       reload endpoint              (default localhost:3003)
#
# bash-3.2 compatible (macOS system bash): no `case` inside $(…), no bash-4+ features.

set -u

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DB_FILE="$PROJECT_ROOT/db/fm_catalog.duckdb"
EXPORT_SQL="$SCRIPT_DIR/graph_export_logical.sql"
LOAD_SQL="$SCRIPT_DIR/cluster_load.sql"

RESOLUTION="${FMLAB_CLUSTER_RESOLUTION:-1.0}"
SEED="${FMLAB_CLUSTER_SEED:-42}"
# rest-api sync paths/URL live in sync_db.sh (step 5 delegates to it).

# ── Locate duckdb (CLAUDE.md well-known locations) ──────────────────────────
DUCKDB=""
if command -v duckdb >/dev/null 2>&1; then
  DUCKDB="$(command -v duckdb)"
elif [ -x "$HOME/.duckdb/cli/latest/duckdb" ]; then
  DUCKDB="$HOME/.duckdb/cli/latest/duckdb"
elif [ -x "/opt/homebrew/bin/duckdb" ]; then
  DUCKDB="/opt/homebrew/bin/duckdb"
elif [ -x "/usr/local/bin/duckdb" ]; then
  DUCKDB="/usr/local/bin/duckdb"
else
  echo "ERROR: duckdb binary not found (see CLAUDE.md for install locations)." >&2
  exit 3
fi

if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: master DB not found at $DB_FILE — run convert-xml first." >&2
  exit 4
fi

# ── Engine detection / dispatch ─────────────────────────────────────────────
ENGINE="${FMLAB_CLUSTER_ENGINE:-auto}"
if [ "$ENGINE" = "auto" ]; then
  if command -v python3 >/dev/null 2>&1 && python3 -c "import igraph" >/dev/null 2>&1; then
    ENGINE="leiden"
  else
    ENGINE="louvain"   # guaranteed Node/npm fallback
  fi
elif [ "$ENGINE" = "leiden" ]; then
  if ! { command -v python3 >/dev/null 2>&1 && python3 -c "import igraph" >/dev/null 2>&1; }; then
    echo "ERROR: FMLAB_CLUSTER_ENGINE=leiden but python3+igraph not available." >&2
    exit 5
  fi
fi
echo "cluster engine: $ENGINE (resolution=$RESOLUTION seed=$SEED)"

# ── Work dir (temp CSVs land here; duckdb COPY/read_csv are CWD-relative) ────
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/fmlab-cluster.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT
cd "$WORKDIR" || { echo "ERROR: cannot enter workdir $WORKDIR" >&2; exit 6; }

# ── 1) Export cleaned logical edges → edges.csv ─────────────────────────────
echo "→ exporting logical edges …"
T_EXPORT_START=$(date +%s)
if ! "$DUCKDB" "$DB_FILE" -readonly < "$EXPORT_SQL"; then
  echo "ERROR: edge export failed (is the master DB locked by convert-xml?)." >&2
  exit 7
fi
EDGE_COUNT=$(($(wc -l < edges.csv) - 1))
T_EXPORT_END=$(date +%s)
echo "  edges.csv: $EDGE_COUNT edges in $((T_EXPORT_END - T_EXPORT_START))s"

# ── 2) Cluster → communities.csv ────────────────────────────────────────────
echo "→ clustering ($ENGINE) …"
T_CLUSTER_START=$(date +%s)
if [ "$ENGINE" = "leiden" ]; then
  python3 "$SCRIPT_DIR/cluster_leiden.py" edges.csv communities.csv "$RESOLUTION" "$SEED" || {
    echo "ERROR: leiden clustering failed." >&2; exit 8; }
else
  node "$SCRIPT_DIR/cluster_louvain.mjs" edges.csv communities.csv "$RESOLUTION" "$SEED" || {
    echo "ERROR: louvain clustering failed." >&2; exit 8; }
fi
T_CLUSTER_END=$(date +%s)
echo "  clustering wall-clock: $((T_CLUSTER_END - T_CLUSTER_START))s"

# ── 3) Load communities + build heuristic names ─────────────────────────────
echo "→ loading ObjectClusters + CommunityNames …"
"$DUCKDB" "$DB_FILE" <<SQL || { echo "ERROR: cluster load failed." >&2; exit 9; }
SET VARIABLE engine = '$ENGINE';
.read $LOAD_SQL
SQL

# ── 4) Report ───────────────────────────────────────────────────────────────
echo "→ result:"
"$DUCKDB" "$DB_FILE" -readonly -c "
  SELECT
    (SELECT COUNT(*) FROM ObjectClusters)                       AS clustered_objects,
    (SELECT COUNT(*) FROM CommunityNames)                       AS communities,
    (SELECT MAX(Member_Count) FROM CommunityNames)              AS largest_community,
    (SELECT ROUND(AVG(Member_Count), 1) FROM CommunityNames)    AS avg_size;
  SELECT Community, Member_Count, Dominant_Type, Heuristic_Name
  FROM CommunityNames ORDER BY Member_Count DESC LIMIT 8;
"

# ── 5) Sync master → rest-api copy + reload (optional) ──────────────────────
# Sync logic lives in sync_db.sh (reused by the fm-graph-cluster skill); the
# NO_SYNC gate stays here so cluster.sh's own behaviour is unchanged.
if [ "${FMLAB_CLUSTER_NO_SYNC:-0}" != "1" ]; then
  bash "$SCRIPT_DIR/sync_db.sh" "$DB_FILE" || echo "  WARN: sync step failed" >&2
fi

echo "done."
