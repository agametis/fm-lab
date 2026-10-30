# duckdb_binding.sh — compares the DuckDB CLI with the DuckDB the REST API bundles.
# Source this file (do not execute); the caller must have PROJECT_ROOT set.
#
# The REST API reads catalogs through @duckdb/node-api, which ships its OWN
# libduckdb — independent of the CLI the converter writes with. DuckDB storage is
# only backward readable: a catalog written by a newer CLI (e.g. 2.0 → storage
# version 69) cannot be opened by an older binding (1.5.x reads 64–68), and the
# web frontend then reports STORAGE_VERSION_MISMATCH. Patch releases never change
# the storage format, so only major.minor is compared.
#
# Contract of fmlab_duckdb_binding_mismatch <cli --version output>:
#   return 0 when the CLI is on a newer major.minor than the binding, and set
#     FMLAB_DUCKDB_CLI_VER      e.g. 2.0.0
#     FMLAB_DUCKDB_BINDING_VER  e.g. 1.5.6
#   return 1 otherwise — also when either version is unreadable (never a false alarm).
#
# fmlab_find_duckdb echoes the DuckDB CLI to use and returns 1 when there is none:
# PATH first, then the installer's ~/.duckdb/cli/latest, then its newest version
# folder ~/.duckdb/cli/<x.y.z> (a pinned install via DUCKDB_VERSION=… leaves `latest`
# alone and may be the only install), then Homebrew and /usr/local. The installer
# writes no PATH entry into shell profiles, so terminal runs often land in the
# fallbacks. Does not need PROJECT_ROOT.
#
# fmlab_duckdb_storage_version echoes the storage format fm-lab writes for every
# DuckDB file it creates: FMLAB_DUCKDB_STORAGE_VERSION if set, else
# ingestion/version_check.json → tested_baseline.storage_compatibility_version,
# else v1.0.0 (storage 64, readable by every DuckDB ≥ 1.0). Callers pass it as the
# CLI start flag `-storage-version` — a SET inside the session comes too late for
# the database the CLI opens at start. Existing files keep their format.
#
# bash-3.2 compatible (macOS system bash): no bash-4+ features.

# First dotted version in a string: "v1.5.6 (Variegata) 069cc9f9b5" → 1.5.6,
# "^1.5.6-r.2" → 1.5.6. Empty when there is none.
_fmlab_dotted_version() {
    printf '%s' "$1" | sed -n -E 's/^[^0-9]*([0-9]+\.[0-9]+(\.[0-9]+)?).*/\1/p' | head -1
}

# DuckDB version of the REST API binding: the installed package first (npm
# workspaces hoist it to the root), else the version pinned in
# rest-api/package.json (fresh install before npm install).
fmlab_duckdb_binding_version() {
    local f raw=""
    for f in "$PROJECT_ROOT/rest-api/node_modules/@duckdb/node-api/package.json" \
             "$PROJECT_ROOT/node_modules/@duckdb/node-api/package.json"; do
        if [ -f "$f" ]; then
            raw=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -1)
            [ -n "$raw" ] && break
        fi
    done
    if [ -z "$raw" ] && [ -f "$PROJECT_ROOT/rest-api/package.json" ]; then
        raw=$(sed -n 's/.*"@duckdb\/node-api"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_ROOT/rest-api/package.json" | head -1)
    fi
    _fmlab_dotted_version "$raw"
}

fmlab_duckdb_binding_mismatch() {
    local cli binding cli_major cli_minor b_major b_minor
    cli=$(_fmlab_dotted_version "$1")
    binding=$(fmlab_duckdb_binding_version)
    [ -n "$cli" ] && [ -n "$binding" ] || return 1
    cli_major=${cli%%.*};     cli_minor=${cli#*.};     cli_minor=${cli_minor%%.*}
    b_major=${binding%%.*};   b_minor=${binding#*.};   b_minor=${b_minor%%.*}
    if [ "$cli_major" -gt "$b_major" ] || \
       { [ "$cli_major" -eq "$b_major" ] && [ "$cli_minor" -gt "$b_minor" ]; }; then
        FMLAB_DUCKDB_CLI_VER="$cli"
        FMLAB_DUCKDB_BINDING_VER="$binding"
        return 0
    fi
    return 1
}

fmlab_duckdb_storage_version() {
    local v="${FMLAB_DUCKDB_STORAGE_VERSION:-}" f="$PROJECT_ROOT/ingestion/version_check.json"
    if [ -z "$v" ] && [ -f "$f" ]; then
        v=$(sed -n 's/.*"storage_compatibility_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -1)
    fi
    printf '%s' "${v:-v1.0.0}"
}

fmlab_find_duckdb() {
    local c v dir="${HOME:-/nonexistent}/.duckdb/cli"
    if c=$(command -v duckdb 2>/dev/null) && [ -n "$c" ]; then
        printf '%s\n' "$c"; return 0
    fi
    if [ -x "$dir/latest/duckdb" ]; then
        printf '%s\n' "$dir/latest/duckdb"; return 0
    fi
    v=$(ls -1 "$dir" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
        | sort -t. -k1,1n -k2,2n -k3,3n \
        | while read -r d; do [ -x "$dir/$d/duckdb" ] && echo "$d"; done | tail -1)
    if [ -n "$v" ]; then
        printf '%s\n' "$dir/$v/duckdb"; return 0
    fi
    for c in /opt/homebrew/bin/duckdb /usr/local/bin/duckdb; do
        if [ -x "$c" ]; then printf '%s\n' "$c"; return 0; fi
    done
    return 1
}
