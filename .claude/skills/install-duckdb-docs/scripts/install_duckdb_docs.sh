#!/bin/bash
# DuckDB Documentation Installation Script
#
# This script downloads and installs DuckDB documentation as a single Markdown file.
# It handles version checking, user prompts, and automatic cleanup.
#
# Usage: install_duckdb_docs.sh [--check|--install] [--quiet] [--force]
#
# Parameters:
#   --check:   Probe-only mode. Emits a single check-event with
#              {installed, local_version, remote_version, update_available} and exits.
#   --install: Run the installation workflow (default if no mode is given).
#   --quiet:   Emit NDJSON events instead of plain log lines. Bypasses
#              interactive prompts (treats every confirmation as yes).
#   --force:   Skip version check and prompts, force reinstallation.
#
# Exit codes:
#   0 - Success (installed or already up to date)
#   1 - User cancelled installation
#   2 - Download failed
#   4 - Copy operation failed

# Constants
PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd))"
DOCS_DIR="$PROJECT_ROOT/docs/duckdb"
DOCS_TARGET="$DOCS_DIR/Documents"
VERSION_FILE="$DOCS_DIR/.version"
DOCS_URL="https://blobs.duckdb.org/docs/duckdb-docs.md"
DOCS_FILENAME="duckdb-docs.md"

# Shared mode helpers (--check/--install/--quiet + emit_log/emit_progress/...)
# shellcheck source=/dev/null
source "$PROJECT_ROOT/tools/install_modes.sh"

QUIET_MODE=false; CHECK_MODE=false; INSTALL_MODE=false
REMAINING_ARGS=()
parse_install_modes "$@"
set -- "${REMAINING_ARGS[@]}"

FORCE_INSTALL=false
for arg in "$@"; do
    case "$arg" in
        --force) FORCE_INSTALL=true ;;
        '') ;;
        *)
            emit_error "Unknown argument: $arg"
            exit 1
            ;;
    esac
done

# Function: Detect whether the duckdb-skills plugin (duckdb-docs skill) is present.
# Sets the global PLUGIN_PRESENT to "true"/"false".
#
# We probe the on-disk plugin tree for the duckdb-docs SKILL.md rather than
# parsing ~/.claude/plugins/installed_plugins.json: that manifest records host
# install paths (e.g. /Users/<name>/.claude/...) which do not resolve inside the
# dev container, whereas the marketplace/cache copies of the skill do.
detect_duckdb_plugin() {
    local cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
    PLUGIN_PRESENT=false
    if [ -d "$cfg/plugins" ] && \
       find "$cfg/plugins" -name SKILL.md -path '*duckdb-skills*duckdb-docs*' \
            -print -quit 2>/dev/null | grep -q .; then
        PLUGIN_PRESENT=true
    fi
}

# Function: Get remote file timestamp
get_remote_timestamp() {
    curl -sI "$DOCS_URL" | grep -i "^last-modified:" | sed 's/last-modified: //i' | tr -d '\r'
}

# Returns 0 (truthy) iff $1 (remote RFC-1123 date) is strictly newer than $2 (local).
remote_newer_than_local() {
    local remote="$1" local_v="$2"
    [ -n "$remote" ] || return 1
    [ -n "$local_v" ] || return 0
    local rts lts
    rts=$(date -j -f "%a, %d %b %Y %T %Z" "$remote" "+%s" 2>/dev/null || date -d "$remote" "+%s" 2>/dev/null || echo "")
    lts=$(date -j -f "%a, %d %b %Y %T %Z" "$local_v" "+%s" 2>/dev/null || date -d "$local_v" "+%s" 2>/dev/null || echo "")
    [ -n "$rts" ] && [ -n "$lts" ] && [ "$rts" -gt "$lts" ]
}

# --check mode
run_check_mode() {
    local installed="false" local_version="" remote_version="" update_available="false"

    if [ -f "$DOCS_TARGET/$DOCS_FILENAME" ]; then
        installed="true"
    fi
    if [ -f "$VERSION_FILE" ]; then
        local_version=$(cat "$VERSION_FILE")
    fi
    remote_version=$(get_remote_timestamp || true)

    if [ "$installed" = "false" ]; then
        update_available="true"
    elif remote_newer_than_local "$remote_version" "$local_version"; then
        update_available="true"
    fi

    detect_duckdb_plugin

    emit_check "$installed" "$local_version" "$remote_version" "$update_available" \
        plugin_present "bool=$PLUGIN_PRESENT"
    if ! $QUIET_MODE; then
        echo "  plugin present:   $PLUGIN_PRESENT (duckdb-skills:duckdb-docs)"
    fi
    exit 0
}

# Refresh CDN-pinned firewall IPs before any network op — duckdb.org is
# Cloudflare-fronted (rotating anycast). No-op outside a firewalled container;
# see tools/install_modes.sh::refresh_firewall_allowlist.
refresh_firewall_allowlist

if $CHECK_MODE; then
    run_check_mode
fi

# Function: Check if update is needed
check_version() {
    # Redundancy note: if the duckdb-skills plugin is present it already provides
    # on-demand DuckDB doc search (CLAUDE.md §7). The local mirror is then only
    # needed for the web frontend's Docs card, so surface that before installing.
    if [ "$FORCE_INSTALL" = false ]; then
        detect_duckdb_plugin
        if [ "$PLUGIN_PRESENT" = true ]; then
            emit_warn "The 'duckdb-skills' plugin is installed and already provides on-demand DuckDB documentation search (see CLAUDE.md §7). This local ~15 MB Markdown mirror is only still needed for the web frontend's Docs card."
        fi
    fi

    if [ ! -f "$DOCS_TARGET/$DOCS_FILENAME" ]; then
        # Fresh install has no other confirmation step, so gate it here when the
        # plugin already makes the mirror redundant.
        if [ "$FORCE_INSTALL" = false ] && [ "${PLUGIN_PRESENT:-false}" = true ]; then
            if ! confirm_or_quiet "Install the local DuckDB docs mirror anyway?"; then
                emit_log "Installation cancelled by user"
                emit_done false "Cancelled (plugin already provides DuckDB docs)"
                exit 1
            fi
        fi
        emit_log "No existing docs found. Installing DuckDB documentation..."
        return 0
    fi

    if [ "$FORCE_INSTALL" = true ]; then
        emit_log "Force installation requested. Reinstalling DuckDB documentation..."
        return 0
    fi

    emit_progress check 10 "Checking for updates..."

    REMOTE_DATE=$(get_remote_timestamp)
    if [ -z "$REMOTE_DATE" ]; then
        emit_error "Failed to retrieve remote version information"
        exit 2
    fi

    if [ -f "$VERSION_FILE" ]; then
        LOCAL_DATE=$(cat "$VERSION_FILE")

        if ! remote_newer_than_local "$REMOTE_DATE" "$LOCAL_DATE"; then
            # Self-heal: docs current but manifest lost its installed[] entry (e.g. a
            # git pull reset a tracked .fmlab/docs.json). Re-register from the on-disk
            # files — no download — instead of exiting blind and staying invisible.
            if ! docs_is_registered duckdb; then
                emit_log "Docs present but missing from .fmlab/docs.json — re-registering (self-heal)."
                register_docs
                emit_done true "Re-registered (already up to date)"
                exit 0
            fi
            emit_log "Docs are up to date (version: $LOCAL_DATE). No action needed."
            emit_done true "Already up to date"
            exit 0
        fi

        emit_log "Newer version available. Current: $LOCAL_DATE — Remote: $REMOTE_DATE"
        if ! confirm_or_quiet "Replace existing docs?"; then
            emit_log "Installation cancelled by user"
            emit_done false "Cancelled by user"
            exit 1
        fi
    else
        emit_warn "Existing documentation found (no version information). Remote: $REMOTE_DATE"
        if ! confirm_or_quiet "Replace existing docs?"; then
            emit_log "Installation cancelled by user"
            emit_done false "Cancelled by user"
            exit 1
        fi
    fi

    return 0
}

# Function: Download DuckDB documentation
download_docs() {
    emit_progress download 30 "Downloading from $DOCS_URL"

    if [ -z "$DOCS_DIR" ]; then
        emit_error "DOCS_DIR is not set. Aborting for safety."
        exit 4
    fi

    if [[ ! "$DOCS_DIR" == *"/docs/duckdb" ]]; then
        emit_error "DOCS_DIR does not match expected pattern (/docs/duckdb). Value: $DOCS_DIR"
        exit 4
    fi

    case "$DOCS_DIR" in
        /|/bin|/etc|/usr|/var|/System|/Library|/Applications|$HOME)
            emit_error "DOCS_DIR points to a protected directory. Aborting for safety."
            exit 4
            ;;
    esac

    mkdir -p "$DOCS_TARGET"
    if [ $? -ne 0 ]; then
        emit_error "Failed to create target directory: $DOCS_TARGET"
        exit 4
    fi

    if $QUIET_MODE; then
        curl -sL -o "$DOCS_TARGET/$DOCS_FILENAME" "$DOCS_URL"
        local rc=$?
    else
        curl -L -o "$DOCS_TARGET/$DOCS_FILENAME" "$DOCS_URL" 2>&1 | grep -v "^  "
        local rc=${PIPESTATUS[0]}
    fi

    if [ $rc -ne 0 ]; then
        emit_error "Download failed"
        exit 2
    fi

    # Verify file was downloaded and has reasonable size (should be > 100KB)
    FILE_SIZE=$(stat -f%z "$DOCS_TARGET/$DOCS_FILENAME" 2>/dev/null || stat -c%s "$DOCS_TARGET/$DOCS_FILENAME" 2>/dev/null || echo "0")
    if [ "$FILE_SIZE" -lt 100000 ]; then
        emit_error "Downloaded file is too small ($FILE_SIZE bytes). Download may have failed."
        rm -f "$DOCS_TARGET/$DOCS_FILENAME"
        exit 2
    fi

    emit_progress download 80 "Download complete ($(echo "scale=1; $FILE_SIZE / 1024 / 1024" | bc) MB)"
}

# Function: Save version marker
save_version() {
    REMOTE_DATE=$(get_remote_timestamp)
    echo "$REMOTE_DATE" > "$VERSION_FILE"

    if [ $? -ne 0 ]; then
        emit_warn "Failed to create version marker file"
    fi
}

# Function: Register the installed docs in .fmlab/docs.json
register_docs() {
    REGISTER_SCRIPT="$PROJECT_ROOT/tools/register_docs.py"
    if [ ! -f "$REGISTER_SCRIPT" ]; then
        return 0
    fi
    if ! command -v python3 &> /dev/null; then
        return 0
    fi

    # H1 sections in the markdown doc = top-level chapters.
    H1_COUNT=$(grep -c '^# ' "$DOCS_TARGET/$DOCS_FILENAME" 2>/dev/null || echo "")

    python3 "$REGISTER_SCRIPT" \
        --id duckdb \
        --name "DuckDB" \
        --description "DuckDB SQL reference, single-page documentation export." \
        --directory "docs/duckdb" \
        --skill install-duckdb-docs \
        --source-url "https://duckdb.org/docs" \
        --categories "${H1_COUNT:-none}" \
        --functions none \
        --languages en \
        || echo "WARNING: register_docs.py failed (non-fatal)."
}

# Function: Get installation statistics
get_stats() {
    if [ -f "$DOCS_TARGET/$DOCS_FILENAME" ]; then
        FILE_SIZE=$(stat -f%z "$DOCS_TARGET/$DOCS_FILENAME" 2>/dev/null || stat -c%s "$DOCS_TARGET/$DOCS_FILENAME" 2>/dev/null || echo "0")
        LINE_COUNT=$(wc -l < "$DOCS_TARGET/$DOCS_FILENAME" 2>/dev/null | tr -d ' ')
        echo "($(echo "scale=1; $FILE_SIZE / 1024 / 1024" | bc) MB, $LINE_COUNT lines)"
    fi
}

# Main workflow
main() {
    # Step 1: Check version and prompt user if needed
    check_version

    # Step 2: Download documentation (directly to target)
    download_docs

    # Step 3: Save version marker
    save_version

    # Step 4: Register in .fmlab/docs.json (for web home dashboard)
    emit_progress register 95 "Updating .fmlab/docs.json..."
    register_docs

    # Step 5: Report success
    REMOTE_DATE=$(get_remote_timestamp)
    STATS=$(get_stats)

    if $QUIET_MODE; then
        emit_done true "DuckDB documentation installed (version $REMOTE_DATE)"
    else
        echo ""
        echo "SUCCESS: DuckDB documentation installed successfully"
        echo "Version: $REMOTE_DATE"
        echo "Location: $DOCS_TARGET"
        [ -n "$STATS" ] && echo "Files: $STATS"
    fi

    exit 0
}

# Execute main workflow
main
