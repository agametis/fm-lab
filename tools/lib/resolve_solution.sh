# resolve_solution.sh — the ONE solution-context cascade for all CLI tools.
# Source this file (do not execute); the caller must have PROJECT_ROOT set.
#
# Cascade (specific beats general; each level optional):
#   K0  explicit id passed as $1 (e.g. from a --solution flag)
#   K1  session:   FMLAB_SOLUTION env var, else FMLAB_CONTEXT → named context
#                  file .fmlab/contexts/<name>.json (key "solution")
#   K2  workspace default: .fmlab/active_solution.json pointer
#   K3  'default'
#
# Contract of fmlab_resolve_solution [explicit-id]:
#   On success (return 0) sets:
#     FMLAB_RESOLVED_SOLUTION  resolved id
#     FMLAB_RESOLVED_SOURCE    flag | env | context | pointer | default
#   Errors (return 1, message on stderr) — a bad id at ANY level is a hard
#   error, never a silent fall-through to the next level (a typo must not run
#   an analysis against the wrong database):
#     - syntactically invalid id at any level
#     - K1 naming a solution without a bundle directory (a pinned session on a
#       deleted solution must scream, not heal)
#     - FMLAB_CONTEXT without a readable context file / "solution" key
#   Exception (invariant I1): a POINTER naming a missing solution heals to
#   'default' with a WARN — the pointer is workspace comfort, not a pin.
#   K0 existence is deliberately NOT enforced here: whether an explicit id may
#   create its bundle (convert does) is the caller's decision.
#
# bash-3.2 compatible (macOS system bash): no case in $(…), no bash-4+ features.

_fmlab_valid_id() {
    case "$1" in
        ''|.|..|*/*|*\\*) return 1 ;;
        *) return 0 ;;
    esac
}

# $1=file $2=key — first top-level string value (pure sed, no python/jq dependency)
_fmlab_json_get() {
    sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n1
}

fmlab_resolve_solution() {
    FMLAB_RESOLVED_SOLUTION=""
    FMLAB_RESOLVED_SOURCE=""
    if [ -z "${PROJECT_ROOT:-}" ]; then
        echo "ERROR: resolve_solution.sh requires PROJECT_ROOT to be set before sourcing." >&2
        return 1
    fi
    local explicit="${1:-}"

    # K0 — explicit id (flag)
    if [ -n "$explicit" ]; then
        if ! _fmlab_valid_id "$explicit"; then
            echo "ERROR: invalid solution id '$explicit' (plain directory name, no '/')." >&2
            return 1
        fi
        FMLAB_RESOLVED_SOLUTION="$explicit"
        FMLAB_RESOLVED_SOURCE="flag"
        return 0
    fi

    # K1 — session env var
    if [ -n "${FMLAB_SOLUTION:-}" ]; then
        if ! _fmlab_valid_id "$FMLAB_SOLUTION"; then
            echo "ERROR: FMLAB_SOLUTION='$FMLAB_SOLUTION' is not a valid solution id." >&2
            return 1
        fi
        if [ ! -d "$PROJECT_ROOT/solutions/$FMLAB_SOLUTION" ]; then
            echo "ERROR: FMLAB_SOLUTION names unknown solution '$FMLAB_SOLUTION' (no solutions/$FMLAB_SOLUTION/) — unset it or fix the id." >&2
            return 1
        fi
        FMLAB_RESOLVED_SOLUTION="$FMLAB_SOLUTION"
        FMLAB_RESOLVED_SOURCE="env"
        return 0
    fi

    # K1 — named session context
    if [ -n "${FMLAB_CONTEXT:-}" ]; then
        if ! _fmlab_valid_id "$FMLAB_CONTEXT"; then
            echo "ERROR: FMLAB_CONTEXT='$FMLAB_CONTEXT' is not a valid context name." >&2
            return 1
        fi
        local _ctx_file="$PROJECT_ROOT/.fmlab/contexts/$FMLAB_CONTEXT.json"
        if [ ! -f "$_ctx_file" ]; then
            echo "ERROR: FMLAB_CONTEXT='$FMLAB_CONTEXT' has no context file ($_ctx_file) — create it with: tools/solution.sh context create $FMLAB_CONTEXT --solution <id>" >&2
            return 1
        fi
        local _ctx_solution
        _ctx_solution=$(_fmlab_json_get "$_ctx_file" solution)
        if [ -z "$_ctx_solution" ] || ! _fmlab_valid_id "$_ctx_solution"; then
            echo "ERROR: context '$FMLAB_CONTEXT' has no valid \"solution\" key ($_ctx_file)." >&2
            return 1
        fi
        if [ ! -d "$PROJECT_ROOT/solutions/$_ctx_solution" ]; then
            echo "ERROR: context '$FMLAB_CONTEXT' names unknown solution '$_ctx_solution' (no solutions/$_ctx_solution/)." >&2
            return 1
        fi
        FMLAB_RESOLVED_SOLUTION="$_ctx_solution"
        FMLAB_RESOLVED_SOURCE="context"
        return 0
    fi

    # K2 — workspace default (pointer file)
    local _pointer="$PROJECT_ROOT/.fmlab/active_solution.json"
    if [ -f "$_pointer" ]; then
        local _from_pointer
        _from_pointer=$(_fmlab_json_get "$_pointer" active)
        if [ -n "$_from_pointer" ] && _fmlab_valid_id "$_from_pointer"; then
            if [ -d "$PROJECT_ROOT/solutions/$_from_pointer" ]; then
                FMLAB_RESOLVED_SOLUTION="$_from_pointer"
                FMLAB_RESOLVED_SOURCE="pointer"
                return 0
            fi
            # Invariant I1: the pointer heals, a session pin does not.
            echo "WARNING: active-solution pointer names missing solution '$_from_pointer' — falling back to 'default'." >&2
        fi
    fi

    # K3 — last resort
    FMLAB_RESOLVED_SOLUTION="default"
    FMLAB_RESOLVED_SOURCE="default"
    return 0
}
