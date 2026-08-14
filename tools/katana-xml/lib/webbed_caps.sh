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
# docs project/konzept/xml-import/webbed/webbed_version_check.md / webbed_project.md are internal ONLY and are
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

# Reduce a probe's captured 2>&1 output to its last non-empty, trimmed line.
# The DuckDB CLI can prepend banner lines to the result (e.g. a
# "-- Loading resources from …" notice when a user init file is present), which
# would break an exact match against the whole block. Keeping only the final
# value line makes the value comparison robust against such prefixes.
# Deliberately awk/sed only (bash-3.2-safe, no bash-4+ constructs).
_last_value_line() {
    printf '%s\n' "$1" | awk 'NF{v=$0} END{print v}' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

_probe_webbed_caps() {
    local _tgt="${FM_WEBBED_EXT:-webbed}" _flags=() _load _out _val _cr _ws
    # -no-init: run every probe against a pristine CLI, ignoring any user
    # ~/.duckdbrc — its banner line would otherwise contaminate the output and
    # silently derail the value match below.
    if [ "$_tgt" = "webbed" ]; then _load="LOAD webbed;"; else _load="LOAD '$_tgt';"; _flags+=(-unsigned); fi
    # #98 nested-attr-SAX + streaming param (single source: $_vc_nested_probe_sql)
    _out=$("$DUCKDB_BIN" "${_flags[@]}" :memory: -no-init -noheader -list -c "${_load} ${_vc_nested_probe_sql};" 2>&1)
    # Expose the raw LOAD+probe output so the driver, on a non-classifiable
    # error (→ streaming-param=unknown, e.g. `LOAD webbed` fails), can show the
    # real webbed message instead of just "unknown".
    WEBBED_PROBE_RAW="$_out"
    _val=$(_last_value_line "$_out")
    # Error patterns are matched against the full (possibly multi-line) output;
    # the 0/1 value only against the trimmed last line.
    case "$_out" in
        *"Invalid named parameter"*) WEBBED_HAS_STREAMING_PARAM=false; WEBBED_HAS_NESTED_ATTR_FIX=false ;;
        *)
            case "$_val" in
                1) WEBBED_HAS_STREAMING_PARAM=true;    WEBBED_HAS_NESTED_ATTR_FIX=true ;;
                0) WEBBED_HAS_STREAMING_PARAM=true;    WEBBED_HAS_NESTED_ATTR_FIX=false ;;
                *) WEBBED_HAS_STREAMING_PARAM=unknown; WEBBED_HAS_NESTED_ATTR_FIX=false ;;
            esac ;;
    esac
    # #109 SAX CR parity ($_vc_cr_probe_sql): 1 = CR preserved DOM-faithful (fixed)
    _cr=$(_last_value_line "$("$DUCKDB_BIN" "${_flags[@]}" :memory: -no-init -noheader -list -c "${_load} ${_vc_cr_probe_sql};" 2>&1)")
    [ "$_cr" = "1" ] && WEBBED_HAS_CR_PARITY=true || WEBBED_HAS_CR_PARITY=false
    # #73 whitespace preservation ($_vc_ws_probe_sql): 1 = linebreak preserved natively (DOM)
    _ws=$(_last_value_line "$("$DUCKDB_BIN" "${_flags[@]}" :memory: -no-init -noheader -list -c "${_load} ${_vc_ws_probe_sql};" 2>&1)")
    [ "$_ws" = "1" ] && WEBBED_HAS_WS_PRESERVE=true || WEBBED_HAS_WS_PRESERVE=false
}
