#!/bin/bash
# katana-xml/lib/webbed_caps.sh — webbed capability/version probes (manifest-driven).
#
# Module of tools/convert_fm_xml.sh (shell split) — pure code movement,
# behaviour unchanged. NOT independently executable: is sourced by the driver
# (existence check there, A-B10) and uses its globals
# (PROJECT_ROOT, DUCKDB_BIN, WEBBED_* configuration).
# bash-3.2 discipline (macOS system bash): no `case` in $(…), no bash-4+.

# webbed capability registry (data-driven). RUNTIME source of the version check:
# tools/katana-xml/version_check.json — the single mechanism source. The planning
# docs project/webbed_version_check.md / webbed_project.md are internal ONLY and are
# NOT read here. _vc_probe_sql <cap-id> returns the probe_sql stored in the manifest
# (@FIXTURE@ -> probe_fixture resolved); empty when manifest/jq/entry
# are missing → the caller falls back to the hardcoded fallback (robust, no
# weakening of the version floor). Deliberately string operations only (bash-3.2-safe).
WEBBED_VERSION_CHECK_MANIFEST="${FM_WEBBED_MANIFEST:-$PROJECT_ROOT/tools/katana-xml/version_check.json}"
_vc_probe_sql() {
    local _id="$1" _s _fix
    { [ -f "$WEBBED_VERSION_CHECK_MANIFEST" ] && command -v jq >/dev/null 2>&1; } || return 0
    _s="$(jq -r --arg id "$_id" '.capabilities[] | select(.id==$id) | .probe_sql // empty' \
            "$WEBBED_VERSION_CHECK_MANIFEST" 2>/dev/null)"
    { [ -n "$_s" ] && [ "$_s" != "null" ]; } || return 0
    # per-capability probe_fixture (override) → otherwise the #98 default fixture $WEBBED_SAX_PROBE.
    _fix="$(jq -r --arg id "$_id" '.capabilities[] | select(.id==$id) | .probe_fixture // empty' \
            "$WEBBED_VERSION_CHECK_MANIFEST" 2>/dev/null)"
    if [ -n "$_fix" ] && [ "$_fix" != "null" ]; then _fix="$PROJECT_ROOT/$_fix"; else _fix="$WEBBED_SAX_PROBE"; fi
    printf '%s' "${_s//@FIXTURE@/$_fix}"
}

_probe_webbed_caps() {
    local _tgt="${FM_WEBBED_EXT:-webbed}" _flags=() _load _out _cr _ws
    if [ "$_tgt" = "webbed" ]; then _load="LOAD webbed;"; else _load="LOAD '$_tgt';"; _flags+=(-unsigned); fi
    # #98 nested-attr-SAX + streaming param (single source: $_vc_nested_probe_sql)
    _out=$("$DUCKDB_BIN" "${_flags[@]}" :memory: -noheader -list -c "${_load} ${_vc_nested_probe_sql};" 2>&1)
    # Expose the raw LOAD+probe output so the driver, on a non-classifiable
    # error (→ streaming-param=unknown, e.g. `LOAD webbed` fails), can show the
    # real webbed message instead of just "unknown".
    WEBBED_PROBE_RAW="$_out"
    case "$_out" in
        *"Invalid named parameter"*) WEBBED_HAS_STREAMING_PARAM=false; WEBBED_HAS_NESTED_ATTR_FIX=false ;;
        1)                           WEBBED_HAS_STREAMING_PARAM=true;  WEBBED_HAS_NESTED_ATTR_FIX=true ;;
        0)                           WEBBED_HAS_STREAMING_PARAM=true;  WEBBED_HAS_NESTED_ATTR_FIX=false ;;
        *)                           WEBBED_HAS_STREAMING_PARAM=unknown; WEBBED_HAS_NESTED_ATTR_FIX=false ;;
    esac
    # #109 SAX CR parity ($_vc_cr_probe_sql): 1 = CR preserved DOM-faithful (fixed)
    _cr=$("$DUCKDB_BIN" "${_flags[@]}" :memory: -noheader -list -c "${_load} ${_vc_cr_probe_sql};" 2>&1)
    [ "$_cr" = "1" ] && WEBBED_HAS_CR_PARITY=true || WEBBED_HAS_CR_PARITY=false
    # #73 whitespace preservation ($_vc_ws_probe_sql): 1 = linebreak preserved natively (DOM)
    _ws=$("$DUCKDB_BIN" "${_flags[@]}" :memory: -noheader -list -c "${_load} ${_vc_ws_probe_sql};" 2>&1)
    [ "$_ws" = "1" ] && WEBBED_HAS_WS_PRESERVE=true || WEBBED_HAS_WS_PRESERVE=false
}
