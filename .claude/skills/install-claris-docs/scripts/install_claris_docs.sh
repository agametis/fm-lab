#!/bin/bash
# Claris Online Help Installation Script
#
# Downloads and installs the Claris FileMaker Pro online help (help.claris.com)
# as a local mirror under docs/claris-help/<lang>/.
#
# English (en) is ALWAYS included as the reference language. Additional
# languages can be requested via --lang=<code> or --all.
#
# Additionally copies the reference index database from
#   rest-api/db/fm_reference.duckdb  →  docs/claris-help/fm_reference.duckdb
# (set --skip-reference-db to disable). The REST-API attaches the DB in
# READ_ONLY mode (no WAL file), so a live copy is safe by default. If the
# direct copy fails and the API server is running on port 3003, the script
# falls back to: stop server → copy → restart server (via tools/-scripts).
#
# Usage:
#   install_claris_docs.sh [--check|--install] [--quiet]
#                          [--lang=<code>|all] [--all] [--force]
#                          [--max-workers=N] [--dry-run] [--list-languages]
#                          [--skip-reference-db] [--restart-server]
#
# Mode flags (from tools/install_modes.sh):
#   --check:   Probe-only mode (reference language only). Emits a single
#              check-event with {installed, local_version, remote_version,
#              update_available} and exits.
#   --install: Run the installation workflow (default if no mode is given).
#   --quiet:   Emit NDJSON events instead of plain log lines. Bypasses
#              interactive prompts (treats every confirmation as yes).
#
# Exit codes:
#   0 - Success
#   1 - Invalid arguments / user cancelled
#   2 - Setup error (missing dependency, target dir not writable)
#   3 - One or more languages failed to install completely
#   4 - Network error before any language could start

set -uo pipefail

# -------------------- Constants --------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../../.." && pwd))"
DOCS_DIR="$PROJECT_ROOT/docs/claris-help"
MANIFEST_FILE="$DOCS_DIR/manifest.json"
CRAWLER="$SCRIPT_DIR/claris_crawler.py"

REFERENCE_DB_SRC="$PROJECT_ROOT/rest-api/db/fm_reference.duckdb"
REFERENCE_DB_DST="$DOCS_DIR/fm_reference.duckdb"
API_PORT=3003
STOP_SERVERS_SCRIPT="$PROJECT_ROOT/tools/stop-servers.sh"
START_SERVERS_SCRIPT="$PROJECT_ROOT/tools/start-servers.sh"

BASE_URL="https://help.claris.com"
ALL_LANGS=(en de es fr it nl pt sv ja ko zh)
REFERENCE_LANG="en"   # Always installed

# -------------------- Shared mode helpers --------------------
# shellcheck source=/dev/null
source "$PROJECT_ROOT/tools/install_modes.sh"

# Phase budget for the SSE progress bar. Per-language crawl gets the lion's
# share (10-90%); the budget is sliced evenly across the requested languages
# at runtime once TARGET_LANGS is known.
set_phase_budget "check:0-5 refdb:5-10 crawl:10-90 manifest:90-94 register:94-98 done:98-100"

# Extract --check/--install/--quiet first; the rest is parsed by the existing
# Claris-specific arg-loop below. The `${REMAINING_ARGS[@]+...}` indirection
# avoids "unbound variable" under `set -u` when no leftover args remain.
QUIET_MODE=false; CHECK_MODE=false; INSTALL_MODE=false
REMAINING_ARGS=()
parse_install_modes "$@"
set -- ${REMAINING_ARGS[@]+"${REMAINING_ARGS[@]}"}

# -------------------- Argument parsing --------------------

USER_LANG=""
USER_LANGS_CSV=""
INSTALL_ALL=false
FORCE_INSTALL=false
MAX_WORKERS=8
DRY_RUN=false
LIST_LANGUAGES=false
SKIP_REFERENCE_DB=false
FORCE_RESTART_SERVER=false

for arg in "$@"; do
    case "$arg" in
        --lang=all|--all)
            INSTALL_ALL=true
            ;;
        --langs=*)
            # Comma-separated list of language codes (e.g. --langs=de,fr,it).
            # Used by the web Install button when the user picks individual
            # languages in the popover. EN is always added automatically.
            USER_LANGS_CSV="${arg#--langs=}"
            ;;
        --lang=*)
            USER_LANG="${arg#--lang=}"
            ;;
        --force)
            FORCE_INSTALL=true
            ;;
        --max-workers=*)
            MAX_WORKERS="${arg#--max-workers=}"
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --list-languages)
            LIST_LANGUAGES=true
            ;;
        --skip-reference-db)
            SKIP_REFERENCE_DB=true
            ;;
        --restart-server)
            FORCE_RESTART_SERVER=true
            ;;
        --help|-h)
            sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        '') ;;
        *)
            emit_error "Unknown argument: $arg"
            echo "Use --help for usage information." >&2
            exit 1
            ;;
    esac
done

# -------------------- Helpers --------------------

color_red()    { printf '\033[31m%s\033[0m\n' "$1"; }
color_green()  { printf '\033[32m%s\033[0m\n' "$1"; }
color_yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
color_cyan()   { printf '\033[36m%s\033[0m\n' "$1"; }

# Get HTTP Last-Modified header for a language's index.html
get_remote_timestamp() {
    local lang="$1"
    curl -sI "${BASE_URL}/${lang}/pro-help/content/index.html" \
        | grep -i "^last-modified:" \
        | sed 's/last-modified: //i' \
        | tr -d '\r' \
        | tr -d '\n'
}

# Check if URL exists (returns HTTP 200)
check_url() {
    local url="$1"
    local code
    code=$(curl -sI -o /dev/null -w "%{http_code}" "$url")
    [ "$code" = "200" ]
}

# Print human-readable size
human_size() {
    local bytes="$1"
    if [ -z "$bytes" ] || [ "$bytes" -eq 0 ]; then
        echo "0 B"
        return
    fi
    if [ "$bytes" -ge 1073741824 ]; then
        echo "$(echo "scale=1; $bytes / 1073741824" | bc) GB"
    elif [ "$bytes" -ge 1048576 ]; then
        echo "$(echo "scale=1; $bytes / 1048576" | bc) MB"
    elif [ "$bytes" -ge 1024 ]; then
        echo "$(echo "scale=1; $bytes / 1024" | bc) KB"
    else
        echo "$bytes B"
    fi
}

# Check whether the REST-API server is listening on its port
api_server_running() {
    lsof -nP -iTCP:"$API_PORT" 2>/dev/null | awk '/LISTEN/ {print $2}' | sort -u | head -1
}

# Atomic copy via .tmp + mv. Returns 0 on success, non-zero on error.
copy_reference_db_atomic() {
    local src="$1" dst="$2"
    local tmp="${dst}.tmp.$$"
    if cp "$src" "$tmp" 2>/dev/null; then
        if mv "$tmp" "$dst" 2>/dev/null; then
            return 0
        fi
        rm -f "$tmp"
        return 1
    fi
    rm -f "$tmp"
    return 1
}

# Install (= copy) reference DB from REST-API directory into docs/claris-help/.
#
# Default strategy: direct copy — the REST-API attaches the DB read-only, so
# the source file has no write-lock and is safe to read while the server runs.
# If the direct copy fails or --restart-server was passed, the script stops
# the API server (via tools/stop-servers.sh), copies, and starts it again
# (via tools/start-servers.sh).
install_reference_db() {
    if $SKIP_REFERENCE_DB; then
        color_yellow "[ref-db] Skipped (--skip-reference-db)"
        phase_progress refdb 100 "skipped"
        return 0
    fi

    if [ ! -f "$REFERENCE_DB_SRC" ]; then
        color_yellow "[ref-db] Source not found: $REFERENCE_DB_SRC"
        echo "         The REST-API reference DB is optional — skipping."
        REF_DB_STATUS="missing"
        phase_progress refdb 100 "no source"
        return 0
    fi

    if $DRY_RUN; then
        color_yellow "[ref-db] Dry-run — would copy $REFERENCE_DB_SRC → $REFERENCE_DB_DST"
        REF_DB_STATUS="dry-run"
        phase_progress refdb 100 "dry-run"
        return 0
    fi

    phase_progress refdb 0 "Installing reference DB..."

    local src_size
    src_size=$(stat -f%z "$REFERENCE_DB_SRC" 2>/dev/null || stat -c%s "$REFERENCE_DB_SRC" 2>/dev/null || echo 0)
    color_cyan "[ref-db] Installing reference DB ($(human_size "$src_size"))..."

    mkdir -p "$DOCS_DIR"

    local api_pid
    api_pid=$(api_server_running || true)

    # Strategy 1: direct copy (default — API is read-only, source is safe to read)
    if ! $FORCE_RESTART_SERVER; then
        if copy_reference_db_atomic "$REFERENCE_DB_SRC" "$REFERENCE_DB_DST"; then
            color_green "[ref-db] OK: copied to $REFERENCE_DB_DST"
            REF_DB_STATUS="copied"
            phase_progress refdb 100 "ref-db installed"
            return 0
        fi
        color_yellow "[ref-db] Direct copy failed — falling back to server-restart cycle"
    fi

    # Strategy 2: stop server → copy → restart
    if [ -z "$api_pid" ]; then
        # No server running and direct copy already failed (or forced restart with no server)
        if copy_reference_db_atomic "$REFERENCE_DB_SRC" "$REFERENCE_DB_DST"; then
            color_green "[ref-db] OK: copied to $REFERENCE_DB_DST (no server was running)"
            REF_DB_STATUS="copied"
            phase_progress refdb 100 "ref-db installed"
            return 0
        fi
        color_red "[ref-db] ERROR: Copy failed and no server is running. Check permissions."
        REF_DB_STATUS="failed"
        return 1
    fi

    if [ ! -x "$STOP_SERVERS_SCRIPT" ] || [ ! -x "$START_SERVERS_SCRIPT" ]; then
        color_red "[ref-db] ERROR: Direct copy failed and server-restart scripts not executable"
        echo "         Expected: $STOP_SERVERS_SCRIPT and $START_SERVERS_SCRIPT" >&2
        REF_DB_STATUS="failed"
        return 1
    fi

    color_cyan "[ref-db] Stopping REST-API server (PID $api_pid)..."
    if ! "$STOP_SERVERS_SCRIPT" >/dev/null 2>&1; then
        color_yellow "[ref-db] stop-servers.sh returned non-zero; continuing anyway"
    fi

    local copy_rc=0
    if copy_reference_db_atomic "$REFERENCE_DB_SRC" "$REFERENCE_DB_DST"; then
        color_green "[ref-db] OK: copied to $REFERENCE_DB_DST"
        REF_DB_STATUS="copied-restart"
    else
        color_red "[ref-db] ERROR: Copy still failed after stopping server."
        REF_DB_STATUS="failed"
        copy_rc=1
    fi

    color_cyan "[ref-db] Restarting REST-API server..."
    if "$START_SERVERS_SCRIPT" >/dev/null 2>&1; then
        color_green "[ref-db] Server restarted"
    else
        color_yellow "[ref-db] start-servers.sh returned non-zero — check logs/rest-api.log"
    fi

    phase_progress refdb 100 ""
    return $copy_rc
}

# Get the existing version of a language from .version file
get_local_version() {
    local lang="$1"
    local vfile="$DOCS_DIR/$lang/.version"
    if [ -f "$vfile" ]; then
        python3 -c "import json,sys; d=json.load(open('$vfile')); print(d.get('last_modified',''))" 2>/dev/null
    fi
}

# -------------------- List languages mode --------------------

lang_display_name() {
    case "$1" in
        en) echo "English (reference)" ;;
        de) echo "Deutsch" ;;
        es) echo "Español" ;;
        fr) echo "Français" ;;
        it) echo "Italiano" ;;
        nl) echo "Nederlands" ;;
        pt) echo "Português" ;;
        sv) echo "Svenska" ;;
        ja) echo "日本語" ;;
        ko) echo "한국어" ;;
        zh) echo "中文 (vereinf.)" ;;
        *)  echo "$1" ;;
    esac
}

# -------------------- Check mode (probe-only) --------------------
#
# Reports installation status using the reference language (en) as the
# canonical signal. Frontend just needs a yes/no "update available" badge —
# per-language detail is available via GET /api/docs/claris-help/status.

run_check_mode() {
    local installed="false" local_version="" remote_version="" update_available="false"
    local en_dir="$DOCS_DIR/$REFERENCE_LANG"
    local en_version_file="$en_dir/.version"

    if [ -d "$en_dir/content" ] && [ "$(ls -A "$en_dir/content" 2>/dev/null | wc -l)" -gt 0 ]; then
        installed="true"
    fi
    if [ -f "$en_version_file" ]; then
        local_version=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('last_modified',''))" "$en_version_file" 2>/dev/null || echo "")
    fi
    remote_version=$(get_remote_timestamp "$REFERENCE_LANG" || true)

    if [ "$installed" = "false" ]; then
        update_available="true"
    elif [ -n "$remote_version" ] && [ -n "$local_version" ] && [ "$remote_version" != "$local_version" ]; then
        # Different Last-Modified → assume remote is newer (Claris doesn't roll back).
        update_available="true"
    fi

    emit_check "$installed" "$local_version" "$remote_version" "$update_available"
    exit 0
}

if $CHECK_MODE; then
    run_check_mode
fi

if $LIST_LANGUAGES; then
    echo "Available languages for Claris Online Help:"
    echo ""
    printf "  %-8s %-25s %s\n" "Code" "Sprache" "Status"
    printf "  %-8s %-25s %s\n" "----" "-------" "------"
    for lang in "${ALL_LANGS[@]}"; do
        if check_url "${BASE_URL}/${lang}/pro-help/content/index.html"; then
            status=$(color_green "✓ verfügbar")
        else
            status=$(color_red "✗ nicht erreichbar")
        fi
        printf "  %-8s %-25s %s\n" "$lang" "$(lang_display_name "$lang")" "$status"
    done
    exit 0
fi

# -------------------- Setup checks --------------------

phase_progress check 0 "Validating environment..."

# Python 3 vorhanden?
if ! command -v python3 >/dev/null 2>&1; then
    color_red "ERROR: python3 not found in PATH" >&2
    echo "Install Python 3 (macOS: 'brew install python3' or use system Python)." >&2
    exit 2
fi

# Crawler-Script vorhanden?
if [ ! -f "$CRAWLER" ]; then
    color_red "ERROR: Crawler script not found: $CRAWLER" >&2
    exit 2
fi

# Validate user language
if [ -n "$USER_LANG" ]; then
    valid=false
    for l in "${ALL_LANGS[@]}"; do
        if [ "$l" = "$USER_LANG" ]; then
            valid=true
            break
        fi
    done
    if ! $valid; then
        color_red "ERROR: Unknown language code: $USER_LANG" >&2
        echo "Available: ${ALL_LANGS[*]}" >&2
        echo "Use --list-languages for details." >&2
        exit 1
    fi
fi

# Validate comma-separated language list (--langs=de,fr,it). Splits on comma,
# rejects any unknown codes — fail-fast so a typo from the frontend doesn't
# silently install the wrong subset.
declare -a USER_LANGS_ARRAY=()
if [ -n "$USER_LANGS_CSV" ]; then
    IFS=',' read -ra USER_LANGS_ARRAY <<< "$USER_LANGS_CSV"
    for ul in "${USER_LANGS_ARRAY[@]}"; do
        ul_trim="${ul// /}"
        [ -z "$ul_trim" ] && continue
        valid=false
        for l in "${ALL_LANGS[@]}"; do
            if [ "$l" = "$ul_trim" ]; then
                valid=true
                break
            fi
        done
        if ! $valid; then
            color_red "ERROR: Unknown language code in --langs: $ul_trim" >&2
            echo "Available: ${ALL_LANGS[*]}" >&2
            exit 1
        fi
    done
fi

# -------------------- Determine target languages --------------------

declare -a TARGET_LANGS=("$REFERENCE_LANG")

if $INSTALL_ALL; then
    TARGET_LANGS=("${ALL_LANGS[@]}")
elif [ ${#USER_LANGS_ARRAY[@]} -gt 0 ]; then
    for ul in "${USER_LANGS_ARRAY[@]}"; do
        ul_trim="${ul// /}"
        [ -z "$ul_trim" ] && continue
        TARGET_LANGS+=("$ul_trim")
    done
elif [ -n "$USER_LANG" ] && [ "$USER_LANG" != "$REFERENCE_LANG" ]; then
    TARGET_LANGS+=("$USER_LANG")
fi

# Dedupe (in case en was specified explicitly) — bash 3.2 compatible
SEEN_LIST=""
UNIQUE_LANGS=()
for l in "${TARGET_LANGS[@]}"; do
    case " $SEEN_LIST " in
        *" $l "*) ;;
        *)
            SEEN_LIST="$SEEN_LIST $l"
            UNIQUE_LANGS+=("$l")
            ;;
    esac
done
TARGET_LANGS=("${UNIQUE_LANGS[@]}")

# -------------------- Create target directory --------------------

# SAFETY: validate DOCS_DIR before any rm operation
if [ -z "$DOCS_DIR" ] || [[ "$DOCS_DIR" != *"/docs/claris-help" ]]; then
    color_red "ERROR: DOCS_DIR safety check failed: $DOCS_DIR" >&2
    exit 2
fi
case "$DOCS_DIR" in
    /|/bin|/etc|/usr|/var|/System|/Library|/Applications|"$HOME")
        color_red "ERROR: DOCS_DIR points to a protected directory: $DOCS_DIR" >&2
        exit 2
        ;;
esac

mkdir -p "$DOCS_DIR" || {
    color_red "ERROR: Failed to create target directory: $DOCS_DIR" >&2
    exit 2
}

phase_progress check 100 ""

# -------------------- Reporting header --------------------

echo ""
color_cyan "Installing Claris Online Help..."
echo "  Languages: ${TARGET_LANGS[*]}"
echo "  Target:    $DOCS_DIR"
echo "  Workers:   $MAX_WORKERS"
if $DRY_RUN; then
    color_yellow "  Mode:      DRY RUN (no files will be written)"
fi
if $SKIP_REFERENCE_DB; then
    echo "  Ref-DB:    disabled (--skip-reference-db)"
else
    echo "  Ref-DB:    $REFERENCE_DB_SRC → $REFERENCE_DB_DST"
fi
echo ""

# -------------------- Reference DB installation --------------------

REF_DB_STATUS="not-attempted"
echo "════════════════════════════════════════════════════════════"
install_reference_db || true
echo ""

# -------------------- Per-language workflow --------------------

INSTALLED=()
UPDATED=()
SKIPPED=()
FAILED=()

TOTAL_FILES=0
TOTAL_BYTES=0
OVERALL_RC=0

# Per-language slice within the "crawl" phase budget (10-90 → 80% total).
# LANG_IDX is bumped before processing so that any `continue` later in the
# loop body still advances the bar to the next slice on the next iteration.
LANG_COUNT=${#TARGET_LANGS[@]}
LANG_IDX=0

for lang in "${TARGET_LANGS[@]}"; do
    LANG_START_PCT=$((LANG_IDX * 100 / LANG_COUNT))
    LANG_IDX=$((LANG_IDX + 1))
    echo "════════════════════════════════════════════════════════════"
    color_cyan "[$lang] Processing language..."
    phase_progress crawl "$LANG_START_PCT" "[$lang] Starting..."

    # Verify language is reachable
    if ! check_url "${BASE_URL}/${lang}/pro-help/content/index.html"; then
        color_red "[$lang] ERROR: Language root not reachable (index.html returned non-200)"
        FAILED+=("$lang")
        OVERALL_RC=3
        continue
    fi

    # Get remote timestamp
    REMOTE_TS=$(get_remote_timestamp "$lang")
    if [ -z "$REMOTE_TS" ]; then
        REMOTE_TS="(no Last-Modified header)"
    fi
    LOCAL_TS=$(get_local_version "$lang")

    LANG_DIR="$DOCS_DIR/$lang"
    EXISTS_LOCALLY=false
    if [ -d "$LANG_DIR/content" ] && [ "$(ls -A "$LANG_DIR/content" 2>/dev/null | wc -l)" -gt 0 ]; then
        EXISTS_LOCALLY=true
    fi

    # Version check
    if $EXISTS_LOCALLY && ! $FORCE_INSTALL; then
        if [ -n "$LOCAL_TS" ] && [ "$LOCAL_TS" = "$REMOTE_TS" ]; then
            color_green "[$lang] Up to date (last-modified: $LOCAL_TS)"
            SKIPPED+=("$lang")
            continue
        fi

        if [ -n "$LOCAL_TS" ]; then
            color_yellow "[$lang] Newer version available."
            echo "    Current: $LOCAL_TS"
            echo "    Remote:  $REMOTE_TS"
        else
            color_yellow "[$lang] Existing files found (no version marker)."
            echo "    Remote: $REMOTE_TS"
        fi

        if confirm_or_quiet "[$lang] Replace existing docs?"; then
            : # proceed
        else
            color_yellow "[$lang] Skipped — use --force to replace existing docs non-interactively."
            SKIPPED+=("$lang")
            continue
        fi
    fi

    # Clean existing directory (SAFETY: lang must be alphanumeric, max 6 chars)
    if $EXISTS_LOCALLY && [ -n "$lang" ] && [[ "$lang" =~ ^[a-zA-Z]{2,6}$ ]]; then
        # Only remove subdirs we know we created
        for sub in content Resources Skins assets resources; do
            if [ -d "$LANG_DIR/$sub" ]; then
                rm -rf "${LANG_DIR:?}/$sub"
            fi
        done
        # Remove version marker
        rm -f "$LANG_DIR/.version"
    fi

    mkdir -p "$LANG_DIR"

    # Run crawler
    PYTHON_ARGS=(--lang="$lang" --output="$DOCS_DIR" --max-workers="$MAX_WORKERS")
    if $DRY_RUN; then
        PYTHON_ARGS+=(--dry-run)
    fi

    CRAWL_OUTPUT_FILE=$(mktemp)
    trap "rm -f '$CRAWL_OUTPUT_FILE'" EXIT

    if python3 "$CRAWLER" "${PYTHON_ARGS[@]}" 2>&1 | tee "$CRAWL_OUTPUT_FILE"; then
        CRAWL_RC=0
    else
        CRAWL_RC=$?
    fi

    # Extract JSON result from crawler output (last block after ---CRAWL-RESULT---)
    JSON_RESULT=$(awk '/^---CRAWL-RESULT---$/{found=1; next} found{print}' "$CRAWL_OUTPUT_FILE")
    rm -f "$CRAWL_OUTPUT_FILE"

    if [ -z "$JSON_RESULT" ]; then
        color_red "[$lang] ERROR: Crawler produced no result"
        FAILED+=("$lang")
        OVERALL_RC=3
        continue
    fi

    # Parse with Python
    HTML_PAGES=$(echo "$JSON_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('html_pages',0))")
    ASSET_FILES=$(echo "$JSON_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('asset_files',0))")
    SIZE_BYTES=$(echo "$JSON_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total_size_bytes',0))")
    DURATION=$(echo "$JSON_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('duration_seconds',0))")
    INCOMPLETE=$(echo "$JSON_RESULT" | python3 -c "import json,sys; print(str(json.load(sys.stdin).get('incomplete',False)).lower())")
    HTML_FAILURES=$(echo "$JSON_RESULT" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('html_failures',[])))")
    ASSET_FAILURES=$(echo "$JSON_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('asset_failures_count',0))")

    TOTAL_FILES=$((TOTAL_FILES + HTML_PAGES + ASSET_FILES))
    TOTAL_BYTES=$((TOTAL_BYTES + SIZE_BYTES))

    if [ "$CRAWL_RC" -ne 0 ] || [ "$INCOMPLETE" = "true" ]; then
        color_yellow "[$lang] WARN: Crawl incomplete — $HTML_FAILURES HTML page failures, $ASSET_FAILURES asset failures"
        FAILED+=("$lang")
        OVERALL_RC=3
    else
        EXTRA=""
        if [ "$ASSET_FAILURES" -gt 0 ]; then
            EXTRA=" ($ASSET_FAILURES non-critical asset 404s)"
        fi
        color_green "[$lang] OK: $HTML_PAGES HTML + $ASSET_FILES assets, $(human_size "$SIZE_BYTES"), ${DURATION}s${EXTRA}"
        if $EXISTS_LOCALLY; then
            UPDATED+=("$lang")
        else
            INSTALLED+=("$lang")
        fi
    fi

    # Write per-language version marker (unless dry run)
    if ! $DRY_RUN; then
        python3 -c "
import json
data = {
    'last_modified': '''$REMOTE_TS''',
    'fetched_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
    'html_pages': $HTML_PAGES,
    'asset_files': $ASSET_FILES,
    'total_size_bytes': $SIZE_BYTES,
    'incomplete': '$INCOMPLETE' == 'true',
    'html_failures_count': $HTML_FAILURES,
    'asset_failures_count': $ASSET_FAILURES,
}
with open('''$LANG_DIR/.version''', 'w') as f:
    json.dump(data, f, indent=2)
"
    fi

    echo ""
done

# Ensure the crawl phase reaches 100% even if the last language hit `continue`.
phase_progress crawl 100 ""

# -------------------- Update manifest --------------------

if ! $DRY_RUN; then
    color_cyan "Updating manifest..."
    phase_progress manifest 0 "Updating language manifest..."
    python3 <<EOF
import json, os, datetime

manifest_path = "$MANIFEST_FILE"
docs_dir = "$DOCS_DIR"
all_langs = "${ALL_LANGS[*]}".split()

# Load existing manifest if present
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        manifest = json.load(f)
else:
    manifest = {
        "\$schema_version": 1,
        "source": "Claris FileMaker Pro Online Help",
        "source_url": "https://help.claris.com",
        "fallback_language": "en",
        "languages": [],
    }

manifest["fetched_at"] = datetime.datetime.utcnow().isoformat() + "Z"

# Rebuild languages list from per-language .version files
languages = []
for lang in all_langs:
    vfile = os.path.join(docs_dir, lang, ".version")
    if not os.path.isfile(vfile):
        continue
    with open(vfile) as f:
        v = json.load(f)
    languages.append({
        "code": lang,
        "url_lang_segment": lang,
        "url_root": f"https://help.claris.com/{lang}/pro-help/",
        "html_pages": v.get("html_pages", 0),
        "asset_files": v.get("asset_files", 0),
        "total_size_bytes": v.get("total_size_bytes", 0),
        "last_modified": v.get("last_modified", ""),
        "fetched_at": v.get("fetched_at", ""),
        "incomplete": v.get("incomplete", False),
    })

manifest["languages"] = languages

with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print(f"  Manifest written: {manifest_path}")
print(f"  Languages registered: {len(languages)}")
EOF
    phase_progress manifest 100 ""
fi

# -------------------- Update .fmlab/docs.json --------------------
# Shared registry consumed by the web home dashboard via the REST API
# builtin `list_docs`. Skipped in dry-run mode.

REGISTER_SCRIPT="$PROJECT_ROOT/tools/register_docs.py"
if ! $DRY_RUN && [ -f "$REGISTER_SCRIPT" ]; then
    # Languages: every <code>/content/ directory that exists counts as installed.
    INSTALLED_LANGS=()
    for lang in "${ALL_LANGS[@]}"; do
        if [ -d "$DOCS_DIR/$lang/content" ]; then
            INSTALLED_LANGS+=("$lang")
        fi
    done
    LANG_ARGS=""
    if [ ${#INSTALLED_LANGS[@]} -gt 0 ]; then
        LANG_CSV=$(IFS=','; echo "${INSTALLED_LANGS[*]}")
        LANG_ARGS="--languages $LANG_CSV"
    fi

    # Counts from the reference DB (function + script step categories, totals).
    CATEGORY_COUNT=""
    FUNCTION_COUNT=""
    if [ -f "$REFERENCE_DB_DST" ]; then
        DUCKDB_BIN=$(command -v duckdb || true)
        [ -z "$DUCKDB_BIN" ] && [ -x "$HOME/.duckdb/cli/latest/duckdb" ] && DUCKDB_BIN="$HOME/.duckdb/cli/latest/duckdb"
        [ -z "$DUCKDB_BIN" ] && [ -x "/opt/homebrew/bin/duckdb" ] && DUCKDB_BIN="/opt/homebrew/bin/duckdb"
        if [ -n "$DUCKDB_BIN" ]; then
            CATEGORY_COUNT=$("$DUCKDB_BIN" "$REFERENCE_DB_DST" -noheader -csv -c \
                "SELECT (SELECT COUNT(*) FROM function_categories) + (SELECT COUNT(*) FROM script_steps_categories);" 2>/dev/null || echo "")
            FUNCTION_COUNT=$("$DUCKDB_BIN" "$REFERENCE_DB_DST" -noheader -csv -c \
                "SELECT (SELECT COUNT(*) FROM functions) + (SELECT COUNT(*) FROM script_steps);" 2>/dev/null || echo "")
        fi
    fi

    color_cyan "Updating .fmlab/docs.json..."
    phase_progress register 0 "Updating .fmlab/docs.json..."
    python3 "$REGISTER_SCRIPT" \
        --id claris-help \
        --name "Claris FileMaker" \
        --description "Online help mirror for FileMaker Pro (help.claris.com)." \
        --directory "docs/claris-help" \
        --skill install-claris-docs \
        --source-url "https://help.claris.com" \
        --categories "${CATEGORY_COUNT:-none}" \
        --functions "${FUNCTION_COUNT:-none}" \
        $LANG_ARGS \
        || color_yellow "WARNING: register_docs.py failed (non-fatal)."
    phase_progress register 100 ""
fi

# -------------------- Final summary --------------------

echo ""
echo "════════════════════════════════════════════════════════════"
color_cyan "Installation summary"
echo ""
if [ ${#INSTALLED[@]} -gt 0 ]; then
    color_green "  Installed: ${INSTALLED[*]}"
fi
if [ ${#UPDATED[@]} -gt 0 ]; then
    color_green "  Updated:   ${UPDATED[*]}"
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
    color_yellow "  Skipped:   ${SKIPPED[*]} (already up to date or user-cancelled)"
fi
if [ ${#FAILED[@]} -gt 0 ]; then
    color_red "  Failed:    ${FAILED[*]}"
fi
echo ""
echo "  Total files: $TOTAL_FILES"
echo "  Total size:  $(human_size "$TOTAL_BYTES")"
echo "  Location:    $DOCS_DIR"
if ! $DRY_RUN; then
    echo "  Manifest:    $MANIFEST_FILE"
fi
case "$REF_DB_STATUS" in
    copied)         echo "  Ref-DB:      $REFERENCE_DB_DST (direct copy)" ;;
    copied-restart) echo "  Ref-DB:      $REFERENCE_DB_DST (after server-restart cycle)" ;;
    missing)        echo "  Ref-DB:      source not found — skipped" ;;
    failed)         echo "  Ref-DB:      FAILED (see log above)" ;;
    dry-run)        echo "  Ref-DB:      (dry-run, not copied)" ;;
    *)              echo "  Ref-DB:      $REF_DB_STATUS" ;;
esac
echo ""

if [ "$OVERALL_RC" -eq 0 ]; then
    color_green "SUCCESS"
    emit_done true "Claris Online Help installed (${#INSTALLED[@]} new, ${#UPDATED[@]} updated, ${#SKIPPED[@]} skipped)"
else
    color_yellow "PARTIAL SUCCESS (see warnings above)"
    emit_done false "Claris Online Help install partial — ${#FAILED[@]} language(s) failed"
fi

exit "$OVERALL_RC"
