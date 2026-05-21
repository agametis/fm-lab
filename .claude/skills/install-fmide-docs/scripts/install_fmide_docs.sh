#!/bin/bash
# fmIDE Documentation Installation Script
#
# This script clones and installs fmIDE documentation from the GitHub Wiki.
# It handles version checking, user prompts, and automatic cleanup.
#
# Usage: install_fmide_docs.sh [--check|--install] [--quiet] [--force]
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
#   2 - Clone/fetch failed
#   3 - No wiki pages found
#   4 - Copy operation failed
#   5 - Failed to create temporary directory

# Constants
PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd))"
DOCS_DIR="$PROJECT_ROOT/docs/fmIDE"
VERSION_FILE="$DOCS_DIR/.version"
WIKI_URL="https://github.com/fmIDE/fmIDE.wiki.git"

# Shared mode helpers (--check/--install/--quiet + emit_log/emit_progress/...)
# shellcheck source=/dev/null
source "$PROJECT_ROOT/tools/install_modes.sh"

# Phase budget for fmIDE — clone dominates total runtime; install copies are
# fast, register is essentially instant.
set_phase_budget "check:0-10 clone:10-70 install:70-92 register:92-98 done:98-100"

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

# Function: Get remote HEAD commit hash
get_remote_hash() {
    git ls-remote "$WIKI_URL" HEAD 2>/dev/null | awk '{print $1}'
}

# Returns 0 if the local install directory is "present and not empty"
is_installed_locally() {
    [ -d "$DOCS_DIR" ] && [ -n "$(ls -A "$DOCS_DIR" 2>/dev/null)" ]
}

# --check mode: probe local commit + remote HEAD, emit a check-event, exit.
run_check_mode() {
    local installed="false" local_version="" remote_version="" update_available="false"

    if is_installed_locally; then
        installed="true"
    fi
    if [ -f "$VERSION_FILE" ]; then
        local_version=$(head -1 "$VERSION_FILE")
    fi
    remote_version=$(get_remote_hash || true)

    if [ "$installed" = "false" ]; then
        update_available="true"
    elif [ -n "$remote_version" ] && [ -n "$local_version" ] && [ "$remote_version" != "$local_version" ]; then
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
    if ! is_installed_locally; then
        emit_log "No existing docs found. Installing fmIDE documentation..."
        return 0
    fi

    if [ "$FORCE_INSTALL" = true ]; then
        emit_log "Force installation requested. Reinstalling fmIDE documentation..."
        return 0
    fi

    phase_progress check 0 "Checking for updates..."

    REMOTE_HASH=$(get_remote_hash)
    if [ -z "$REMOTE_HASH" ]; then
        emit_error "Failed to retrieve remote version information"
        exit 2
    fi

    if [ -f "$VERSION_FILE" ]; then
        LOCAL_HASH=$(head -1 "$VERSION_FILE")

        if [ "$REMOTE_HASH" = "$LOCAL_HASH" ]; then
            LOCAL_DATE=$(tail -1 "$VERSION_FILE")
            emit_log "Docs are up to date (commit: ${LOCAL_HASH:0:8}, date: $LOCAL_DATE). No action needed."
            emit_done true "Already up to date"
            exit 0
        fi

        LOCAL_DATE=$(tail -1 "$VERSION_FILE")
        emit_log "Newer version available. Current: ${LOCAL_HASH:0:8} ($LOCAL_DATE) — Remote: ${REMOTE_HASH:0:8}"
        if ! confirm_or_quiet "Replace existing docs?"; then
            emit_log "Installation cancelled by user"
            emit_done false "Cancelled by user"
            exit 1
        fi
    else
        emit_warn "Existing documentation found (no version information). Remote: ${REMOTE_HASH:0:8}"
        if ! confirm_or_quiet "Replace existing docs?"; then
            emit_log "Installation cancelled by user"
            emit_done false "Cancelled by user"
            exit 1
        fi
    fi

    return 0
}

# Function: Clone fmIDE wiki
clone_wiki() {
    phase_progress clone 0 "Cloning fmIDE wiki from $WIKI_URL"

    git clone --quiet "$WIKI_URL" "$TEMP_DIR/wiki" 2>&1

    if [ $? -ne 0 ]; then
        emit_error "Clone failed. Check your internet connection and that the wiki exists."
        exit 2
    fi

    # Verify we got markdown files
    MD_COUNT=$(find "$TEMP_DIR/wiki" -name "*.md" -not -path "*/.git/*" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$MD_COUNT" -eq 0 ]; then
        emit_error "No Markdown files found in wiki"
        exit 3
    fi

    phase_progress clone 100 "Clone complete ($MD_COUNT Markdown pages)"
}

# Function: Install documentation files
install_docs() {
    phase_progress install 0 "Installing to $DOCS_DIR..."

    if [ -z "$DOCS_DIR" ]; then
        emit_error "DOCS_DIR is not set. Aborting for safety."
        exit 4
    fi

    if [[ ! "$DOCS_DIR" == *"/docs/fmIDE" ]]; then
        emit_error "DOCS_DIR does not match expected pattern (/docs/fmIDE). Value: $DOCS_DIR"
        exit 4
    fi

    case "$DOCS_DIR" in
        /|/bin|/etc|/usr|/var|/System|/Library|/Applications|$HOME)
            emit_error "DOCS_DIR points to a protected directory. Aborting for safety."
            exit 4
            ;;
    esac

    mkdir -p "$DOCS_DIR"
    if [ $? -ne 0 ]; then
        emit_error "Failed to create target directory: $DOCS_DIR"
        exit 4
    fi

    cd "$DOCS_DIR" || {
        emit_error "Cannot change to target directory: $DOCS_DIR"
        exit 4
    }

    find . -maxdepth 1 -name "*.md" -delete 2>/dev/null
    rm -rf ./images 2>/dev/null

    phase_progress install 25 "Copying Markdown pages..."
    find "$TEMP_DIR/wiki" -maxdepth 1 -name "*.md" -exec cp {} "$DOCS_DIR/" \; 2>&1
    if [ $? -ne 0 ]; then
        emit_error "Failed to copy Markdown files"
        exit 4
    fi

    if [ -d "$TEMP_DIR/wiki/images" ]; then
        phase_progress install 50 "Copying images..."
        copy_with_progress "$TEMP_DIR/wiki/images" "$DOCS_DIR/images" install 1
        if [ $? -ne 0 ]; then
            emit_warn "Failed to copy images directory"
        fi
    fi
    phase_progress install 100 ""

    # Store version marker: commit hash on line 1, date on line 2
    COMMIT_HASH=$(git -C "$TEMP_DIR/wiki" rev-parse HEAD 2>/dev/null)
    COMMIT_DATE=$(git -C "$TEMP_DIR/wiki" log -1 --format="%ci" 2>/dev/null)

    {
        echo "$COMMIT_HASH"
        echo "$COMMIT_DATE"
    } > "$VERSION_FILE"

    if [ $? -ne 0 ]; then
        emit_warn "Failed to create version marker file"
    fi
}

# Function: Get installation statistics
get_stats() {
    MD_COUNT=$(find "$DOCS_DIR" -maxdepth 1 -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    echo "($MD_COUNT Markdown pages)"
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

    # Markdown pages double as "rubrics" for the wiki.
    MD_COUNT=$(find "$DOCS_DIR" -maxdepth 1 -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

    python3 "$REGISTER_SCRIPT" \
        --id fmide \
        --name "fmIDE" \
        --description "fmIDE GitHub Wiki — Deep Linking, Name-that-Thing API and conventions." \
        --directory "docs/fmIDE" \
        --skill install-fmide-docs \
        --source-url "https://github.com/fmIDE/fmIDE/wiki" \
        --categories "${MD_COUNT:-none}" \
        --functions none \
        --languages en \
        || echo "WARNING: register_docs.py failed (non-fatal)."
}

# Main workflow
main() {
    # Step 1: Check version and prompt user if needed
    check_version

    # Step 2: Clone wiki
    clone_wiki

    # Step 3: Install files
    install_docs

    # Step 4: Register in .fmlab/docs.json (for web home dashboard)
    phase_progress register 0 "Updating .fmlab/docs.json..."
    register_docs
    phase_progress register 100 ""

    # Step 5: Report success
    COMMIT_HASH=$(git -C "$TEMP_DIR/wiki" rev-parse HEAD 2>/dev/null)
    COMMIT_DATE=$(git -C "$TEMP_DIR/wiki" log -1 --format="%ci" 2>/dev/null)
    STATS=$(get_stats)

    if $QUIET_MODE; then
        emit_done true "fmIDE documentation installed (${COMMIT_HASH:0:8} / $COMMIT_DATE)"
    else
        echo ""
        echo "SUCCESS: fmIDE documentation installed successfully"
        echo "Version: ${COMMIT_HASH:0:8} ($COMMIT_DATE)"
        echo "Location: $DOCS_DIR"
        [ -n "$STATS" ] && echo "Files: $STATS"
    fi

    exit 0
}

# Execute main workflow
main
