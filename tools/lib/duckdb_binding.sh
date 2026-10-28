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
