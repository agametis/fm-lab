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
# JSON-safe encoding (uses python3 — required by the wider toolchain anyway)
# ---------------------------------------------------------------------------

_json_string() {
    # $1 = raw string. Prints a JSON-quoted string (incl. surrounding quotes).
    python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.argv[1]))' "${1:-}"
}

_emit_json() {
    # Build a JSON line from key/value pairs, e.g.
    #   _emit_json event log level info msg "Hello"
    # The first arg is taken as the event type (`event` field). All remaining
    # pairs become string fields. Pairs of the form `key:int=42` or `key:bool=true`
    # type-hint the value.
    local event="$1"; shift
    python3 - "$event" "$@" <<'PY'
import json
import sys

def _typed(value: str):
    # Allow "int=42" or "bool=true" prefixes for non-string fields.
    if value.startswith("int="):
        try:
            return int(value[4:])
        except ValueError:
            return value[4:]
    if value.startswith("bool="):
        return value[5:].lower() in ("1", "true", "yes", "on")
    if value.startswith("null="):
        return None
    return value

event = sys.argv[1]
data = {"event": event}
args = sys.argv[2:]
for i in range(0, len(args), 2):
    if i + 1 >= len(args):
        break
    data[args[i]] = _typed(args[i + 1])
sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
PY
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
