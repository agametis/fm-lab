#!/bin/bash
# katana-xml/lib/webbed_caps.sh — webbed Capability-/Versions-Probes (Manifest-getrieben).
#
# Modul von tools/convert_fm_xml.sh (§7.1 Shell-Split) — reine Code-Bewegung,
# Verhalten unverändert. NICHT eigenständig ausführbar: wird vom Treiber
# ge-sourced (Existenz-Check dort, A-B10) und nutzt dessen Globals
# (PROJECT_ROOT, DUCKDB_BIN, WEBBED_*-Konfiguration).
# bash-3.2-Disziplin (macOS system-bash): kein `case` in $(…), kein bash-4+.

# webbed Capability-Registry (datengetrieben). LAUFZEIT-Quelle des Version-Checks:
# tools/katana-xml/version_check.json — die einzige Mechanismus-Quelle. Die Planungs-
# doku project/webbed_version_check.md / webbed_project.md ist NUR intern und wird
# hier NICHT gelesen. _vc_probe_sql <cap-id> liefert die im Manifest hinterlegte
# probe_sql (@FIXTURE@ -> probe_fixture aufgeloest); leer, wenn Manifest/jq/Eintrag
# fehlen → der Caller faellt auf den Hardcode-Fallback zurueck (robust, kein
# Schwaechen des Versions-Floors). Bewusst nur String-Operationen (bash-3.2-safe).
WEBBED_VERSION_CHECK_MANIFEST="${FM_WEBBED_MANIFEST:-$PROJECT_ROOT/tools/katana-xml/version_check.json}"
_vc_probe_sql() {
    local _id="$1" _s _fix
    { [ -f "$WEBBED_VERSION_CHECK_MANIFEST" ] && command -v jq >/dev/null 2>&1; } || return 0
    _s="$(jq -r --arg id "$_id" '.capabilities[] | select(.id==$id) | .probe_sql // empty' \
            "$WEBBED_VERSION_CHECK_MANIFEST" 2>/dev/null)"
    { [ -n "$_s" ] && [ "$_s" != "null" ]; } || return 0
    # per-Capability probe_fixture (Override) → sonst die #98-Default-Fixture $WEBBED_SAX_PROBE.
    _fix="$(jq -r --arg id "$_id" '.capabilities[] | select(.id==$id) | .probe_fixture // empty' \
            "$WEBBED_VERSION_CHECK_MANIFEST" 2>/dev/null)"
    if [ -n "$_fix" ] && [ "$_fix" != "null" ]; then _fix="$PROJECT_ROOT/$_fix"; else _fix="$WEBBED_SAX_PROBE"; fi
    printf '%s' "${_s//@FIXTURE@/$_fix}"
}

_probe_webbed_caps() {
    local _tgt="${FM_WEBBED_EXT:-webbed}" _flags=() _load _out _cr _ws
    if [ "$_tgt" = "webbed" ]; then _load="LOAD webbed;"; else _load="LOAD '$_tgt';"; _flags+=(-unsigned); fi
    # #98 nested-attr-SAX + streaming-Param (Single Source: $_vc_nested_probe_sql)
    _out=$("$DUCKDB_BIN" "${_flags[@]}" :memory: -noheader -list -c "${_load} ${_vc_nested_probe_sql};" 2>&1)
    # Roh-Ausgabe der LOAD+Probe exponieren, damit der Treiber bei einem nicht
    # klassifizierbaren Fehler (→ streaming-Param=unknown, z. B. `LOAD webbed`
    # schlägt fehl) die echte webbed-Meldung anzeigen kann statt nur "unknown".
    WEBBED_PROBE_RAW="$_out"
    case "$_out" in
        *"Invalid named parameter"*) WEBBED_HAS_STREAMING_PARAM=false; WEBBED_HAS_NESTED_ATTR_FIX=false ;;
        1)                           WEBBED_HAS_STREAMING_PARAM=true;  WEBBED_HAS_NESTED_ATTR_FIX=true ;;
        0)                           WEBBED_HAS_STREAMING_PARAM=true;  WEBBED_HAS_NESTED_ATTR_FIX=false ;;
        *)                           WEBBED_HAS_STREAMING_PARAM=unknown; WEBBED_HAS_NESTED_ATTR_FIX=false ;;
    esac
    # #109 SAX-CR-Paritaet ($_vc_cr_probe_sql): 1 = CR DOM-treu erhalten (gefixt)
    _cr=$("$DUCKDB_BIN" "${_flags[@]}" :memory: -noheader -list -c "${_load} ${_vc_cr_probe_sql};" 2>&1)
    [ "$_cr" = "1" ] && WEBBED_HAS_CR_PARITY=true || WEBBED_HAS_CR_PARITY=false
    # #73 Whitespace-Preservation ($_vc_ws_probe_sql): 1 = Umbruch nativ bewahrt (DOM)
    _ws=$("$DUCKDB_BIN" "${_flags[@]}" :memory: -noheader -list -c "${_load} ${_vc_ws_probe_sql};" 2>&1)
    [ "$_ws" = "1" ] && WEBBED_HAS_WS_PRESERVE=true || WEBBED_HAS_WS_PRESERVE=false
}
