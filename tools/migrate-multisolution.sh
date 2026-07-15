#!/usr/bin/env bash
# migrate-multisolution.sh — one-time, idempotent migration of a flat fm-lab
# workspace (xml/ + db/fm_catalog.duckdb) to the multi-solution bundle layout:
#
#   solutions/<id>/
#     solution.json          manifest (schema v1)
#     xml/                   XML inbox of this solution
#     db/                    master fm_catalog.duckdb + fm_annotations.duckdb
#     state/                 per-solution runtime state (locks, run files, logs/)
#       streaming/           incremental-import manifests (manifest_/chunkmap_)
#
# The existing flat content becomes the solution "default". Compatibility
# symlinks are left at db/fm_catalog.duckdb and db/fm_annotations.duckdb so
# every read-only consumer (skills, ad-hoc SQL, quality test) keeps working
# on the ACTIVE solution unchanged. rest-api/db/fm_catalog.duckdb becomes a
# symlink into rest-api/db/solutions/default/ for the same reason.
#
# The pointer file .fmlab/active_solution.json is the machine-readable source
# of truth for "which solution is active"; the symlinks are its projection.
#
# Usage:
#   tools/migrate-multisolution.sh [--yes] [--dry-run]
#
#   --yes      no interactive confirmation for moving xml/*.xml
#   --dry-run  print what would be done, change nothing
#
# Safe to re-run: every step checks whether it already happened.
# NOTE: stop the REST API before running (annotations DB is RW + WAL — a
# checkpoint during the move could recreate the WAL at the old path).
set -u

PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd))"
cd "$PROJECT_ROOT"

SOL_ID="default"
SOL_DIR="solutions/$SOL_ID"
ASSUME_YES=false
DRY_RUN=false
for arg in "$@"; do
    case "$arg" in
        --yes) ASSUME_YES=true ;;
        --dry-run) DRY_RUN=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

log()  { echo "[migrate] $*"; }
doit() { if $DRY_RUN; then echo "[dry-run] $*"; else "$@"; fi; }

# Refuse to run while the REST API holds the annotations DB open (RW + WAL).
if curl -s -m 1 -o /dev/null "http://localhost:3003/api/info" 2>/dev/null; then
    echo "ERROR: REST API is running on port 3003. Stop it first (rest-api-stop /"
    echo "       tools/stop-servers.sh api), then re-run this script."
    exit 1
fi

# ── 1. Bundle skeleton ───────────────────────────────────────────────────────
doit mkdir -p "$SOL_DIR/xml" "$SOL_DIR/db" "$SOL_DIR/state/logs" "$SOL_DIR/state/streaming"

# ── 2. Manifest (schema v1) — only the user-owned root block; convert-xml
#       stamps the technical/metrics blocks on the next import. ──────────────
if [ ! -f "$SOL_DIR/solution.json" ]; then
    UUID=$( (command -v uuidgen >/dev/null && uuidgen) || python3 -c 'import uuid;print(uuid.uuid4())' )
    NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    log "creating $SOL_DIR/solution.json (uuid=$UUID)"
    if ! $DRY_RUN; then
        cat > "$SOL_DIR/solution.json" <<EOF
{
  "manifest_version": 1,
  "uuid": "$UUID",
  "id": "$SOL_ID",
  "display_name": "Default",
  "description": "",
  "maintainer": "",
  "url": "",
  "contact": { "name": "", "email": "" },
  "created_at": "$NOW",
  "notes": "Migrated from the flat single-solution workspace layout."
}
EOF
    fi
else
    log "manifest exists — skipping"
fi

# ── 3. Master DBs → bundle, symlinks at the old location ─────────────────────
# mv within the same mount is a cheap rename; NEVER cp+rm for multi-GB DBs.
move_and_link() { # $1 = filename under db/
    local f="$1"
    if [ -f "db/$f" ] && [ ! -L "db/$f" ]; then
        log "moving db/$f → $SOL_DIR/db/$f"
        doit mv "db/$f" "$SOL_DIR/db/$f"
        [ -f "db/$f.wal" ] && { log "moving db/$f.wal"; doit mv "db/$f.wal" "$SOL_DIR/db/$f.wal"; }
        doit ln -s "../$SOL_DIR/db/$f" "db/$f"
    elif [ -L "db/$f" ]; then
        log "db/$f is already a symlink — skipping"
    else
        log "db/$f does not exist — skipping (fresh workspace)"
    fi
}
move_and_link fm_catalog.duckdb
move_and_link fm_annotations.duckdb

# ── 4. Incremental-import manifests (keyed by DB filename → would collide
#       across solutions) → per-solution state/streaming/ ────────────────────
for f in manifest_fm_catalog.duckdb chunkmap_fm_catalog.duckdb; do
    if [ -f "db/streaming/$f" ]; then
        log "moving db/streaming/$f → $SOL_DIR/state/streaming/$f"
        doit mv "db/streaming/$f" "$SOL_DIR/state/streaming/$f"
    fi
done

# ── 5. XML inbox ─────────────────────────────────────────────────────────────
if [ -d xml ] && ls xml/*.xml >/dev/null 2>&1; then
    n=$(ls xml/*.xml | wc -l | tr -d ' ')
    if ! $ASSUME_YES && ! $DRY_RUN; then
        printf "Move %s XML file(s) from xml/ to %s/xml/? [y/N] " "$n" "$SOL_DIR"
        read -r answer
        case "$answer" in y|Y|yes|Yes) ;; *) echo "Skipped xml/ move (re-run with --yes)."; n="" ;; esac
    fi
    if [ -n "$n" ]; then
        log "moving $n XML file(s) → $SOL_DIR/xml/"
        doit bash -c 'mv xml/*.xml "'"$SOL_DIR"'/xml/"'
    fi
fi
# The top-level xml/ is retired for good once empty (no xml symlink:
# a silently re-pointed WRITE interface would drop exports into the wrong solution).
if [ -d xml ] && ! ls xml/*.xml >/dev/null 2>&1; then
    doit rm -f xml/.DS_Store
    if $DRY_RUN || rmdir xml 2>/dev/null; then
        log "removed empty top-level xml/"
    else
        log "WARNING: xml/ not empty (non-XML leftovers) — inspect and remove manually"
    fi
fi

# ── 6. Per-solution runtime state out of .fmlab/ ─────────────────────────────
for f in last_xml_run.json cluster.json cluster_run.json; do
    if [ -f ".fmlab/$f" ]; then
        log "moving .fmlab/$f → $SOL_DIR/state/$f"
        doit mv ".fmlab/$f" "$SOL_DIR/state/$f"
    fi
done

# ── 7. REST-API read copy → rest-api/db/solutions/<id>/ (symlink for the
#       transition; the next convert-xml sync writes the real target). ───────
if [ -f rest-api/db/fm_catalog.duckdb ] && [ ! -L rest-api/db/fm_catalog.duckdb ]; then
    doit mkdir -p "rest-api/db/solutions/$SOL_ID"
    log "moving rest-api/db/fm_catalog.duckdb → rest-api/db/solutions/$SOL_ID/"
    doit mv rest-api/db/fm_catalog.duckdb "rest-api/db/solutions/$SOL_ID/fm_catalog.duckdb"
    doit ln -s "solutions/$SOL_ID/fm_catalog.duckdb" rest-api/db/fm_catalog.duckdb
elif [ -L rest-api/db/fm_catalog.duckdb ]; then
    log "rest-api/db/fm_catalog.duckdb is already a symlink — skipping"
fi

# ── 8. Active-solution pointer (source of truth for the switch) ──────────────
if [ ! -f .fmlab/active_solution.json ]; then
    NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    log "writing .fmlab/active_solution.json (active=$SOL_ID)"
    if ! $DRY_RUN; then
        mkdir -p .fmlab
        printf '{\n  "active": "%s",\n  "switched_at": "%s"\n}\n' "$SOL_ID" "$NOW" > .fmlab/active_solution.json
    fi
else
    log "pointer file exists — skipping"
fi

log "done. Layout:"
$DRY_RUN || ls -la "$SOL_DIR" "$SOL_DIR/db" db/fm_catalog.duckdb db/fm_annotations.duckdb 2>/dev/null
