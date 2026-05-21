#!/bin/bash
# MBS Documentation Installation Script
#
# This script downloads and installs MBS Plugin documentation from MonkeyBread Software.
# It handles version checking, user prompts, and automatic cleanup.
#
# Usage: install_mbs_docs.sh [--check|--install] [--quiet] [--force]
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
#   3 - Extraction failed
#   4 - Copy operation failed
#   5 - Failed to create temporary directory

# Constants
PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd))"
DOCS_DIR="$PROJECT_ROOT/docs/mbs"
VERSION_FILE="$DOCS_DIR/.version"
ZIP_URL="https://www.monkeybreadsoftware.com/filemaker/Dash/MBS.zip"
DOCSET_PATH="MBS.docset/Contents/Resources"

# Shared mode helpers (--check/--install/--quiet + emit_log/emit_progress/...)
# shellcheck source=/dev/null
source "$PROJECT_ROOT/tools/install_modes.sh"

# Parse arguments — split off shared modes first, then handle leftover flags.
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

# Create temporary working directory
TEMP_DIR=$(mktemp -d) || {
    emit_error "Failed to create temporary directory"
    exit 5
}
trap "rm -rf '$TEMP_DIR'" EXIT  # Ensure cleanup on exit

# Function: Get remote file timestamp
get_remote_timestamp() {
    curl -sI "$ZIP_URL" | grep -i "^last-modified:" | sed 's/last-modified: //i' | tr -d '\r'
}

# Function: Compare two RFC-1123 dates ("Mon, 12 May 2026 07:57:32 GMT").
# Returns 0 (truthy) iff $1 (remote) is strictly newer than $2 (local).
remote_newer_than_local() {
    local remote="$1" local_v="$2"
    [ -n "$remote" ] || return 1
    [ -n "$local_v" ] || return 0
    local rts lts
    rts=$(date -j -f "%a, %d %b %Y %T %Z" "$remote" "+%s" 2>/dev/null || echo "")
    lts=$(date -j -f "%a, %d %b %Y %T %Z" "$local_v" "+%s" 2>/dev/null || echo "")
    [ -n "$rts" ] && [ -n "$lts" ] && [ "$rts" -gt "$lts" ]
}

# --check mode: probe installation + remote version, emit a check-event, exit.
run_check_mode() {
    local installed="false" local_version="" remote_version="" update_available="false"

    if [ -f "$DOCS_DIR/docSet.dsidx" ]; then
        installed="true"
    fi
    if [ -f "$VERSION_FILE" ]; then
        local_version=$(cat "$VERSION_FILE")
    fi
    remote_version=$(get_remote_timestamp || true)

    if [ "$installed" = "false" ]; then
        update_available="true"  # nothing installed → install is "available"
    elif remote_newer_than_local "$remote_version" "$local_version"; then
        update_available="true"
    fi

    emit_check "$installed" "$local_version" "$remote_version" "$update_available"
    exit 0
}

if $CHECK_MODE; then
    run_check_mode
fi

# Function: Check if update is needed
check_version() {
    if [ ! -f "$DOCS_DIR/docSet.dsidx" ]; then
        emit_log "No existing docs found. Installing MBS documentation..."
        return 0
    fi

    if [ "$FORCE_INSTALL" = true ]; then
        emit_log "Force installation requested. Reinstalling MBS documentation..."
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

    return 0  # Proceed with installation
}

# Function: Download MBS documentation
download_docs() {
    emit_progress download 20 "Downloading from $ZIP_URL"

    if $QUIET_MODE; then
        curl -sL -o "$TEMP_DIR/MBS.zip" "$ZIP_URL"
        local rc=$?
    else
        curl -L -o "$TEMP_DIR/MBS.zip" "$ZIP_URL" 2>&1 | grep -v "^  "
        local rc=${PIPESTATUS[0]}
    fi

    if [ $rc -ne 0 ]; then
        emit_error "Download failed"
        exit 2
    fi

    # Verify file was downloaded and has reasonable size (should be > 1MB)
    FILE_SIZE=$(stat -f%z "$TEMP_DIR/MBS.zip" 2>/dev/null || echo "0")
    if [ "$FILE_SIZE" -lt 1000000 ]; then
        emit_error "Downloaded file is too small ($FILE_SIZE bytes). Download may have failed."
        exit 2
    fi

    emit_progress download 40 "Download complete ($(echo "scale=1; $FILE_SIZE / 1024 / 1024" | bc) MB)"
}

# Function: Extract and validate archive
extract_docs() {
    emit_progress extract 50 "Extracting documentation..."

    unzip -q "$TEMP_DIR/MBS.zip" -d "$TEMP_DIR"

    if [ $? -ne 0 ]; then
        emit_error "Extraction failed"
        exit 3
    fi

    # Validate expected structure
    if [ ! -d "$TEMP_DIR/$DOCSET_PATH" ]; then
        emit_error "Unexpected archive structure — expected path not found: $DOCSET_PATH"
        exit 3
    fi

    if [ ! -d "$TEMP_DIR/$DOCSET_PATH/Documents" ]; then
        emit_error "Documents directory not found in archive"
        exit 3
    fi

    if [ ! -f "$TEMP_DIR/$DOCSET_PATH/docSet.dsidx" ]; then
        emit_error "docSet.dsidx not found in archive"
        exit 3
    fi
}

# Function: Install documentation files
install_docs() {
    emit_progress install 60 "Installing to $DOCS_DIR..."

    # SAFETY CHECK 1: Validate DOCS_DIR variable
    if [ -z "$DOCS_DIR" ]; then
        emit_error "DOCS_DIR is not set. Aborting for safety."
        exit 4
    fi

    # SAFETY CHECK 2: Ensure DOCS_DIR contains expected pattern
    if [[ ! "$DOCS_DIR" == *"/docs/mbs" ]]; then
        emit_error "DOCS_DIR does not match expected pattern (/docs/mbs). Aborting for safety. Value: $DOCS_DIR"
        exit 4
    fi

    # SAFETY CHECK 3: Prevent deletion of root or system directories
    case "$DOCS_DIR" in
        /|/bin|/etc|/usr|/var|/System|/Library|/Applications|$HOME)
            emit_error "DOCS_DIR points to a protected directory. Aborting for safety."
            exit 4
            ;;
    esac

    # Create target directory if it doesn't exist
    mkdir -p "$DOCS_DIR"

    if [ $? -ne 0 ]; then
        emit_error "Failed to create target directory: $DOCS_DIR"
        exit 4
    fi

    # SAFETY CHECK 4: If version file exists, verify we're in the right directory
    if [ -f "$VERSION_FILE" ]; then
        # Version file exists, proceed with deletion
        :
    elif [ -d "$DOCS_DIR/Documents" ] || [ -f "$DOCS_DIR/docSet.dsidx" ]; then
        emit_warn "Target directory contains files but no version marker. Could be a wrong target directory."
        if ! confirm_or_quiet "Continue anyway?"; then
            emit_log "Installation cancelled for safety"
            emit_done false "Cancelled for safety"
            exit 1
        fi
    fi

    # SAFETY CHECK 5: Change to target directory and use relative paths
    cd "$DOCS_DIR" || {
        emit_error "Cannot change to target directory: $DOCS_DIR"
        exit 4
    }

    # Remove old files using relative paths (now safe)
    rm -rf "./Documents" "./docSet.dsidx"

    # Copy new files (back to using absolute path for source)
    cp -R "$TEMP_DIR/$DOCSET_PATH/Documents" "$DOCS_DIR/" 2>&1
    if [ $? -ne 0 ]; then
        emit_error "Failed to copy Documents directory"
        exit 4
    fi

    cp "$TEMP_DIR/$DOCSET_PATH/docSet.dsidx" "$DOCS_DIR/" 2>&1
    if [ $? -ne 0 ]; then
        emit_error "Failed to copy docSet.dsidx"
        exit 4
    fi

    # Store version marker with remote timestamp
    REMOTE_DATE=$(get_remote_timestamp)
    echo "$REMOTE_DATE" > "$VERSION_FILE"

    if [ $? -ne 0 ]; then
        emit_warn "Failed to create version marker file"
    fi
}

# Function: Get installation statistics
get_stats() {
    if [ -f "$DOCS_DIR/docSet.dsidx" ]; then
        # Count HTML files in Documents directory
        DOC_COUNT=$(find "$DOCS_DIR/Documents" -name "*.html" 2>/dev/null | wc -l | tr -d ' ')
        echo "($DOC_COUNT HTML documentation files)"
    fi
}

# Function: Register the installed docs in .fmlab/docs.json
register_docs() {
    REGISTER_SCRIPT="$PROJECT_ROOT/tools/register_docs.py"
    if [ ! -f "$REGISTER_SCRIPT" ]; then
        echo "WARNING: register_docs.py not found at $REGISTER_SCRIPT — skipping manifest update."
        return 0
    fi
    if ! command -v python3 &> /dev/null; then
        echo "WARNING: python3 not available — skipping .fmlab/docs.json update."
        return 0
    fi

    # Count categories from the SQLite index (type='Category').
    CATEGORY_COUNT=$(sqlite3 "$DOCS_DIR/docSet.dsidx" \
        "SELECT COUNT(*) FROM searchIndex WHERE type='Category';" 2>/dev/null || echo "")
    FUNCTION_COUNT=$(sqlite3 "$DOCS_DIR/docSet.dsidx" \
        "SELECT COUNT(*) FROM searchIndex WHERE type='Function';" 2>/dev/null || echo "")

    python3 "$REGISTER_SCRIPT" \
        --id mbs \
        --name "MBS Plugin" \
        --description "MonkeyBread Software plugin function reference." \
        --directory "docs/mbs" \
        --skill install-mbs-docs \
        --source-url "https://www.monkeybreadsoftware.com" \
        --categories "${CATEGORY_COUNT:-none}" \
        --functions "${FUNCTION_COUNT:-none}" \
        --languages en \
        || echo "WARNING: register_docs.py failed (non-fatal)."
}

# Function: Parse MBS components and create exceptions table
parse_components() {
    echo ""
    echo "Parsing MBS components and creating exceptions table..."

    # Get the directory where this script is located
    # We need to handle the path relative to PROJECT_ROOT since BASH_SOURCE may be relative
    SKILL_SCRIPTS_DIR="$PROJECT_ROOT/.claude/skills/install-mbs-docs/scripts"
    PARSER_SCRIPT="$SKILL_SCRIPTS_DIR/parse_mbs_components.py"

    # Verify parser script exists
    if [ ! -f "$PARSER_SCRIPT" ]; then
        echo "WARNING: Parser script not found at $PARSER_SCRIPT"
        echo "Skipping component parsing."
        return 1
    fi

    # Verify Python 3 is available
    if ! command -v python3 &> /dev/null; then
        echo "WARNING: python3 not found in PATH"
        echo "Skipping component parsing."
        return 1
    fi

    # Create data directory if it doesn't exist
    mkdir -p "$PROJECT_ROOT/data"

    # Run parser with PROJECT_ROOT as environment variable
    export PROJECT_ROOT
    python3 "$PARSER_SCRIPT" 2>&1

    if [ $? -eq 0 ]; then
        echo "Component parsing completed successfully"
        return 0
    else
        echo "WARNING: Component parsing failed"
        return 1
    fi
}

# Main workflow
main() {
    # Step 1: Check version and prompt user if needed
    check_version

    # Step 2: Download documentation
    download_docs

    # Step 3: Extract and validate
    extract_docs

    # Step 4: Install files
    install_docs

    # Step 5: Parse components and create exceptions table
    emit_progress parse 80 "Parsing MBS components..."
    parse_components

    # Step 6: Register in .fmlab/docs.json (for web home dashboard)
    emit_progress register 95 "Updating .fmlab/docs.json..."
    register_docs

    # Step 7: Report success
    REMOTE_DATE=$(get_remote_timestamp)
    STATS=$(get_stats)

    if $QUIET_MODE; then
        emit_done true "MBS documentation installed (version $REMOTE_DATE)"
    else
        echo ""
        echo "SUCCESS: MBS documentation installed successfully"
        echo "Version: $REMOTE_DATE"
        echo "Location: $DOCS_DIR"
        [ -n "$STATS" ] && echo "Files: $STATS"
    fi

    exit 0
}

# Execute main workflow
main
