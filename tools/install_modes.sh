#!/bin/bash
# install_modes.sh — Shared helpers for all Doc-Set installer skills.
#
# Source this file from within an installer-skill bash script (e.g.
#   source "$PROJECT_ROOT/tools/install_modes.sh"
# ). It provides:
#
#   * Argument parsing for --check / --install / --quiet (in addition to
#     whatever the calling script parses on its own — call parse_install_modes
#     before/after the existing arg-loop).
#   * Emit helpers (emit_log / emit_warn / emit_error / emit_progress /
#     emit_done / emit_check) that produce NDJSON when QUIET_MODE=true and
#     plain human-readable text otherwise.
#   * Hooks for the calling script to short-circuit interactive prompts when
#     running under --quiet (treat as auto-yes / non-interactive).
#
# All emits write to stdout so the REST-API SSE bridge
# (rest-api/src/services/docs-install.js) can ingest them line by line.
#
# Conventions for the calling script:
#
#   QUIET_MODE   — bool, set by parse_install_modes
#   CHECK_MODE   — bool, set by parse_install_modes ("just probe, don't write")
#   INSTALL_MODE — bool, set by parse_install_modes (default if neither flag
#                  is given and the script previously had no flag)
#
# Conventions for prompts:
#
#   When QUIET_MODE=true: never prompt; treat every "Replace existing docs?"
#   question as YES (the caller of the installer is responsible for confirming
#   in advance; the frontend SSE bridge already ran "--check" first).

# ---------------------------------------------------------------------------
# Mode parsing
# ---------------------------------------------------------------------------
#
# Usage:
#   QUIET_MODE=false; CHECK_MODE=false; INSTALL_MODE=false
#   REMAINING_ARGS=()
#   parse_install_modes "$@"
#   set -- "${REMAINING_ARGS[@]}"  # so the rest of the script's arg-loop
#                                   # can keep working on the leftover args
#
# Anything that isn't --check / --install / --quiet is passed through into
# REMAINING_ARGS unchanged.

parse_install_modes() {
    QUIET_MODE=${QUIET_MODE:-false}
    CHECK_MODE=${CHECK_MODE:-false}
    INSTALL_MODE=${INSTALL_MODE:-false}
    REMAINING_ARGS=()

    for arg in "$@"; do
        case "$arg" in
            --quiet)   QUIET_MODE=true ;;
            --check)   CHECK_MODE=true ;;
            --install) INSTALL_MODE=true ;;
            *)         REMAINING_ARGS+=("$arg") ;;
        esac
    done

    # If neither --check nor --install is set: default to install. Preserves
    # the historic behaviour ("no flags = run installation").
    if ! $CHECK_MODE && ! $INSTALL_MODE; then
        INSTALL_MODE=true
    fi
}

# ---------------------------------------------------------------------------
# Firewall allowlist refresh (container egress firewall only)
# ---------------------------------------------------------------------------
#
# The devcontainer egress firewall (.devcontainer/init-firewall.sh + the public
# variant) pins the IPs of allowlisted domains into the `allowed-domains` ipset
# at container start. CDN-fronted doc sources — help.claris.com (Akamai),
# duckdb.org (Cloudflare) — rotate their IPs, so a doc install running much later
# can be blocked even though the domain is allowlisted.
#
# Doc installers that fetch from a CDN-fronted host call this right before their
# first network op. It shells out to the privileged helper
# /usr/local/bin/refresh-doc-domains.sh (baked into both devcontainer images with
# a narrow NOPASSWD sudoers entry), which re-resolves a HARDCODED CDN-domain list
# and adds the current IPs to the ipset. In the devcontainers the same helper also
# runs every few minutes via firewall-refresh-loop.sh — this call is the
# just-in-time top-up on top of that (and the only refresh on the pure-compose path).
#
# Strictly best-effort and fully self-guarding:
#   * No helper installed (bare-metal macOS, or a container without the firewall)
#     → silent no-op. Nothing to run, nothing to explain to the user.
#   * The helper itself no-ops when the firewall isn't applied.
#   * Never fails the caller — always returns 0.
refresh_firewall_allowlist() {
    local helper=/usr/local/bin/refresh-doc-domains.sh
    [ -x "$helper" ] || return 0
    sudo -n "$helper" >/dev/null 2>&1 || true
    return 0
}

# ---------------------------------------------------------------------------
# python3 availability probe
# ---------------------------------------------------------------------------
#
# Returns 0 when a WORKING python3 is available, else 1. Cached per shell.
#
# `command -v python3` alone is not enough: on macOS /usr/bin/python3 is a stub
# that only works once the Command Line Tools are installed — without them it
# fails (or pops the CLT install dialog). That case is detected via
# `xcode-select -p` before the stub is ever run, so the probe stays silent.
_have_python3() {
    if [ -z "${_FMLAB_HAVE_PY3:-}" ]; then
        _FMLAB_HAVE_PY3=no
        local py
        py=$(command -v python3 2>/dev/null || true)
        if [ -n "$py" ]; then
            if [ "$py" = /usr/bin/python3 ] && [ "$(uname -s)" = Darwin ] \
                && ! xcode-select -p >/dev/null 2>&1; then
                :   # macOS stub without Command Line Tools
            elif python3 -c 'import sys' >/dev/null 2>&1; then
                _FMLAB_HAVE_PY3=yes
            fi
        fi
    fi
    [ "$_FMLAB_HAVE_PY3" = yes ]
}

# _fmlab_div1 <number> <divisor> — quotient with one decimal ("1.5", "0.3"),
# rounded. awk instead of bc (bc is missing on slim Linux images and in the
# devcontainer); LC_ALL=C keeps the decimal point locale-independent.
_fmlab_div1() {
    LC_ALL=C awk -v n="${1:-0}" -v d="${2:-1}" 'BEGIN { printf "%.1f", (d == 0 ? 0 : n / d) }'
}

# Prints the DuckDB CLI path — PATH first, then the common install locations —
# and returns 1 when none is found.
_fmlab_duckdb_bin() {
    local c
    if c=$(command -v duckdb 2>/dev/null) && [ -n "$c" ]; then
        printf '%s\n' "$c"
        return 0
    fi
    for c in "$HOME/.duckdb/cli/latest/duckdb" /opt/homebrew/bin/duckdb /usr/local/bin/duckdb; do
        if [ -x "$c" ]; then
            printf '%s\n' "$c"
            return 0
        fi
    done
    return 1
}

# ---------------------------------------------------------------------------
# JSON encoding (pure bash — no python3 needed, bash 3.2 compatible)
# ---------------------------------------------------------------------------
#
# The helpers write their result into _JSON_VAL instead of stdout so the emit
# path does not fork a subshell per field.

_json_quote() {
    # $1 = raw string → _JSON_VAL = JSON-quoted string (incl. surrounding quotes).
    # Escapes \ " \n \r \t, other control characters as \u00XX (same output as
    # Python's json.dumps). Non-ASCII bytes (UTF-8) pass through unchanged.
    # Pattern and replacement are quoted so that bash 5.2's patsub_replacement
    # (`&`) and backslash handling cannot interfere.
    local s="${1:-}" bs='\' dq='"'
    s=${s//"$bs"/"$bs$bs"}
    s=${s//"$dq"/"$bs$dq"}
    s=${s//$'\n'/"${bs}n"}
    s=${s//$'\r'/"${bs}r"}
    s=${s//$'\t'/"${bs}t"}
    case "$s" in
        *[$'\001'-$'\037']*)
            # Rare path (e.g. ANSI colour codes): walk the bytes.
            local LC_ALL=C out="" c code i
            for (( i = 0; i < ${#s}; i++ )); do
                c="${s:i:1}"
                case "$c" in
                    [$'\001'-$'\037'])
                        printf -v code '%d' "'$c"
                        printf -v c '\\u%04x' "$code" ;;
                esac
                out="$out$c"
            done
            s="$out" ;;
    esac
    _JSON_VAL="\"$s\""
}

_json_int() {
    # $1 = raw value → _JSON_VAL = JSON integer, or a JSON string if not an integer.
    local v="${1:-}" sign=""
    case "$v" in
        -*) sign="-"; v="${v#-}" ;;
        +*) v="${v#+}" ;;
    esac
    case "$v" in
        ''|*[!0-9]*) _json_quote "${1:-}"; return ;;
    esac
    v="${v#"${v%%[!0]*}"}"                    # strip leading zeros
    [ -n "$v" ] || { v=0; sign=""; }
    _JSON_VAL="$sign$v"
}

_emit_json() {
    # Build a JSON line from key/value pairs, e.g.
    #   _emit_json event log level info msg "Hello"
    # The first arg is taken as the event type (`event` field). All remaining
    # pairs become string fields; a trailing key without value is ignored.
    # Value prefixes type-hint non-string fields: `int=42`, `bool=true`
    # (1/true/yes/on, case-insensitive), `null=`.
    local event="$1"; shift
    local line key
    _json_quote "$event"
    line="{\"event\": $_JSON_VAL"
    while [ $# -ge 2 ]; do
        _json_quote "$1"; key="$_JSON_VAL"
        case "$2" in
            int=*)  _json_int "${2#int=}" ;;
            bool=*)
                case "${2#bool=}" in
                    1|[Tt][Rr][Uu][Ee]|[Yy][Ee][Ss]|[Oo][Nn]) _JSON_VAL=true ;;
                    *) _JSON_VAL=false ;;
                esac ;;
            null=*) _JSON_VAL=null ;;
            *)      _json_quote "$2" ;;
        esac
        line="$line, $key: $_JSON_VAL"
        shift 2
    done
    printf '%s}\n' "$line"
}

# ---------------------------------------------------------------------------
# Public emit helpers — always print to stdout. In QUIET_MODE they emit
# single-line NDJSON; otherwise they print plain text (colour codes optional).
# ---------------------------------------------------------------------------

emit_log() {
    local msg="$*"
    if [ "${QUIET_MODE:-false}" = "true" ]; then
        _emit_json log level info msg "$msg"
    else
        echo "$msg"
    fi
}

emit_warn() {
    local msg="$*"
    if [ "${QUIET_MODE:-false}" = "true" ]; then
        _emit_json log level warn msg "$msg"
    else
        echo "WARNING: $msg" >&2
    fi
}

emit_error() {
    local msg="$*"
    if [ "${QUIET_MODE:-false}" = "true" ]; then
        _emit_json log level error msg "$msg"
    else
        echo "ERROR: $msg" >&2
    fi
}

# emit_progress <phase> <pct 0..100> [<msg>]
emit_progress() {
    local phase="${1:-}"
    local pct="${2:-0}"
    local msg="${3:-}"
    if [ "${QUIET_MODE:-false}" = "true" ]; then
        _emit_json progress phase "$phase" pct "int=$pct" msg "$msg"
    else
        if [ -n "$msg" ]; then
            echo "[$phase ${pct}%] $msg"
        else
            echo "[$phase ${pct}%]"
        fi
    fi
}

# ---------------------------------------------------------------------------
# Phase-Budget — mapping a logical phase to a percentage range so the bar
# fills continuously even inside a long step.
#
# Usage in the calling script:
#
#   set_phase_budget "check:0-10 download:10-40 extract:40-60 install:60-80 \
#                     parse:80-90 register:90-95 done:95-100"
#
#   phase_progress extract 0       # → emits progress(extract, 40)
#   phase_progress extract 50      # → emits progress(extract, 50)
#   phase_progress extract 100 "done"  # → emits progress(extract, 60, "done")
#
# Without a budget, phase_progress falls back to the raw value (treats the
# 0..100 input as a global pct, identical to calling emit_progress directly).
# ---------------------------------------------------------------------------

# Bash 3 (macOS default) hat keine assoziativen Arrays — wir benutzen zwei
# parallele Arrays für die Phase-Namen und ihre Ranges (Format: "min:max").
__PHASE_NAMES=()
__PHASE_RANGES=()

set_phase_budget() {
    __PHASE_NAMES=()
    __PHASE_RANGES=()
    local spec
    for spec in "$@"; do
        # Allow either one "name:min-max" per arg or a whitespace list in $1.
        for token in $spec; do
            local name="${token%%:*}"
            local range="${token#*:}"
            if [ -z "$name" ] || [ "$name" = "$range" ]; then
                continue
            fi
            __PHASE_NAMES+=("$name")
            __PHASE_RANGES+=("$range")
        done
    done
}

_phase_range() {
    # Echoes "<min> <max>" for the given phase name, or nothing if unknown.
    local target="$1"
    local i
    for ((i = 0; i < ${#__PHASE_NAMES[@]}; i++)); do
        if [ "${__PHASE_NAMES[$i]}" = "$target" ]; then
            local range="${__PHASE_RANGES[$i]}"
            echo "${range%-*} ${range#*-}"
            return 0
        fi
    done
}

# phase_progress <phase> <within-phase-pct 0..100> [<msg>]
phase_progress() {
    local phase="${1:-}"
    local local_pct="${2:-0}"
    local msg="${3:-}"
    if [ "$local_pct" -lt 0 ]; then local_pct=0; fi
    if [ "$local_pct" -gt 100 ]; then local_pct=100; fi

    local range
    range=$(_phase_range "$phase")
    if [ -z "$range" ]; then
        # No budget configured — pass through as global pct.
        emit_progress "$phase" "$local_pct" "$msg"
        return
    fi
    local min="${range% *}"
    local max="${range#* }"
    local span=$((max - min))
    local pct=$((min + (local_pct * span) / 100))
    emit_progress "$phase" "$pct" "$msg"
}

# ---------------------------------------------------------------------------
# copy_with_progress <src> <dst> [<phase>] [<poll_interval_seconds>]
#
# Runs `cp -R <src> <dst>` in the background and polls the destination size
# against the source size to emit `phase_progress` updates roughly every
# `poll_interval` seconds (default 1). Falls back to a no-progress copy if
# `du` is unavailable. Returns the cp exit code.
# ---------------------------------------------------------------------------
copy_with_progress() {
    local src="$1"
    local dst="$2"
    local phase="${3:-copy}"
    local interval="${4:-1}"

    if [ -z "$src" ] || [ -z "$dst" ]; then
        emit_error "copy_with_progress: missing src or dst"
        return 2
    fi
    if ! command -v du >/dev/null 2>&1; then
        cp -R "$src" "$dst"
        return $?
    fi

    local total_kb
    total_kb=$(du -sk "$src" 2>/dev/null | cut -f1)
    total_kb=${total_kb:-0}
    if [ "$total_kb" -le 0 ]; then
        cp -R "$src" "$dst"
        return $?
    fi

    cp -R "$src" "$dst" &
    local cp_pid=$!

    phase_progress "$phase" 0 "Copying $(basename "$src")..."
    while kill -0 "$cp_pid" 2>/dev/null; do
        sleep "$interval"
        local current_kb
        current_kb=$(du -sk "$dst" 2>/dev/null | cut -f1)
        current_kb=${current_kb:-0}
        local pct=$((100 * current_kb / total_kb))
        [ "$pct" -gt 99 ] && pct=99
        phase_progress "$phase" "$pct" ""
    done

    wait "$cp_pid"
    local rc=$?
    if [ $rc -eq 0 ]; then
        phase_progress "$phase" 100 ""
    fi
    return $rc
}

# ---------------------------------------------------------------------------
# watch_file_count <watch_dir> <glob> <expected_files> <phase> [<sub_min>] [<sub_max>] [<interval>]
#
# Spawns a background poller that emits `phase_progress` every <interval> seconds
# (default 1) based on the number of files in <watch_dir> matching <glob>, scaled
# against <expected_files>. Useful for long-running external commands (crawlers,
# downloaders) that don't emit their own progress events.
#
# When <sub_min>/<sub_max> are given, the local 0..100 progress is mapped onto
# that slice of the phase budget — this lets a single phase be sub-divided
# across multiple iterations (e.g. one slice per language inside a crawl phase).
# Defaults: sub_min=0, sub_max=100 (= use the full phase budget).
#
# PID handover via the global WATCH_PID variable (NOT via stdout — the poller
# inherits stdout and would otherwise hold a `$()`-capture open indefinitely).
# The caller MUST kill the PID once their work finishes:
#
#     watch_file_count "$dir" '*.html' 1074 crawl 0 50
#     POLL_PID=$WATCH_PID
#     run_actual_work
#     kill "$POLL_PID" 2>/dev/null || true
#     wait "$POLL_PID" 2>/dev/null || true
#
# Caps at 99 % locally so the bar doesn't visually "finish" before the real
# command exits — the caller emits the 100 % mark.
#
# Returns 0 on successful spawn, non-zero (and leaves WATCH_PID empty) on
# argument errors so the caller can no-op silently.
# ---------------------------------------------------------------------------
WATCH_PID=""

watch_file_count() {
    WATCH_PID=""
    local watch_dir="$1"
    local glob="$2"
    local expected="$3"
    local phase="$4"
    local sub_min="${5:-0}"
    local sub_max="${6:-100}"
    local interval="${7:-1}"

    if [ -z "$watch_dir" ] || [ -z "$glob" ] || [ -z "$phase" ]; then
        emit_warn "watch_file_count: missing required arg (dir/glob/phase)"
        return 1
    fi
    if [ -z "$expected" ] || [ "$expected" -le 0 ] 2>/dev/null; then
        emit_warn "watch_file_count: invalid expected=$expected for phase=$phase"
        return 1
    fi

    local span=$((sub_max - sub_min))
    if [ "$span" -le 0 ]; then
        emit_warn "watch_file_count: empty sub-slice ($sub_min..$sub_max) for phase=$phase"
        return 1
    fi

    # The poller is a detached subshell. `trap … TERM` makes it exit cleanly
    # when the caller signals it. `sleep` is short (default 1 s) so the trap
    # response stays snappy.
    (
        trap 'exit 0' TERM INT
        while true; do
            local count=0
            if [ -d "$watch_dir" ]; then
                count=$(find "$watch_dir" -name "$glob" 2>/dev/null | wc -l | tr -d ' ')
            fi
            local local_pct=$((100 * count / expected))
            [ "$local_pct" -lt 0 ] && local_pct=0
            [ "$local_pct" -gt 99 ] && local_pct=99
            local sub_pct=$((sub_min + (local_pct * span) / 100))
            phase_progress "$phase" "$sub_pct" ""
            sleep "$interval"
        done
    ) &
    WATCH_PID=$!
    return 0
}

# emit_check <installed:bool> <local_version> <remote_version> <update_available:bool> [<extra_json_args>...]
emit_check() {
    local installed="${1:-false}"
    local local_v="${2:-}"
    local remote_v="${3:-}"
    local update_avail="${4:-false}"
    shift 4 || true
    if [ "${QUIET_MODE:-false}" = "true" ]; then
        _emit_json check \
            installed     "bool=$installed" \
            local_version "${local_v:-null=}" \
            remote_version "${remote_v:-null=}" \
            update_available "bool=$update_avail" \
            "$@"
    else
        echo "Doc-set status:"
        echo "  installed:        $installed"
        echo "  local version:    ${local_v:-(none)}"
        echo "  remote version:   ${remote_v:-(unknown)}"
        echo "  update available: $update_avail"
    fi
}

# emit_done <ok:bool> [<msg>]
emit_done() {
    local ok="${1:-true}"
    local msg="${2:-}"
    if [ "${QUIET_MODE:-false}" = "true" ]; then
        _emit_json done ok "bool=$ok" msg "$msg"
    fi
    # Non-quiet mode keeps the script's own SUCCESS/FAILURE summary.
}

# ---------------------------------------------------------------------------
# Prompt helper — returns 0 (yes) automatically in QUIET_MODE, otherwise
# falls back to an interactive y/n read.
#
# Usage:
#   if confirm_or_quiet "Replace existing docs?"; then ... ; fi
# ---------------------------------------------------------------------------
confirm_or_quiet() {
    local prompt="${1:-Continue?}"
    if [ "${QUIET_MODE:-false}" = "true" ]; then
        emit_log "Auto-confirming: $prompt"
        return 0
    fi
    if [ ! -t 0 ]; then
        # Non-interactive shell, no quiet flag — refuse to silently assume yes.
        emit_warn "Non-interactive shell and no --quiet flag — declining: $prompt"
        return 1
    fi
    read -p "$prompt (y/n): " -n 1 -r
    echo ""
    [[ $REPLY =~ ^[Yy]$ ]]
}

# ---------------------------------------------------------------------------
# Manifest self-heal helper
# ---------------------------------------------------------------------------
# Returns 0 if docset <id> is recorded in .fmlab/docs.json installed[], else 1.
#
# Installers use this to detect a DESYNCED manifest: the docs are physically
# present and the version is current, but the installed[] entry is missing —
# e.g. an older release tracked .fmlab/docs.json and a `git pull` reset it, so
# the files on disk stay but the registration is gone. In that state the docset
# vanishes from the web UI and a normal "already up to date" early-exit would
# loop forever. The installer should instead re-register from the on-disk files
# (its register_docs() reads counts straight from the local index — no download).
#
# Fail-safe: a missing manifest, no node, or unreadable JSON returns 0
# ("registered") so we never nag when we cannot check — or, for a missing
# manifest, would risk clobbering the maintainer-curated catalog[] by recreating
# the file from scratch. The real bug (entry lost, file+catalog intact) is the
# case this heals.

# Path of the install-state file to inspect (empty when there is none):
# installed[] lives in the runtime overlay (.fmlab/docs.installed.json); fall back
# to a legacy single-file docs.json that still carries installed[]. Both are read
# the same way — the key is present in installed[] or it isn't.
_docs_state_file() {
    local overlay="${PROJECT_ROOT}/.fmlab/docs.installed.json"
    local legacy="${PROJECT_ROOT}/.fmlab/docs.json"
    if [ -f "$overlay" ]; then
        printf '%s\n' "$overlay"
    elif [ -f "$legacy" ]; then
        printf '%s\n' "$legacy"
    fi
}

# Runs a node check that exits 10 for "condition failed"; every other outcome
# (node missing or broken, unreadable JSON, any exception) counts as passed.
_docs_node_check() {
    command -v node >/dev/null 2>&1 || return 0
    local rc=0
    node -e "$@" 2>/dev/null || rc=$?
    [ "$rc" -ne 10 ]
}

docs_is_registered() {
    local target
    target=$(_docs_state_file)
    [ -n "$target" ] || return 0                     # nothing to check → don't nag
    _docs_node_check '
try {
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const hit = (data.installed || []).some((e) => e && typeof e === "object" && e.id === process.argv[2]);
  process.exit(hit ? 0 : 10);
} catch { process.exit(0); }  // unreadable → do not nag / do not risk recreating the catalog
' "$target" "$1"
}

# Returns 1 if docset <id> is registered in installed[] but stats.<field> is not
# a number (e.g. an install without a SQLite reader registered null counts),
# else 0.
#
# Installers combine this with their own index count to re-register a current
# docset whose counts are missing — no download. Same fail-safe as
# docs_is_registered: no manifest, no node, unreadable JSON or no entry at all
# return 0 (the missing entry is docs_is_registered's case).
docs_has_stats() {
    local target
    target=$(_docs_state_file)
    [ -n "$target" ] || return 0
    _docs_node_check '
try {
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const entry = (data.installed || []).find((e) => e && typeof e === "object" && e.id === process.argv[2]);
  if (!entry) process.exit(0);
  process.exit(Number.isInteger((entry.stats || {})[process.argv[3]]) ? 0 : 10);
} catch { process.exit(0); }
' "$target" "$1" "$2"
}
