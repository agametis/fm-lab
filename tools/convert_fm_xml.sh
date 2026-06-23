#!/bin/bash
# FileMaker XML to DuckDB Conversion Script
# version 4.4.0 - 2026-06-19
#
#
#   *** KATANA XML Engine ***
# - Part of the FM-Lab project
# - Architected by Marcel Moré
# - Built with Claude Code
# - Forged through countless refinements
# - Proven by hundreds of test cuts
#
#
# This script automates the conversion of FileMaker XML exports to DuckDB database.
# It handles UTF-16 to UTF-8 encoding conversion automatically.
# Supports both single-file and batch processing modes.
#
# Supported XML formats:
#   - SaXML v2.1.0.0+ (FileMaker 19+) with root element <FMSaveAsXML>
#   - SaXML v2.0.0.0 (FileMaker 18.x) is NOT supported — uses legacy root
#     element <FMDynamicTemplate> which is incompatible with the SQL XPath queries.
#     Files with this root element are skipped with a warning.
#
# Schema versioning & auto-heal:
#   Before every import the script compares the schema version in the SQL template
#   (sql/convert-xml/convert_xml_01_extract.sql: @SCHEMA_VERSION) with the version persisted in
#   the DB table SchemaInfo. On drift a rebuild runs automatically in batch mode
#   (delete the DB, re-import all XMLs). In single-file mode the script aborts
#   instead and points to --batch --force-rebuild.
#
# Usage:
#   convert_fm_xml.sh                                         # No arg: interactive batch default (only at a TTY)
#   convert_fm_xml.sh <xml-filename>                          # Single file mode
#   convert_fm_xml.sh <xml-filename> --force-rebuild          # Single + forced rebuild
#   convert_fm_xml.sh --batch                                 # Batch mode (all XML files)
#   convert_fm_xml.sh --batch --fail-fast                     # Batch mode (stop on first error)
#   convert_fm_xml.sh --batch --force-rebuild                 # Batch + delete DB beforehand
#   convert_fm_xml.sh --batch --no-auto-heal                  # Abort on schema drift instead of rebuilding
#   convert_fm_xml.sh --batch --memory_limit 4GB              # Limit DuckDB RAM (e.g. 4GB, 60%)
#   convert_fm_xml.sh --all                                   # Alias for --batch
#   convert_fm_xml.sh --test                                  # Test mode (xml-test/ → fm_test.duckdb)
#   convert_fm_xml.sh --test --fail-fast                      # Test mode (stop on first error)
#
# Adaptive default (no mode flag): turbo + --auto (OOM backoff) + SAX streaming when
#   the patched webbed is present — robust, never hard-aborts on tight RAM (~2.5 GB
#   floor). Any explicit mode flag below overrides it; FM_FORCE_DOM=1 keeps turbo+auto
#   on DOM. Test mode (--test) stays on the classic deterministic DOM path.
#
# Flags (all optional, freely combinable):
#   --fail-fast            Stop on first error (Batch/Test mode only)
#   --force-rebuild        Delete the DB before import and rebuild it from scratch
#   --no-auto-heal         On schema drift do NOT auto-rebuild — abort instead
#   --memory_limit <value> Limit DuckDB memory (format: 4GB, 512MB, 60%); injected into all
#                          DuckDB runs (Convert, Catalogs, Resolutions, Post-Checks)
#   --split                Chunk Phase 1 per file at top-level branch boundaries
#                          (StepsForScripts + DDR_INFO split out) — lowers the peak DOM
#                          memory for large files. The result is bit-identical to the
#                          unsplit run.
#   --jobs <N>             Run Phase 1 for N files in PARALLEL ('auto' = nproc).
#                          Each file runs into its own part DB, then merges into the
#                          master DB (File_Names disjoint → conflict-free). Default
#                          8 = empirical sweet spot; 1 = sequential. Combinable with
#                          --split (orthogonal: parallel ACROSS files + chunking WITHIN;
#                          lowers per-file RAM peak).
#                          The result is bit-identical to the sequential run.
#   --turbo                Coexisting chunkmap engine. Implies --split; drives
#                          split/sub-chunk over a persistent chunkmap
#                          (db/streaming/chunkmap_<db>.duckdb). Sub-chunk granularity
#                          from --subchunk/FM_SUBCHUNK OR a per-catalog M in the recmap
#                          (FM_SUBCHUNK_RECMAP entries "Branch:RecElem:M"). Phases: S (split+plan)
#                          → D (worker pool over chunks → chunk_<id>.duckdb, W=--jobs) → C
#                          (consolidation into the master). The classic path stays untouched;
#                          the result is bit-identical to --split[ --subchunk] (FilesCatalog.XML_Path aside).
#   --changed-only          File-level manifest skip (implies --turbo). Unchanged XML
#   (Alias: --incremental)  (mtime+size→sha256, plus converter/schema version gate) are skipped
#                          entirely; their master rows remain. The manifest (db/streaming/
#                          manifest_<db>.duckdb) is ALWAYS updated (even in a full build).
#                          --force-rebuild ignores it. The result == full rebuild of the changed
#                          state. NOT to be confused with the schema detection
#                          SCHEMA_ACTION="incremental" (normal import instead of rebuild, a different thing).
#   --auto                 Memory-induced backoff (implies --turbo). If a chunk worker
#                          dies with rc=137 (OOM), ONLY that split-group is cut finer
#                          (mp=⌈record_count/2⌉) and re-dispatched, until it fits the band
#                          or the convergence limit (FM_AUTO_MAX_ATTEMPT, default 4)
#                          is reached; indivisible units (main/DDR_INFO, ≤1 record)
#                          escalate with a clear diagnosis. Test hook: FM_AUTO_TEST_OOM="Cat[:N]".
#   --attempt <N>          Attempt counter (1-based, default 1) for retry tracking;
#                          appears in the log header + JSON sidecar.
#   --retry-reason <slug>  Reason for the retry run. Enum: oom, split-fallback,
#                          memory-limit, timeout, manual; unknown values are marked
#                          'custom' (retry_reason_known=false).
#   --retry-of <log-id>    Base name of the previous (failed) log, for chaining.
#
# Pipeline stages:
#   Script-level stages:
#     [1] Pre-Processor   preprocess_file(): encoding→UTF-8 (BOM sniffing), special-char cleanup
#     [2] Batch           discovery, --memory_limit; per-file Extract(P1), then batch-wide P2–P6
#     [3] Post-Processor  postprocess_db(): plausibility/consistency checks (Calc_UUID guard)
#     [4] Error-Handling  finalize_run(): validity decision, error classification, retry hints
#   Six-phase SQL pipeline (P1 runs once per file; P2–P6 run once after all files are imported):
#     P1 Extract  (sql/convert-xml/convert_xml_01_extract.sql)  — the ONLY phase that reads XML; raw catalogs + raw-XML columns
#     P2 Resolve  (sql/convert-xml/convert_xml_02_resolve.sql)  — tables only; reference/resolution tables
#     P3 Details  (sql/convert-xml/convert_xml_03_details.sql)  — tables only; variable analysis (VariableUsages, VariablesCatalog)
#     P4 Catalog  (sql/convert-xml/convert_xml_04_catalog.sql)  — tables only; ObjectCatalog + ObjectLinks
#     P5 Homes    (sql/convert-xml/convert_xml_05_homes.sql)    — tables only; cross-file resolution (ObjectHomes, TableOccurrenceResolution)
#     P6 Validate (sql/convert-xml/convert_xml_06_validate.sql) — tables only; plausibility/consistency check views, queried by the post-processor
#
# Exit codes:
#   0 - Success
#   1 - File not found / No files found / Validation error / Some files failed
#   2 - UTF-8 conversion failed
#   3 - DuckDB conversion failed
#   4 - Unsupported XML format (e.g. legacy FMDynamicTemplate)
#   5 - XML preprocessing failed
#   6 - Schema drift detected (single mode or --no-auto-heal): manual rebuild required
#   7 - Concurrency lock collided (another convert is already running)

# Constants
# Converter version (SemVer): version of THIS ingestion script, independent of the
# SQL template's schema version (@SCHEMA_VERSION). Written into the log header so
# logs are comparable by converter version (e.g. to evaluate runtime/memory
# behavior across script revisions). Bump on material changes to script behavior.
#   2.0.0 — six-phase pipeline, --split, DuckDB settings hardening (spill/threads),
#           awk-based timing (bc-free), OOM classification (exit 137).
#   2.1.0 — conversion log v2: phase timeline (P1–P6 individually, P3/P4 separate),
#           object counts per phase, environment context (RAM/CPU/DuckDB settings/spill),
#           retry context (--attempt/--retry-reason/--retry-of) and a machine-readable
#           JSON sidecar (log schema fmlab.convert-log/2.0).
#   2.2.0 — file parallelism (--jobs N): Phase 1 concurrently into part DBs +
#           merge into the master DB (bit-identical). Log options extended with
#           jobs/parallel.
# ── Bash version guard (macOS ships bash 3.2; we exploit newer features when there) ──
# The script body is written to be bash-3.2-safe (the macOS default — no associative
# arrays, no `declare -g`, no `wait -n`). A newer bash (4+) is nonetheless preferred:
# it is faster and sidesteps any 3.2 edge case. So if we are on <4 and a newer bash is
# reachable (commonly Homebrew under /opt/homebrew or /usr/local), re-exec under it.
# If none is found we simply continue on 3.2 — the code path is portable.
# FM_NO_BASH_REEXEC=1 forces the current bash (e.g. to exercise the 3.2 path on a Mac
# that also has Homebrew bash). FM_BASH_REEXECED guards against an exec loop.
if [ -z "${FM_BASH_REEXECED:-}" ] && [ "${BASH_VERSINFO:-0}" -lt 4 ] && [ "${FM_NO_BASH_REEXEC:-}" != "1" ]; then
    for _newbash in /opt/homebrew/bin/bash /usr/local/bin/bash "$(command -v bash 2>/dev/null)"; do
        [ -n "$_newbash" ] && [ -x "$_newbash" ] || continue
        _v="$("$_newbash" -c 'echo ${BASH_VERSINFO:-0}' 2>/dev/null)"
        if [ "${_v:-0}" -ge 4 ]; then
            export FM_BASH_REEXECED=1
            exec "$_newbash" "$0" "$@"
        fi
    done
    # No bash 4+ found → continue on the current (3.2) bash; the code below is 3.2-safe.
fi

# Force a dot decimal separator for ALL numeric formatting. The script computes
# durations with awk and renders them with the bash `printf` builtin (e.g.
# `printf '%11.3fs' "$dur"` in the batch summary). The bash builtin parses %f
# input via the active locale's decimal_point — under a comma locale (de_DE,
# fr_FR, …) it rejects the dot-decimal "0.248" with `printf: invalid number`
# and truncates the value. We pin LC_NUMERIC=C (not LC_ALL=C — that would also
# change LC_CTYPE/collation and affect non-ASCII filenames). Because a present
# LC_ALL outranks LC_NUMERIC, re-express it into the individual categories first
# (preserving the user's effective locale everywhere except numbers), then drop
# it — so the guard holds whether the comma locale comes via LANG or LC_ALL.
if [ -n "${LC_ALL:-}" ]; then
    export LC_CTYPE="$LC_ALL" LC_COLLATE="$LC_ALL" LC_TIME="$LC_ALL" \
           LC_MESSAGES="$LC_ALL" LC_MONETARY="$LC_ALL"
    unset LC_ALL
fi
export LC_NUMERIC=C

CONVERTER_VERSION="2.2.0"
PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd))"
# Six-phase pipeline. Phase 1 (extraction, the only XML-reading phase) and Phase 2
# (reference resolution) live in separate files; the skill script runs them per
# file in sequence.
SQL_TEMPLATE="$PROJECT_ROOT/sql/convert-xml/convert_xml_01_extract.sql"
P2_TEMPLATE="$PROJECT_ROOT/sql/convert-xml/convert_xml_02_resolve.sql"
# Phase 6 (validation): check views for the post-checks.
VALIDATE_TEMPLATE="$PROJECT_ROOT/sql/convert-xml/convert_xml_06_validate.sql"
# awk splitter for --split: moves the heavy top-level branches
# (StepsForScripts, DDR_INFO) into their own chunks to lower the
# Phase-1 peak memory. P2–P5 run unchanged, batch-wide.
SPLITTER_AWK="$PROJECT_ROOT/tools/katana-xml/split_fm_xml.awk"
# Turbo Phase-S pass fusion: ONE awk pass replaces
# clean(tr)+counts(wc/tr)+streamify-rename+split. Used only on the turbo path.
TURBO_FUSE_AWK="$PROJECT_ROOT/tools/katana-xml/turbo_phaseS_fuse.awk"
# awk binary for the Phase-S passes: mawk (typically 2–5× faster on byte/line
# work) preferred, gawk/awk fallback. Override via FM_AWK_BIN. Byte transparency
# is enforced via LC_ALL=C at the call site (mawk is byte-transparent).
AWK_BIN="${FM_AWK_BIN:-$(command -v mawk || command -v gawk || command -v awk)}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# NDJSON-Mode helpers (shared with installer skills). Sourcing the file gives
# us emit_log / emit_progress / phase_progress / emit_done plus the QUIET_MODE
# flag. In default mode these fall back to plain text — the CLI experience is
# unchanged. When the REST-API spawns the script with --quiet (POST
# /api/xml/convert), every emit_* writes NDJSON to stdout instead.
QUIET_MODE=false
# shellcheck source=tools/install_modes.sh
source "$PROJECT_ROOT/tools/install_modes.sh"

# Locate DuckDB binary — check PATH first, then common install locations
DUCKDB_BIN=""
if command -v duckdb &>/dev/null; then
    DUCKDB_BIN=$(command -v duckdb)
else
    for _candidate in \
        "$HOME/.duckdb/cli/latest/duckdb" \
        "/opt/homebrew/bin/duckdb" \
        "/usr/local/bin/duckdb"; do
        if [ -x "$_candidate" ]; then
            DUCKDB_BIN="$_candidate"
            break
        fi
    done
fi
if [ -z "$DUCKDB_BIN" ]; then
    echo "ERROR: DuckDB CLI not found. Install it from https://duckdb.org/docs/installation/"
    exit 1
fi

# ============================================================================
# SAX streaming via a patched webbed extension
# ----------------------------------------------------------------------------
# Phase 1 can drastically lower the XML DOM RAM peak when a webbed build with the
# nested-attr SAX fix (teaguesterling/duckdb_webbed#98) is available. That build
# is built locally → UNSIGNED → needs `duckdb -unsigned` + LOAD by absolute path.
# SAFE-BY-DEFAULT: without a patched build everything runs unchanged on the signed
# stock webbed in the DOM path (no -unsigned, no streaming edits).
#
# Activation: ONLY the opt-in mode --streamify arms the patched mode
# (PATCHED_WEBBED_ACTIVE=true → run_p1_on swaps LOAD to $WEBBED_PATCHED_EXT +
# -unsigned + a capability self-test in the SQL). --streamify aborts hard if the
# artifact under $WEBBED_PATCHED_EXT is missing (no silent fallback in THIS mode).
# All default paths (incl. --split/--turbo/--changed-only) stay on stock webbed/DOM —
# the patched artifact is never a prerequisite there.
# $FM_WEBBED_EXT overrides the default path (the bake path baked into the image).
# FM_FORCE_DOM=1 forces DOM even under --streamify (A/B test); the self-test also
# degrades to DOM at runtime if the loaded webbed turns out not to have the
# nested-attr SAX fix. FM_DOM_THRESHOLD overrides the stream threshold (bytes).
WEBBED_PATCHED_EXT="${FM_WEBBED_EXT:-$HOME/.duckdb/webbed-patched/webbed.duckdb_extension}"
WEBBED_SAX_PROBE="$PROJECT_ROOT/sql/convert-xml/fixtures/webbed_sax_probe.xml"
# Stream threshold (maximum_file_size per read in patched mode). Small enough that
# all real FileMaker XMLs (MB–GB) exceed it → SAX. FM_DOM_THRESHOLD overrides
# (e.g. for tests on small files).
WEBBED_STREAM_THRESHOLD="${FM_DOM_THRESHOLD:-1000000}"
# Streaming (patched webbed + renamer + streamify SQL) is OPT-IN via --streamify
# (hybrid model): the default path stays pure DOM/stock (no auto-streaming). The
# activation decision is made AFTER arg parsing (STREAMIFY_MODE is not yet known here).
PATCHED_WEBBED_ACTIVE=false

# Argument parsing: mode + flags in any order.
# Exactly one positional argument (filename) OR one mode flag is expected.
ORIGINAL_ARGS="$*"   # verbatim invocation args, for the console-log header
MODE=""
FILENAME=""
FAIL_FAST=false
TEST_MODE=false
FORCE_REBUILD=false
NO_AUTO_HEAL=false
SPLIT_MODE=false
STREAMIFY_MODE=false
# Tracks whether the user explicitly chose a Phase-1 strategy (any of
# --split/--subchunk/--turbo/--changed-only/--auto/--streamify). When FALSE the
# adaptive default kicks in (turbo + --auto, plus SAX when the patched webbed is
# present) — see the "Adaptive default" block below. --jobs/--memory_limit are NOT
# strategy choices and do not set this. FM_FORCE_DOM=1 is handled separately (it
# only suppresses SAX, the default stays turbo+auto on DOM).
MODE_EXPLICIT=false
# Turbo mode: a coexisting opt-in engine that drives split/sub-chunk over a
# persistent chunkmap (db/streaming/chunkmap.duckdb) — Phase S (Split & Plan),
# D (Dispatch), C (Consolidate). Additive rollout; the classic path
# (--split/--jobs/--subchunk/--streamify) stays untouched. Implies --split, runs
# sequentially, and sources seq_offset from the chunkmap instead of inline.
TURBO_MODE=false
# Set true by run_turbo_pipeline when a --changed-only run finds NOTHING changed
# (0 pending chunks) AND the catalogs were last fully built (P6) for the current
# manifest state → the batch flow then skips the catalog rebuild (P2–P6) + sync,
# since the master DB is already byte-identical to the previous run. Default false
# so non-turbo batch paths always run P2–P6.
TURBO_NO_CHANGES=false
# --changed-only: file-level manifest skip. Implies --turbo. The manifest
# (db/streaming/manifest_<db>.duckdb, persistent) is ALWAYS updated (even in a full
# build), but only UNDER --changed-only are unchanged files
# (mtime+size→content-hash, plus a converter/schema version gate) skipped entirely.
# --force-rebuild ignores the manifest (everything is rebuilt).
CHANGED_ONLY=false
# --auto: memory-induced backoff. If a chunk worker dies with rc=137
# (OOM SIGKILL), ONLY that split-group is cut finer (halve M), re-inserted into the
# chunkmap with an increased attempt and re-dispatched — until it fits the band or K
# attempts are exhausted. Catalogs that cannot be split further (main/DDR_INFO, M=1)
# escalate (clear diagnosis). Implies --turbo. Test hook: FM_AUTO_TEST_OOM="Catalog[:N]".
AUTO_MODE=false
# Sub-chunking: on --split, additionally cuts the heavy separated branches WITHIN
# into pieces of SUBCHUNK records each → lowers the per-chunk DOM peak. 0/empty = off
# (default; --split behaves unchanged). --subchunk N or FM_SUBCHUNK sets N. SUBCHUNK_RECMAP
# lists the safe branches; a recmap entry implies separation (splitter).
# Default: StepsForScripts:Script + LayoutCatalog:Layout — both fully
# chunk-invariant verified (split==unsplit 0/0 over Layouts/LayoutObjects/LayoutParts/
# ObjectLinks/ObjectCatalog/ScriptCatalog). Three chunk sensitivities had to be fixed for this:
#  ✓ Layouts.Sequence_ID  → seq_offset (ROW_NUMBER() + offset per sub-chunk)
#  ✓ LayoutObjects.Nesting_Level  → deterministic MIN-nesting dedup (Z_Order-DESC
#    tie-break) in the LayoutObjects INSERT (base + streamify override)
#  ✓ names with XML entities  → xml_unescape() on Script_Name/L_Name (webbed-SAX
#    does not decode attribute entities like DOM → was chunk-size-dependent)
# FM_SUBCHUNK_RECMAP override remains possible. LayoutCatalog is the peak setter on large
# files → sub-chunking lowers the P1 RAM peak (membench: −18%). DDR_INFO stays out of it
# (no name-fixed records).
SUBCHUNK="${FM_SUBCHUNK:-0}"
# In turbo mode the LayoutCatalog/StepsForScripts windowing becomes the default
# (SUBCHUNK>0) — it lowers the non-spillable P1 DOM peak (LayoutCatalog is the peak
# setter on large files); the mechanic is chunk-invariant verified (split==unsplit
# 0/0, even on the pure DOM path). The flip applies ONLY when the user has set M
# neither via --subchunk nor via FM_SUBCHUNK. SUBCHUNK_SOURCE tracks the origin;
# "env" also covers FM_SUBCHUNK=0 (opt-out to the coarse path). The classic path
# (--split without --turbo) stays at SUBCHUNK=0 (coarse), unchanged.
if [ -n "${FM_SUBCHUNK+x}" ]; then SUBCHUNK_SOURCE="env"; else SUBCHUNK_SOURCE="default"; fi
SUBCHUNK_RECMAP="${FM_SUBCHUNK_RECMAP:-StepsForScripts:Script LayoutCatalog:Layout}"
# Default M for the turbo windowing flip. Provisionally 25 (proven in the 2-GB full
# build); the final value comes from the peak-vs-wall sweep (M ∈ {50,25,10}).
TURBO_SUBCHUNK_DEFAULT="${FM_TURBO_SUBCHUNK_DEFAULT:-25}"
# NEST map: splits DDR_INFO into a Calculation + a Script chunk (instead of one
# DDR chunk per file) → roughly halves the DDR long pole in the Phase-D dispatch
# and lowers the remaining peak (DDR). Identity: additive UPSERT by UUID, separate
# XPaths. Default: on in turbo mode (see below), otherwise off.
# Opt-out: FM_DDR_NEST=0; explicit map: FM_NEST_MAP="Parent:Child1,Child2 …".
NEST_MAP="${FM_NEST_MAP:-}"
# DDR sub-chunk (plan v5 §5/§8.7, §8.8): cuts the DDR_INFO/Calculation NEST child at
# ObjectList-record boundaries (anchor sc_rec="*", 2-level wrapper) → lowers the irreducible
# DDR-Calculation DOM peak (the ~2.3-GB long pole that --auto cannot resplit). ONLY
# Calculation is sub-chunked (Script is NOT — see _ddr_recmap_for_file: its bare "<_ hash=>"
# records break the Step_UUID key under catmerge). Calc records carry a unique tag-name UUID
# → each lands in one sub-chunk, catmerge plain-INSERT stays collision-free, additive.
#
# CHUNK-EXPLOSION-GUARD (lesson learned): sub-chunking EVERY file's DDR at a small fixed M
# multiplies the chunk count (~380k DDR records corpus-wide; M=3 → ~119k chunks, which once
# crashed the container — 1 chunk = 1 XML file = 1 part-DB = 1 merge in Phase D). M is
# therefore NEVER applied raw: it is computed PER FILE so a single file never exceeds
# FM_DDR_MAX_CHUNKS chunks (M is RAISED if needed — "M im Zweifel erhöhen"). Files below the
# Calc-record gate are not sub-chunked at all, so only genuinely large files are touched.
# A global Phase-S guard (FM_MAX_TOTAL_CHUNKS) is the corpus-wide backstop on top of this.
#
# Engagement (resolved below, AFTER _avail_mb is known):
#   • explicit  FM_DDR_SUBCHUNK=N (N≥1)  → on for every file ≥ gate; N = M floor.
#               FM_DDR_SUBCHUNK=0        → hard off (also disables auto).
#   • auto      (default, FM_DDR_SUBCHUNK unset) → engages ONLY under RAM pressure
#               (_avail_mb < FM_DDR_AUTO_AVAIL_MB); M floor = FM_DDR_AUTO_M.
# Gate (both modes): only files with ≥ FM_DDR_MIN_RECORDS Calculation records.
# Per file: M = max(M_floor, ceil(R_calc / FM_DDR_MAX_CHUNKS)).  Requires turbo + NEST.
DDR_SUBCHUNK="${FM_DDR_SUBCHUNK:-}"            # explicit M (≥1 on / 0 hard-off / empty = auto)
DDR_MAX_CHUNKS="${FM_DDR_MAX_CHUNKS:-1000}"    # hard per-file chunk cap (raises M to honor it)
DDR_AUTO_M="${FM_DDR_AUTO_M:-150}"             # M floor when auto-engaged (peak-vs-count balance)
DDR_MIN_RECORDS="${FM_DDR_MIN_RECORDS:-10000}" # gate: only files with ≥ this many Calc records (peak driver)
DDR_AUTO_AVAIL_MB="${FM_DDR_AUTO_AVAIL_MB:-3000}" # auto trigger: engage when avail RAM below this
DDR_SUBCHUNK_ACTIVE=false                      # resolved: does it engage at all this run?
DDR_AUTO_MODE=false                            # resolved: auto path (RAM-pressure gated) vs explicit
DDR_REQ_M=0                                     # resolved: requested M floor (explicit value or auto)
MEMORY_LIMIT=""
# Number of parallel Phase-1 workers. EMPTY = dynamic default from effectively
# available RAM (cgroup-aware on Linux, vm_stat on macOS — see _detect_avail_mb)
# + nproc + mode (see below). The earlier fixed-8 assumption was tuned for a
# "14-GiB RAM cliff (anon ~9 GiB/63%)" — which turned out to be a fork explosion in
# the per-worker sampler (_tree_rss_kb, fixed), NOT a real RAM limit. RAM demand is
# mode-dependent: streaming ~5 GB base + ~1.3 GB/worker (spillable); DOM ~8-9 GB base
# + ~6 GB/worker (NOT spillable). --jobs N (flag) or FM_JOBS (env) override.
# 1 = sequential; >1 = part-DB parallel path.
JOBS=""
# Retry/attempt context (caller-coordinated): the script itself does not know
# whether this is a retry run — the calling process passes it through.
ATTEMPT=1
RETRY_REASON=""
RETRY_REASON_KNOWN=true
RETRY_OF=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --test)
            MODE="batch"
            TEST_MODE=true
            shift
            ;;
        --memory_limit)
            MEMORY_LIMIT="$2"
            shift 2
            ;;
        --memory_limit=*)
            MEMORY_LIMIT="${1#*=}"
            shift
            ;;
        --batch|--all)
            MODE="batch"
            shift
            ;;
        --fail-fast)
            FAIL_FAST=true
            shift
            ;;
        --force-rebuild)
            FORCE_REBUILD=true
            shift
            ;;
        --no-auto-heal)
            NO_AUTO_HEAL=true
            shift
            ;;
        --split)
            # Chunk Phase 1 per file at top-level branch boundaries (lower memory).
            SPLIT_MODE=true; MODE_EXPLICIT=true
            shift
            ;;
        --subchunk)
            # Additionally cut the heavy separated branches (StepsForScripts) into
            # pieces of N records each. Implies --split.
            SUBCHUNK="$2"; SUBCHUNK_SOURCE="flag"; SPLIT_MODE=true; MODE_EXPLICIT=true
            shift 2
            ;;
        --subchunk=*)
            SUBCHUNK="${1#*=}"; SUBCHUNK_SOURCE="flag"; SPLIT_MODE=true; MODE_EXPLICIT=true
            shift
            ;;
        --turbo)
            # Turbo engine (chunkmap-driven). Implies --split; the sub-chunk
            # granularity comes from --subchunk/FM_SUBCHUNK or the per-catalog M
            # in the recmap (Branch:RecElem:M). Runs sequentially (dispatcher comes later).
            TURBO_MODE=true; SPLIT_MODE=true; MODE_EXPLICIT=true
            shift
            ;;
        --changed-only|--incremental)
            # Manifest skip. Implies --turbo. Without this flag turbo always builds
            # fully; the skip is deliberately placed behind its own flag.
            # --incremental is the old alias name (backward-compatible); NOT to be
            # confused with SCHEMA_ACTION="incremental" (schema detection, different meaning).
            CHANGED_ONLY=true; TURBO_MODE=true; SPLIT_MODE=true; MODE_EXPLICIT=true
            shift
            ;;
        --auto)
            # Memory-induced backoff. Implies --turbo.
            AUTO_MODE=true; TURBO_MODE=true; SPLIT_MODE=true; MODE_EXPLICIT=true
            shift
            ;;
        --streamify|--low-mem)
            # Opt-in SAX streaming path (hybrid): renamer (tools/katana-xml/streamify_fm_xml.awk)
            # + patched webbed + streamify SQL variant. Lowers the RAM peak of the
            # read_xml_objects heavyweights. Requires the patched webbed
            # (otherwise a hard abort).
            STREAMIFY_MODE=true; MODE_EXPLICIT=true
            shift
            ;;
        --jobs)
            JOBS="$2"
            shift 2
            ;;
        --jobs=*)
            JOBS="${1#*=}"
            shift
            ;;
        --attempt)
            ATTEMPT="$2"
            shift 2
            ;;
        --attempt=*)
            ATTEMPT="${1#*=}"
            shift
            ;;
        --retry-reason)
            RETRY_REASON="$2"
            shift 2
            ;;
        --retry-reason=*)
            RETRY_REASON="${1#*=}"
            shift
            ;;
        --retry-of)
            RETRY_OF="$2"
            shift 2
            ;;
        --retry-of=*)
            RETRY_OF="${1#*=}"
            shift
            ;;
        --quiet)
            # Switch all emit_* helpers into NDJSON mode. Used by the REST-API
            # SSE bridge — never set this manually on the command line unless
            # you want to read NDJSON yourself.
            QUIET_MODE=true
            shift
            ;;
        --*)
            echo "ERROR: Unknown flag: $1"
            echo "Usage: $0 <xml-filename> [--force-rebuild] | --batch [--fail-fast] [--force-rebuild] [--no-auto-heal] [--memory_limit <wert>] [--split] [--turbo] [--changed-only] [--auto] [--jobs <N>] [--quiet] [--attempt <N>] [--retry-reason <slug>] [--retry-of <log-id>] | --test [--fail-fast] [--force-rebuild] [--split]"
            exit 1
            ;;
        *)
            if [ -n "$FILENAME" ]; then
                echo "ERROR: Multiple filenames provided ('$FILENAME', '$1'). Use --batch to process all files."
                exit 1
            fi
            FILENAME="$1"
            MODE="single"
            shift
            ;;
    esac
done

# Validate the --memory_limit format (e.g. 4GB, 512MB, 60%). Prevents a typo from
# being silently passed through to DuckDB as SET memory_limit='...'.
if [ -n "$MEMORY_LIMIT" ]; then
    if ! [[ "$MEMORY_LIMIT" =~ ^[0-9]+([.][0-9]+)?([KkMmGgTt][Ii]?[Bb]|%)$ ]]; then
        echo "ERROR: Ungültiges --memory_limit '$MEMORY_LIMIT'. Erwartet z.B. 4GB, 512MB, 60%."
        exit 1
    fi
fi

# --jobs source: flag (--jobs) > FM_JOBS env > dynamic default (host RAM).
JOBS_SOURCE="dynamic"
if [ -n "$JOBS" ]; then
    JOBS_SOURCE="flag"
elif [ -n "${FM_JOBS:-}" ]; then
    JOBS="$FM_JOBS"; JOBS_SOURCE="env"
fi
if [ "$JOBS" = "auto" ]; then
    JOBS=$( (command -v nproc >/dev/null && nproc) || echo 4 ); JOBS_SOURCE="auto"
fi

# Cross-platform effectively available RAM in MB (0 = not determinable →
# conservative JOBS=1 fallback). /proc/meminfo alone is not enough — it is HOST-wide
# and does not know the cgroup limit (Docker/k8s/systemd MemoryMax on a large host →
# MemAvailable overestimates what THIS group is entitled to → OOM despite "free"
# host RAM). Hence on Linux: min(MemAvailable, cgroup headroom). macOS has neither
# /proc nor cgroups → a dedicated vm_stat/sysctl branch, otherwise the knob would
# stay blind on Mac (JOBS=1) and the floor protection inactive. Both platforms thus
# provide the same _avail_mb contract; cgroups stay Linux-only, but that is correct
# (on Mac there are none → the min() automatically reduces to the vm_stat value).
_detect_avail_mb() {
    local os; os=$(uname -s 2>/dev/null)
    if [ "$os" = "Darwin" ]; then
        local pagesize free spec inact mb total_b total_mb vs
        pagesize=$(sysctl -n hw.pagesize 2>/dev/null); [[ "$pagesize" =~ ^[0-9]+$ ]] || pagesize=4096
        # vm_stat pages: free + speculative + inactive are short-term reclaimable
        # → approximated as "available" (the counterpart to Linux' MemAvailable).
        vs=$(vm_stat 2>/dev/null)
        free=$(printf '%s\n' "$vs"  | awk '/Pages free/{gsub(/[^0-9]/,"",$NF); print $NF; exit}')
        spec=$(printf '%s\n' "$vs"  | awk '/Pages speculative/{gsub(/[^0-9]/,"",$NF); print $NF; exit}')
        inact=$(printf '%s\n' "$vs" | awk '/Pages inactive/{gsub(/[^0-9]/,"",$NF); print $NF; exit}')
        free=${free:-0}; spec=${spec:-0}; inact=${inact:-0}
        mb=$(( (free + spec + inact) * pagesize / 1024 / 1024 ))
        total_b=$(sysctl -n hw.memsize 2>/dev/null)   # safety cap against parse errors
        if [[ "$total_b" =~ ^[0-9]+$ ]]; then total_mb=$(( total_b / 1024 / 1024 )); [ "$mb" -gt "$total_mb" ] && mb=$total_mb; fi
        echo "${mb:-0}"; return
    fi
    # ----- Linux -----
    local meminfo_mb=0 cg_head_mb=0 lim cur reclaim=0 workingset res
    [ -r /proc/meminfo ] && meminfo_mb=$(awk '/^MemAvailable:/{print int($2/1024); exit}' /proc/meminfo 2>/dev/null)
    meminfo_mb=${meminfo_mb:-0}
    # cgroup headroom = limit − NON-reclaimable working set. IMPORTANT: in cgroup v2
    # memory.current also counts the reclaimable page cache → after a large
    # file copy/read (max−current) collapses to ~0, even though the kernel evicts
    # that cache immediately under pressure (otherwise the knob would be permanently
    # throttled to JOBS=1 in production). Hence subtract reclaimable file cache +
    # reclaimable slab — the counterpart to MemAvailable at the cgroup level. v2
    # (memory.max/.current/.stat) → v1. Reclaimable = ENTIRE page cache (v2 'file')
    # + reclaimable slab. Deliberately the total 'file' counter rather than
    # inactive_file+active_file: the LRU subtotals lag briefly after a fresh write
    # copy (dirty pages not yet on the LRU), which made the headroom falsely collapse
    # to ~0 (membench: avail=190MB right after the 5.5GB master backup). 'file'
    # captures dirty+clean immediately → stable.
    lim=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)
    cur=$(cat /sys/fs/cgroup/memory.current 2>/dev/null)
    # printf "%.0f" (NOT print): otherwise awk prints byte sums >~1e9 in exponential
    # notation (e.g. 7.78298e+09), which breaks the integer guard below → reclaim=0.
    [ -r /sys/fs/cgroup/memory.stat ] && reclaim=$(awk '/^file /{a=$2}/^slab_reclaimable /{b=$2}END{printf "%.0f", a+b}' /sys/fs/cgroup/memory.stat 2>/dev/null)
    if ! [[ "$lim" =~ ^[0-9]+$ ]]; then
        lim=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
        cur=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null)
        [ -r /sys/fs/cgroup/memory/memory.stat ] && reclaim=$(awk '/^total_cache /{printf "%.0f", $2; exit}' /sys/fs/cgroup/memory/memory.stat 2>/dev/null)
    fi
    [[ "$reclaim" =~ ^[0-9]+$ ]] || reclaim=0
    if [[ "$lim" =~ ^[0-9]+$ ]] && [[ "$cur" =~ ^[0-9]+$ ]] && [ "$lim" -lt 1125899906842624 ]; then
        # "max" (v2, no limit) and the huge v1 sentinel are not real limits
        # → skipped above via regex/cutoff so they do not distort the min().
        workingset=$(( cur - reclaim )); [ "$workingset" -lt 0 ] && workingset=0
        cg_head_mb=$(( (lim - workingset) / 1024 / 1024 )); [ "$cg_head_mb" -lt 0 ] && cg_head_mb=0
    fi
    # min(meminfo, cgroup headroom), ignoring 0 values (= not determined).
    res=$meminfo_mb
    if [ "$cg_head_mb" -gt 0 ] && { [ "$res" -eq 0 ] || [ "$cg_head_mb" -lt "$res" ]; }; then res=$cg_head_mb; fi
    echo "$res"
}

# ── Adaptive default ──────────────────────────────────────────────────────────
# No explicit Phase-1 strategy → pick the robust, never-hard-abort engine instead
# of classic whole-doc DOM: Turbo (chunked, ~2.5 GB floor) + --auto (OOM backoff via
# resplit). When the patched webbed is present, also stream via SAX (--streamify) —
# its identity with DOM is proven on the full corpus (tools/tests/identity/
# streamify_identity.sh: all derived tables byte-identical, only the 4 raw/text
# storage columns differ). SAX halves the parse RAM in the 3-5 GB band. Opt-outs:
# any explicit mode flag, or FM_FORCE_DOM=1 (keeps turbo+auto, just on DOM).
# Test mode keeps the classic deterministic path. The runtime self-test still
# degrades SAX→DOM if the loaded webbed lacks the nested-attr fix.
if ! $MODE_EXPLICIT && ! $TEST_MODE; then
    TURBO_MODE=true; SPLIT_MODE=true; AUTO_MODE=true
    if [ -f "$WEBBED_PATCHED_EXT" ] && [ "${FM_FORCE_DOM:-}" != "1" ]; then
        STREAMIFY_MODE=true
        echo "Hinweis: Adaptiver Default — SAX-Streaming (gepatchtes webbed gefunden) + Turbo + Auto-Backoff (nie harter RAM-Abbruch). Opt-out: FM_FORCE_DOM=1 oder ein expliziter Modus-Flag (z. B. --split)."
    else
        echo "Hinweis: Adaptiver Default — Turbo (DOM, chunked) + Auto-Backoff (nie harter RAM-Abbruch).$([ ! -f "$WEBBED_PATCHED_EXT" ] && echo ' (Kein gepatchtes webbed → kein SAX.)')"
    fi
fi

# Effective mode + memory metrics. Streaming: low per-file floor, spillable, cheap
# workers. DOM: full whole-doc peak, NOT spillable (libxml2 lives outside
# memory_limit), expensive workers.
_streaming_mode=false
if $STREAMIFY_MODE && [ "${FM_FORCE_DOM:-}" != "1" ]; then _streaming_mode=true; fi

# Turbo windowing default. Applies only when the user has not chosen M themselves
# (neither --subchunk nor FM_SUBCHUNK). Opt-out remains FM_SUBCHUNK=0
# (→ SUBCHUNK_SOURCE="env" → skipped → coarse). Classic path (no --turbo)
# untouched. The default recmap covers LayoutCatalog+StepsForScripts (both chunk-invariant).
if $TURBO_MODE && [ "$SUBCHUNK_SOURCE" = "default" ] && [ "${SUBCHUNK:-0}" -eq 0 ]; then
    SUBCHUNK="$TURBO_SUBCHUNK_DEFAULT"
    echo "Hinweis: Turbo-Windowing-Default — --subchunk $SUBCHUNK (LayoutCatalog+StepsForScripts; senkt P1-Peak). Opt-out: FM_SUBCHUNK=0."
fi
# DDR_INFO split as the default in turbo mode (additive-identical).
# Applies only when no explicit FM_NEST_MAP is set and FM_DDR_NEST≠0.
if $TURBO_MODE && [ -z "$NEST_MAP" ] && [ "${FM_DDR_NEST:-1}" != "0" ]; then
    NEST_MAP="DDR_INFO:Calculation,Script"
    echo "Hinweis: Turbo-DDR-Nest — DDR_INFO → Calculation- + Script-Chunk (halbiert den DDR-Long-Pole). Opt-out: FM_DDR_NEST=0."
fi
# DDR-2-level sub-chunk engagement is resolved further down, AFTER _avail_mb is known
# (the auto path keys off effectively-available RAM). The M itself is computed per file
# (see _ddr_recmap_for_file) so a single file never exceeds DDR_MAX_CHUNKS chunks.
if $_streaming_mode; then _mem_base=5000; _mem_per=1300; _job_cap=8
else                      _mem_base=10000; _mem_per=6000; _job_cap=4; fi   # DOM floor: measured per-file VmHWM ~10 GB (Artikel 9953, Belege 8712; libxml2 DOM blowup ~60-73× file size)
_nproc=$( (command -v nproc >/dev/null && nproc) || echo 4 )
# Turbo (chunk dispatch) has a different memory profile than the classic whole-doc
# path. Measured: small workers (DOM ~1.3 GB, SAX ~0.7 GB/worker), low floor
# (~baseline). The earlier W≈nproc/2 "saturation" cap was an ARTIFACT of thread
# oversubscription (W×DUCKDB_THREADS=8). With the per-worker budget t=⌊cores/W⌋
# (see TURBO_WORKER_THREADS) throughput scales cleanly up to W=nproc AND needs LESS
# RAM there (measured W16_t1 < W8_t8: −12% wall, −9% RAM) → raise the cap to nproc.
# The memory formula JOBS=(avail−base)/per still caps tight bands; FM_TURBO_JOB_CAP
# overrides. The classic path stays untouched (cap 8/4 as before; no per-worker
# thread fix there).
if $TURBO_MODE; then
    # Floor 2500 covers the measured heaviest single chunk: the DDR Calculation NEST
    # chunk peaks ~2275 MB even from only ~10 MB of XML (NEST-map, not recmap → not
    # --auto-resplittable). 1500 was too low for very tight VMs.
    _mem_base="${FM_TURBO_MEM_BASE:-2500}"
    if $_streaming_mode; then _mem_per="${FM_TURBO_MEM_PER:-800}"; else _mem_per="${FM_TURBO_MEM_PER:-1300}"; fi
    _job_cap="${FM_TURBO_JOB_CAP:-$_nproc}"; [ "$_job_cap" -lt 1 ] && _job_cap=1
fi
# Effectively available RAM: cgroup-aware (Linux) or vm_stat (macOS), see _detect_avail_mb.
_avail_mb=$(_detect_avail_mb)
[[ "$_avail_mb" =~ ^[0-9]+$ ]] || _avail_mb=0
# Test/diagnose override: pin MemAvailable to exercise the floor ladder deterministically.
[ -n "${FM_AVAIL_MB_OVERRIDE:-}" ] && _avail_mb="$FM_AVAIL_MB_OVERRIDE"

# ── DDR-2-level sub-chunk engagement (per-file M, capped — see the variable block) ──
# Resolves WHETHER it engages this run and the requested M floor. The actual per-file M
# (and the record gate) is applied in _ddr_recmap_for_file at split time. Requires
# turbo + NEST (the sub-chunk anchor sits inside the Calculation/Script NEST children).
if $TURBO_MODE && [ -n "$NEST_MAP" ]; then
    case "${DDR_SUBCHUNK:-}" in
        '')                                  # unset → auto path (RAM-pressure gated)
            if [ "${_avail_mb:-0}" -gt 0 ] && [ "${_avail_mb:-0}" -lt "$DDR_AUTO_AVAIL_MB" ]; then
                DDR_SUBCHUNK_ACTIVE=true; DDR_AUTO_MODE=true; DDR_REQ_M="$DDR_AUTO_M"
                echo "Hinweis: DDR-Subchunk (auto — avail ${_avail_mb}MB < ${DDR_AUTO_AVAIL_MB}MB): nur Calculation, Dateien ≥${DDR_MIN_RECORDS} Calc-Records, M≥${DDR_AUTO_M}, Per-Datei-Deckel ${DDR_MAX_CHUNKS} Chunks."
            fi ;;
        0|*[!0-9]*) : ;;                     # 0 or non-numeric → hard off
        *)                                   # explicit positive M → on for every DDR file
            DDR_SUBCHUNK_ACTIVE=true; DDR_AUTO_MODE=false; DDR_REQ_M="$DDR_SUBCHUNK"
            echo "Hinweis: DDR-Subchunk (explizit): nur Calculation, Dateien ≥${DDR_MIN_RECORDS} Calc-Records, M≥${DDR_REQ_M}, Per-Datei-Deckel ${DDR_MAX_CHUNKS} Chunks." ;;
    esac
fi

# Decodes $1 to UTF-8 on stdout: the FileMaker exports are UTF-16LE (BOM fffe); we
# BOM-detect and iconv to UTF-8 first (GNU grep/awk see raw bytes otherwise and silently
# miss everything — the interactive ugrep shim auto-decodes, which once masked this).
# Kept as its OWN function rather than a `case` nested inside the `$(…)` in
# _ddr_count_records: bash 3.2 (the macOS system /bin/bash) has a command-substitution
# parser bug that chokes on a `case` statement inside `$(…)` ("syntax error near
# unexpected token ';;'"). A plain pipeline inside `$(…)` parses everywhere.
_decode_to_utf8() {
    local f="$1" bom
    bom=$(LC_ALL=C head -c 2 "$f" 2>/dev/null | od -An -tx1 | tr -d ' \n')
    case "$bom" in
        fffe) LC_ALL=C iconv -f UTF-16LE -t UTF-8 "$f" 2>/dev/null ;;
        feff) LC_ALL=C iconv -f UTF-16BE -t UTF-8 "$f" 2>/dev/null ;;
        *)    LC_ALL=C cat "$f" 2>/dev/null ;;
    esac
}

# Counts the DDR *Calculation* ObjectList records in $1 (depth-4 <_…> under DDR_INFO/
# Calculation) — ONLY Calculation is sub-chunked (it is the ~2.3-GB DOM-peak driver; Script
# is NOT sub-chunked, see _ddr_recmap_for_file). Encoding-robust via _decode_to_utf8.
# awk regex with \t works on the decoded stream (substr=="\t" does not in this awk).
# Echoes a single integer.
_ddr_count_records() {
    local f="$1" n
    [ -f "$f" ] || { echo 0; return; }
    n=$(_decode_to_utf8 "$f" | LC_ALL=C awk '
            /^\t<DDR_INFO>/              { ddr=1 }
            ddr  && /^\t\t<Calculation[ >]/ { inca=1 }
            inca && /^\t\t<\/Calculation>/  { inca=0 }
            inca && /^\t\t\t\t<_/        { c++ }
            END { print c+0 }')
    [[ "$n" =~ ^[0-9]+$ ]] && echo "$n" || echo 0
}

# Per-file DDR sub-chunk recmap entry, honoring the per-file chunk cap. Echoes
# "Calculation:*:M" (or nothing). $1 = path to the file to scan (any encoding).
# ONLY Calculation is sub-chunked — it is the ~2.3-GB peak driver AND its records carry a
# unique tag-name UUID (regex <(_[^\s>]+)), so each calc record lands in exactly one
# sub-chunk and the catmerge plain-INSERT stays collision-free. Script is deliberately NOT
# sub-chunked: ~some of its records use a bare "<_ hash=…>" tag (no UUID in the name) →
# Step_UUID extraction returns '' → multiple sub-chunks would each emit a ('' ,File) row →
# catmerge PRIMARY-KEY violation (the empty key also silently collapses those steps in the
# unsplit build — a separate, pre-existing DDR_ScriptSteps data-loss bug, see plan §8.8).
# M = max(M_floor, ceil(R / DDR_MAX_CHUNKS)) so ceil(R/M) ≤ DDR_MAX_CHUNKS per file.
_ddr_recmap_for_file() {
    $DDR_SUBCHUNK_ACTIVE || return 0
    local f="$1" R M m_cap
    R=$(_ddr_count_records "$f")
    [ "$R" -lt 1 ] && return 0
    # "Nur sehr große Dateien" — applies in BOTH modes. Without it, a small explicit M
    # multiplies the corpus-wide chunk count across all files (the 119k-explosion shape).
    # Small files' Calc chunk has no DOM-peak problem, so sub-chunking them is pointless.
    [ "$R" -lt "$DDR_MIN_RECORDS" ] && return 0
    M="$DDR_REQ_M"; [ "$M" -lt 1 ] && M=1
    m_cap=$(( (R + DDR_MAX_CHUNKS - 1) / DDR_MAX_CHUNKS ))           # ceil(R / cap)
    [ "$m_cap" -gt "$M" ] && M="$m_cap"                             # raise M to honor the cap
    printf 'Calculation:*:%s' "$M"
}

# Dynamic --jobs default (only when neither a flag nor FM_JOBS nor 'auto').
if [ "$JOBS_SOURCE" = "dynamic" ]; then
    if [ "$_avail_mb" -gt 0 ]; then
        JOBS=$(( (_avail_mb - _mem_base) / _mem_per ))
        [ "$JOBS" -lt 1 ] && JOBS=1
        _cap=$(( _nproc < _job_cap ? _nproc : _job_cap ))
        [ "$JOBS" -gt "$_cap" ] && JOBS=$_cap
        echo "Hinweis: --jobs dynamisch = $JOBS ($($_streaming_mode && echo streaming || echo DOM), avail=${_avail_mb}MB, nproc=$_nproc). Override: --jobs N oder FM_JOBS."
    else
        JOBS=1   # /proc/meminfo unreadable → conservatively sequential
    fi
fi

# Validation (positive integer).
if ! [[ "$JOBS" =~ ^[0-9]+$ ]] || [ "$JOBS" -lt 1 ]; then
    echo "ERROR: Ungültiges --jobs '$JOBS'. Erwartet positive Ganzzahl, 'auto' oder leer (dynamisch)."
    exit 1
fi

# Adaptive ladder (only reached when the user explicitly forced a DOM strategy — the
# adaptive default is turbo+auto and never hard-aborts). Step 1: on a tight budget a
# plain classic-DOM run first DESCENDS to --split (lowers the per-file peak ~10 → ~8 GB,
# bit-identical) instead of aborting. This runs BEFORE the floor check so the floor is
# evaluated against the chosen (split-aware) strategy.
if ! $_streaming_mode && ! $TURBO_MODE && ! $SPLIT_MODE && [ "$_avail_mb" -gt 0 ] \
   && [ "$_avail_mb" -lt "$_mem_base" ] \
   && [ -f "$PROJECT_ROOT/tools/katana-xml/split_fm_xml.awk" ] && [ "${FM_SKIP_MEM_CHECK:-}" != "1" ]; then
    SPLIT_MODE=true
    echo "Hinweis: Klassischer DOM bei knappem RAM (avail=${_avail_mb}MB < ${_mem_base}MB) → --split automatisch (senkt Pro-Datei-Peak ~20 %, bit-identisch). Robuster Default ist --turbo --auto. FM_SKIP_MEM_CHECK=1 unterdrückt."
fi

# Effective floor: --split lowers the classic-DOM peak (~10 → ~8 GB measured).
_eff_floor=$_mem_base
if ! $_streaming_mode && ! $TURBO_MODE && $SPLIT_MODE; then _eff_floor="${FM_DOM_SPLIT_FLOOR:-8000}"; fi

# avail floor: below it OOM looms / a silent partial build (the largest file fails,
# non-spillable). Turbo (resplit via --auto) and streaming (DuckDB spill) escape →
# warning only. Classic whole-doc DOM has NO spill escape → hard abort with guidance
# (point at the now-default turbo+auto). FM_SKIP_MEM_CHECK=1 disables the check.
if [ "$_avail_mb" -gt 0 ] && [ "$_avail_mb" -lt "$_eff_floor" ] && [ "${FM_SKIP_MEM_CHECK:-}" != "1" ]; then
    if $_streaming_mode || $TURBO_MODE; then
        echo "WARNUNG: MemAvailable ${_avail_mb}MB < Boden ${_eff_floor}MB — Großdateien spillen/resplitten (langsamer)$($AUTO_MODE && echo ', --auto fängt OOM ab')."
    else
        echo "ERROR: MemAvailable ${_avail_mb}MB < DOM-Boden ${_eff_floor}MB. Klassischer DOM lädt das ganze Dokument in RAM (NICHT spillbar, memory_limit greift nicht) → OOM für Großdateien."
        echo "       Robuster Default: --turbo --auto (chunked, spillbar/resplittbar, ~2,5 GB-Boden). Sonst: --streamify (SAX, ~halber RAM + Spill), mehr RAM, oder FM_SKIP_MEM_CHECK=1 (auf eigenes Risiko)."
        exit 1
    fi
fi
# Activate --streamify (opt-in, hybrid): set renamer rules, arm the patched webbed
# (mandatory — otherwise a hard abort), pick the streamify SQL variant. Without
# --streamify everything stays default/DOM (PATCHED_WEBBED_ACTIVE=false, base SQL,
# no renamer). FM_FORCE_DOM=1 forces DOM even with --streamify.
STREAMIFY_RENAMER="$PROJECT_ROOT/tools/katana-xml/streamify_fm_xml.awk"
STREAMIFY_RULES="${FM_STREAMIFY_RULES:-LayoutCatalog:Layout:LC_Layout,StepsForScripts:Script:SFS_Script}"
STREAMIFY_SQL="$PROJECT_ROOT/sql/convert-xml/convert_xml_01_extract.streamify.sql"
if $STREAMIFY_MODE; then
    if [ "${FM_FORCE_DOM:-}" = "1" ]; then
        echo "ERROR: --streamify und FM_FORCE_DOM=1 schließen sich aus."
        exit 1
    fi
    if [ ! -f "$WEBBED_PATCHED_EXT" ]; then
        echo "ERROR: --streamify braucht den gepatchten webbed unter:"
        echo "       $WEBBED_PATCHED_EXT"
        echo "       (tools/stage_patched_webbed.sh + Rebuild, oder FM_WEBBED_EXT setzen)."
        exit 1
    fi
    if [ ! -f "$STREAMIFY_RENAMER" ] || ! command -v awk >/dev/null 2>&1; then
        echo "ERROR: --streamify braucht awk + $STREAMIFY_RENAMER."
        exit 1
    fi
    if [ ! -f "$STREAMIFY_SQL" ]; then
        echo "ERROR: streamify-SQL-Variante fehlt: $STREAMIFY_SQL"
        echo "       (per tools/gen_streamify_sql.sh aus der Basis generieren)."
        exit 1
    fi
    PATCHED_WEBBED_ACTIVE=true
    SQL_TEMPLATE="$STREAMIFY_SQL"
    echo "Hinweis: --streamify aktiv — Renamer + gepatchtes webbed + streamify-SQL (RAM-Senkung Schwergewichte)."
fi

# Dry-run hook (test/diagnose): print the resolved strategy flags and exit before any
# build. Used by the mode-selection unit checks; never set in normal operation.
if [ "${FM_DRYRUN_MODES:-}" = "1" ]; then
    echo "RESOLVED MODE_EXPLICIT=$MODE_EXPLICIT TURBO=$TURBO_MODE SPLIT=$SPLIT_MODE AUTO=$AUTO_MODE STREAMIFY=$STREAMIFY_MODE CHANGED_ONLY=$CHANGED_ONLY streaming=$_streaming_mode jobs=$JOBS subchunk=$SUBCHUNK eff_floor=${_eff_floor:-?} mem_base=$_mem_base avail=$_avail_mb"
    exit 0
fi

# --jobs + --split are ORTHOGONAL and combinable: --jobs parallelizes ACROSS files
# (each file its own part DB → merge), --split chunks WITHIN a file
# (process_single_file → run_p1_on writes all chunks into the worker's part DB,
# P1_TARGET_DB is passed through). Combined, --split lowers the per-file RAM peak
# (~12.7 → ~6 GB for one large file), so large files move out of the OOM zone and
# more workers fit the RAM band. Note: within a worker the chunks run sequentially —
# the aggregate peak of a wave is the max over the N files running simultaneously
# (no hard RAM cap).
if [ "$JOBS" -gt 1 ] && $SPLIT_MODE; then
    echo "Hinweis: --jobs $JOBS mit --split — Parallelität über Dateien + Chunking je Datei."
fi

# Validate --attempt: positive integer, default 1 (analogous to --memory_limit).
if ! [[ "$ATTEMPT" =~ ^[0-9]+$ ]] || [ "$ATTEMPT" -lt 1 ]; then
    echo "ERROR: Ungültiges --attempt '$ATTEMPT'. Erwartet positive Ganzzahl (>= 1)."
    exit 1
fi

# Normalize --retry-reason: the fixed enum is canonical; an unlisted value is
# ACCEPTED (not rejected) but marked 'custom'.
if [ -n "$RETRY_REASON" ]; then
    case "$RETRY_REASON" in
        oom|split-fallback|memory-limit|timeout|manual) RETRY_REASON_KNOWN=true ;;
        *) RETRY_REASON_KNOWN=false ;;
    esac
fi

# Interactive batch default: an argument-less invocation at a TTY should not hard
# abort — the most common case is the batch run anyway. Non-interactive (no TTY,
# e.g. CI / REST-API) keeps the behavior unchanged (argument required) so no
# automation is blocked.
if [ -z "$MODE" ]; then
    if [[ -t 0 ]] && ! $QUIET_MODE; then
        shopt -s nullglob
        _DEFAULT_XMLS=("$PROJECT_ROOT/xml"/*.xml)
        shopt -u nullglob
        _DEFAULT_N=${#_DEFAULT_XMLS[@]}
        if [ "$_DEFAULT_N" -gt 1 ]; then
            read -r -p "$_DEFAULT_N XML-Dateien in xml/ gefunden — Batch-Verarbeitung starten? [Y/n] " _DEFAULT_ANS
            if [[ -z "$_DEFAULT_ANS" || "$_DEFAULT_ANS" =~ ^[Yy] ]]; then
                MODE="batch"
            else
                echo "Abgebrochen."
                exit 0
            fi
        elif [ "$_DEFAULT_N" -eq 1 ]; then
            _DEFAULT_FILE=$(basename "${_DEFAULT_XMLS[0]}")
            read -r -p "Eine XML-Datei gefunden ($_DEFAULT_FILE) — verarbeiten? [Y/n] " _DEFAULT_ANS
            if [[ -z "$_DEFAULT_ANS" || "$_DEFAULT_ANS" =~ ^[Yy] ]]; then
                MODE="single"
                FILENAME="$_DEFAULT_FILE"
            else
                echo "Abgebrochen."
                exit 0
            fi
        else
            echo "Keine XML-Dateien in xml/ gefunden."
            echo "Usage: $0 <xml-filename> [--force-rebuild] | --batch [--fail-fast] [--force-rebuild] [--no-auto-heal] [--memory_limit <wert>] [--split] [--turbo] [--changed-only] [--auto] [--jobs <N>] | --test [--fail-fast] [--force-rebuild] [--split] [--turbo]"
            exit 1
        fi
    else
        echo "ERROR: No argument provided"
        echo "Usage: $0 <xml-filename> [--force-rebuild] | --batch [--fail-fast] [--force-rebuild] [--no-auto-heal] [--memory_limit <wert>] [--split] [--turbo] [--changed-only] [--auto] [--jobs <N>] | --test [--fail-fast] [--force-rebuild] [--split] [--turbo]"
        exit 1
    fi
fi

# Set directories based on mode
if $TEST_MODE; then
    XML_DIR="$PROJECT_ROOT/xml-test"
    DB_DIR="$PROJECT_ROOT/db"
    DB_FILE="$DB_DIR/fm_test.duckdb"
    LOG_DIR="$PROJECT_ROOT/logs"
    LOG_PREFIX="test_batch_import"
elif [[ "$MODE" == "single" ]]; then
    # Single-file run: its own log prefix so batch and single logs are
    # distinguishable (a JSON sidecar is written here too).
    XML_DIR="$PROJECT_ROOT/xml"
    DB_DIR="$PROJECT_ROOT/db"
    DB_FILE="$DB_DIR/fm_catalog.duckdb"
    LOG_DIR="$PROJECT_ROOT/logs"
    LOG_PREFIX="single_import"
else
    XML_DIR="$PROJECT_ROOT/xml"
    DB_DIR="$PROJECT_ROOT/db"
    DB_FILE="$DB_DIR/fm_catalog.duckdb"
    LOG_DIR="$PROJECT_ROOT/logs"
    LOG_PREFIX="batch_import"
fi

# DDR sub-chunk plan dry-run (FM_DDR_PLAN=1): print the per-file plan (R, M, chunks) the
# resolved engagement would produce over $XML_DIR — using the SAME _ddr_recmap_for_file
# logic — then exit WITHOUT generating a single chunk. The safe way to preview the cap.
if [ -n "${FM_DDR_PLAN:-}" ]; then
    echo "=== DDR-Subchunk Plan-Dry-Run (XML_DIR=$XML_DIR) ==="
    echo "  engaged=$DDR_SUBCHUNK_ACTIVE  auto=$DDR_AUTO_MODE  M_floor=$DDR_REQ_M  cap=$DDR_MAX_CHUNKS/Datei  min_records=$DDR_MIN_RECORDS  avail=${_avail_mb}MB"
    if ! $DDR_SUBCHUNK_ACTIVE; then
        echo "  → DDR-Subchunk greift NICHT (Default-Verhalten: 1 Calculation- + 1 Script-Chunk je Datei)."
    else
        _plan_tot=0; _plan_files=0; _plan_max=0
        for _pf in "$XML_DIR"/*.xml; do
            [ -f "$_pf" ] || continue
            _rm=$(_ddr_recmap_for_file "$_pf"); [ -n "$_rm" ] || continue
            _m="${_rm#Calculation:*:}"; _m="${_m%% *}"
            _r=$(_ddr_count_records "$_pf")
            _ch=$(( (_r + _m - 1) / _m ))
            printf "  %-32s R=%-6d M=%-5d → %d Chunks\n" "$(basename "$_pf")" "$_r" "$_m" "$_ch"
            _plan_tot=$(( _plan_tot + _ch )); _plan_files=$(( _plan_files + 1 ))
            [ "$_ch" -gt "$_plan_max" ] && _plan_max="$_ch"
        done
        echo "  ----------------------------------------------------------------"
        echo "  $_plan_files Datei(en) subgechunkt · GESAMT $_plan_tot DDR-Chunks · max/Datei $_plan_max"
    fi
    exit 0
fi

LOG_FILE="$LOG_DIR/${LOG_PREFIX}_${TIMESTAMP}.log"
JSON_FILE="$LOG_DIR/${LOG_PREFIX}_${TIMESTAMP}.json"
ERROR_LOG_FILE="$LOG_DIR/${LOG_PREFIX}_${TIMESTAMP}_errors.log"
# Raw console mirror: captures EVERYTHING the run prints — including raw shell/kernel
# errors (e.g. "No space left on device", mktemp/cat failures) that bypass the
# structured LOG_FILE (which is rebuilt in-memory at the end by write_text_log) and
# would otherwise only ever reach the terminal. This is the authoritative "what
# actually happened" trace for post-mortem debugging.
CONSOLE_LOG="$LOG_DIR/${LOG_PREFIX}_${TIMESTAMP}_console.log"
LOG_SCHEMA="fmlab.convert-log/2.0"

# Activate the console mirror as early as possible (right after the log paths are
# known) so nothing downstream escapes it. Opt-out: FM_NO_CONSOLE_LOG=1.
#   * Non-quiet (CLI): merge stderr into stdout and tee both → terminal stays
#     interactive AND the file gets a full copy.
#   * Quiet (--quiet / REST-API NDJSON): keep stdout PRISTINE for the NDJSON stream
#     (only tee a copy to the file), and divert raw stderr to the file ONLY — never
#     into the NDJSON pipe, which the SSE bridge parses line-by-line.
if [ "${FM_NO_CONSOLE_LOG:-}" != "1" ] && [ "${_FM_CONSOLE_LOG_ACTIVE:-}" != "1" ]; then
    mkdir -p "$LOG_DIR" 2>/dev/null
    export _FM_CONSOLE_LOG_ACTIVE=1
    {
        echo "===== convert_fm_xml.sh console log ====="
        echo "Started: $(date '+%Y-%m-%d %H:%M:%S')  PID:$$  mode:$MODE  args:$ORIGINAL_ARGS"
        echo "========================================="
    } >> "$CONSOLE_LOG" 2>/dev/null
    if $QUIET_MODE; then
        exec > >(tee -a "$CONSOLE_LOG") 2>>"$CONSOLE_LOG"
    else
        exec > >(tee -a "$CONSOLE_LOG") 2>&1
    fi
fi

# ── Turbo mode: streaming directory + chunkmap ──
# Transient operative DBs under db/streaming/ (schema separate from fm_catalog.duckdb).
# Phase S builds the chunkmap (plan), Phase D dispatches chunks in parallel, Phase C merges.
STREAMING_DIR="$DB_DIR/streaming"
# Name the chunkmap (transient, fresh per run) + manifest (persistent) after the
# master, so test (fm_test) and production (fm_catalog) runs do not overwrite each other.
_DB_BASE="$(basename "$DB_FILE" .duckdb)"
CHUNKMAP_DB="$STREAMING_DIR/chunkmap_${_DB_BASE}.duckdb"
MANIFEST_DB="$STREAMING_DIR/manifest_${_DB_BASE}.duckdb"
TURBO_W=1
TURBO_WORKER_THREADS=""   # per-worker thread budget for Phase D (see below)
if $TURBO_MODE; then
    # Phase S builds the chunkmap sequentially in the main process (the only chunkmap
    # writer); only Phase D parallelizes over chunks. Hence no more JOBS=1 forcing —
    # the worker count W comes from the (dynamic) --jobs. Single-writer is preserved:
    # each chunk writes into its own chunk_<id>.duckdb.
    TURBO_W="${JOBS:-1}"; [ "$TURBO_W" -lt 1 ] 2>/dev/null && TURBO_W=1
    # Phase-D workers get their own thread budget ≈ cores/W (capped at the global
    # DUCKDB_THREADS) instead of each worker inheriting the full DUCKDB_THREADS —
    # otherwise W×threads oversubscription (−12% wall, −16% RAM from de-contention;
    # processes beat DuckDB threads ~7× on write-bound read_xml). Applies ONLY to the
    # chunk workers (Phase D); P2–P6 (batch-wide, single query) keep DUCKDB_THREADS
    # unchanged. FM_TURBO_WORKER_THREADS overrides.
    _tw_cores=$( (command -v nproc >/dev/null && nproc) || echo "$TURBO_W" )
    if [ -n "${FM_TURBO_WORKER_THREADS:-}" ]; then
        TURBO_WORKER_THREADS="$FM_TURBO_WORKER_THREADS"
    else
        TURBO_WORKER_THREADS=$(( _tw_cores / TURBO_W )); [ "$TURBO_WORKER_THREADS" -lt 1 ] && TURBO_WORKER_THREADS=1
        if [ -n "${DUCKDB_THREADS:-}" ] && [ "$TURBO_WORKER_THREADS" -gt "$DUCKDB_THREADS" ]; then
            TURBO_WORKER_THREADS="$DUCKDB_THREADS"
        fi
    fi
    $QUIET_MODE || echo "Hinweis: Turbo-Worker-Threads = $TURBO_WORKER_THREADS (≈Kerne/W; W=$TURBO_W, Kerne=$_tw_cores). P2–P6 behalten DUCKDB_THREADS=${DUCKDB_THREADS:-default}. Override: FM_TURBO_WORKER_THREADS."
    mkdir -p "$STREAMING_DIR"
    # Fresh chunkmap per run (transient plan). Schema = core + operative columns.
    "$DUCKDB_BIN" "$CHUNKMAP_DB" -c "
        CREATE OR REPLACE TABLE chunkmap (
            chunk_id      BIGINT,        -- globally unique within the run
            file_name     VARCHAR,       -- FileMaker file (without .xml)
            catalog       VARCHAR,       -- branch/catalog (main, LayoutCatalog, …)
            split_group   VARCHAR,       -- file_name::catalog
            split_number  INTEGER,       -- 0-based, global per catalog (drives seq_offset)
            chunk_path    VARCHAR,       -- absolute path of the chunk XML
            record_count  INTEGER,       -- records in the sub-chunk (load weight)
            seq_offset    BIGINT,        -- split_number × sub_m (Sequence_ID bridge)
            content_hash  VARCHAR,       -- sha256 of the preprocessed chunk bytes
            parser_policy VARCHAR,       -- dom | sax
            est_bytes     BIGINT,        -- UTF-8 bytes of the chunk XML (granularity/backoff)
            status        VARCHAR,       -- pending | done | …
            attempt       INTEGER        -- backoff counter
        );" >/dev/null 2>&1 || { echo "ERROR: Chunkmap-DB ($CHUNKMAP_DB) konnte nicht initialisiert werden."; exit 3; }
    # Manifest (PERSISTENT): one row per source XML (key = XML base name).
    # internal_file_name = the internal FileMaker File_Name (multiple XML exports of the
    # same FileMaker file share it → Phase R must treat them as a group; collision case).
    "$DUCKDB_BIN" "$MANIFEST_DB" -c "
        CREATE TABLE IF NOT EXISTS manifest_file (
            file_name          VARCHAR PRIMARY KEY,  -- XML base name without .xml
            internal_file_name VARCHAR,              -- internal FileMaker File_Name
            file_mtime         BIGINT,               -- seconds (fast prefilter)
            file_size          BIGINT,               -- bytes (fast prefilter)
            file_hash          VARCHAR,              -- sha256 of the RAW XML (authoritative)
            saxml_version      VARCHAR,
            fm_version         VARCHAR,
            has_ddr_info       VARCHAR,
            converter_version  VARCHAR,              -- drift forces a full rebuild
            schema_version     VARCHAR,              -- drift forces a full rebuild
            last_ingest_ts     TIMESTAMP
        );" >/dev/null 2>&1 || { echo "ERROR: Manifest-DB ($MANIFEST_DB) konnte nicht initialisiert werden."; exit 3; }
    # manifest_catalog (PERSISTENT): one row per (file × catalog).
    # catalog_hash = md5(string_agg(content_hash ORDER BY split_number)) over all
    # sub-chunks of the split-group. Gates the (expensive) P1 parse per catalog: same
    # hash → chunks skipped_unchanged. The key is the XML base name (like manifest_file),
    # NOT the internal File_Name — collision groups fall back to whole-file anyway.
    "$DUCKDB_BIN" "$MANIFEST_DB" -c "
        CREATE TABLE IF NOT EXISTS manifest_catalog (
            file_name      VARCHAR,       -- XML base name without .xml
            catalog        VARCHAR,       -- branch/catalog (main, LayoutCatalog, …)
            catalog_hash   VARCHAR,       -- md5 of the ordered content_hashes of the split-group
            record_count   BIGINT,        -- plausibility/telemetry
            last_ingest_ts TIMESTAMP,
            PRIMARY KEY (file_name, catalog)
        );" >/dev/null 2>&1 || { echo "ERROR: manifest_catalog konnte nicht initialisiert werden."; exit 3; }
    # pipeline_state (PERSISTENT): kleine Key/Value-Tabelle. Schlüssel 'catalogs_built'
    # = 'ok', sobald P2–P6 für den aktuellen Manifest-Stand VOLLSTÄNDIG durchliefen.
    # Gate für den „nichts geändert"-Short-Circuit (sicher gegen einen Abbruch zwischen
    # Phase C [Manifest geschrieben] und P6 [Kataloge fertig]).
    "$DUCKDB_BIN" "$MANIFEST_DB" -c "
        CREATE TABLE IF NOT EXISTS pipeline_state (
            key   VARCHAR PRIMARY KEY,
            value VARCHAR
        );" >/dev/null 2>&1 || { echo "ERROR: pipeline_state konnte nicht initialisiert werden."; exit 3; }
fi

# REST-API copy target (production mode only)
REST_API_DB_DIR="$PROJECT_ROOT/rest-api/db"
REST_API_DB_FILE="$REST_API_DB_DIR/fm_catalog.duckdb"
REST_API_RELOAD_URL="${REST_API_RELOAD_URL:-http://localhost:3003/api/admin/reload}"

# Lock file for concurrency protection between the skill and the REST-API.
# Content: owner PID + ISO timestamp + mode (cli|api).
# NOT used in test mode — tests run against a separate DB.
FMLAB_DIR="$PROJECT_ROOT/.fmlab"
LOCK_FILE="$FMLAB_DIR/xml_convert.lock"

acquire_lock() {
    if $TEST_MODE; then
        return 0
    fi
    mkdir -p "$FMLAB_DIR"
    # mkdir on the lock file (not O_EXCL via touch) is atomic enough for our
    # purposes. If the lock file already exists: check whether the PID it
    # references is still running. If not → stale lock, take it over.
    if [ -f "$LOCK_FILE" ]; then
        local OWNER_PID
        OWNER_PID=$(head -n1 "$LOCK_FILE" 2>/dev/null | tr -d ' ')
        if [ -n "$OWNER_PID" ] && kill -0 "$OWNER_PID" 2>/dev/null; then
            local OWNER_INFO
            OWNER_INFO=$(cat "$LOCK_FILE" 2>/dev/null | tr '\n' ' ')
            emit_error "Another conversion is already running (PID $OWNER_PID): $OWNER_INFO"
            return 1
        fi
        # Stale lock — the previous process no longer exists
        emit_warn "Removing stale lock file (owner PID $OWNER_PID is gone)"
        rm -f "$LOCK_FILE"
    fi
    {
        echo "$$"
        date -u +%Y-%m-%dT%H:%M:%SZ
        if $QUIET_MODE; then echo "api"; else echo "cli"; fi
    } > "$LOCK_FILE"
    LOCK_OWNED=true
    return 0
}

release_lock() {
    if [ "${LOCK_OWNED:-false}" = "true" ] && [ -f "$LOCK_FILE" ]; then
        rm -f "$LOCK_FILE"
        LOCK_OWNED=false
    fi
}

# SIGTERM/SIGINT handler: also kill long-running DuckDB children, otherwise the
# script keeps running despite the abort signal and the lock file disappears while
# something is still writing. On a clean EXIT (no signal) it is enough to remove
# the lock — the children are already done by then.
abort_handler() {
    # Hard-kill all children of this process (and their children). pkill -P
    # is available on macOS; if not, the loop falls back to jobs -p.
    if command -v pkill >/dev/null 2>&1; then
        pkill -P $$ 2>/dev/null || true
    else
        for child_pid in $(jobs -p 2>/dev/null); do
            kill -TERM "$child_pid" 2>/dev/null || true
        done
    fi
    release_lock
    exit 130
}

LOCK_OWNED=false
trap 'release_lock' EXIT
trap 'abort_handler' INT TERM

# ============================================================================
# Function: Sync master DB to rest-api/db/ and trigger server reload.
# Called after a successful import/catalog build in production mode only
# (test mode is explicitly excluded). Curl failure is non-fatal: it just
# means the REST-API server is not running.
# ============================================================================
sync_to_rest_api() {
    # Guard: production mode only
    if $TEST_MODE; then
        return 0
    fi
    if [ ! -f "$DB_FILE" ]; then
        emit_log "Skipping rest-api sync: master DB not found at $DB_FILE"
        return 0
    fi

    phase_progress validate 70 "Copying database to rest-api/..."
    mkdir -p "$REST_API_DB_DIR"

    # Atomic replace: copy to .tmp first, then mv
    if cp "$DB_FILE" "$REST_API_DB_FILE.tmp" && mv -f "$REST_API_DB_FILE.tmp" "$REST_API_DB_FILE"; then
        emit_log "Synced master DB to rest-api/db/fm_catalog.duckdb"
        phase_progress validate 85 "Database synced"
    else
        emit_warn "Sync to rest-api/db/ failed"
        rm -f "$REST_API_DB_FILE.tmp" 2>/dev/null
        return 1
    fi

    # Reload trigger: only fire it ourselves in CLI mode. In --quiet/API mode
    # the reload is left to the Node service, which runs it synchronously after
    # receiving the `done` event — otherwise the server would reload during the
    # ongoing stream and disturb in-flight requests.
    if $QUIET_MODE; then
        phase_progress validate 100 "Skipping reload (handled by API caller)"
        return 0
    fi

    local CURL_ARGS=(-sS -X POST --max-time 5 -o /dev/null -w "%{http_code}")
    if [ -n "$ADMIN_RELOAD_TOKEN" ]; then
        CURL_ARGS+=(-H "X-Admin-Token: $ADMIN_RELOAD_TOKEN")
    fi

    local HTTP_CODE
    HTTP_CODE=$(curl "${CURL_ARGS[@]}" "$REST_API_RELOAD_URL" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" = "200" ]; then
        emit_log "REST-API reload triggered ($REST_API_RELOAD_URL)"
    elif [ "$HTTP_CODE" = "000" ]; then
        emit_log "REST-API not reachable at $REST_API_RELOAD_URL (ok if not running)"
    else
        emit_warn "REST-API reload returned HTTP $HTTP_CODE"
    fi
    phase_progress validate 100 "Reload triggered"

    return 0
}

# ============================================================================
# Schema versioning & auto-heal
# ============================================================================

# Compute MD5 over the given files (cross-platform: macOS+Linux).
compute_files_hash() {
    local files=("$@")
    if command -v md5sum &>/dev/null; then
        cat "${files[@]}" 2>/dev/null | md5sum | awk '{print $1}'
    elif command -v md5 &>/dev/null; then
        cat "${files[@]}" 2>/dev/null | md5 -q
    else
        cat "${files[@]}" 2>/dev/null | shasum -a 256 | cut -c1-32
    fi
}

# Read the schema markers from the SQL template header.
# Sets SCHEMA_VERSION_EXPECTED and SCHEMA_HASH_EXPECTED (global).
read_template_schema_info() {
    SCHEMA_VERSION_EXPECTED=$(grep -m1 '^-- @SCHEMA_VERSION ' "$SQL_TEMPLATE" | awk '{print $3}')

    local hash_files_raw
    hash_files_raw=$(grep -m1 '^-- @SCHEMA_HASH_FILES ' "$SQL_TEMPLATE" | cut -d' ' -f3-)

    if [ -z "$SCHEMA_VERSION_EXPECTED" ] || [ -z "$hash_files_raw" ]; then
        echo "ERROR: SQL-Template fehlt @SCHEMA_VERSION oder @SCHEMA_HASH_FILES im Header."
        echo "       Datei: $SQL_TEMPLATE"
        exit 1
    fi

    # Resolve hash files relative to the project root
    local -a abs_paths=()
    local f
    for f in $hash_files_raw; do
        abs_paths+=("$PROJECT_ROOT/$f")
        if [ ! -f "$PROJECT_ROOT/$f" ]; then
            echo "ERROR: SQL-Template-Referenz fehlt: $PROJECT_ROOT/$f"
            exit 1
        fi
    done

    SCHEMA_HASH_EXPECTED=$(compute_files_hash "${abs_paths[@]}")
}

# Read the current schema state from the DB (if present).
# Sets SCHEMA_VERSION_DB and SCHEMA_HASH_DB (global) — empty if unknown.
read_db_schema_info() {
    SCHEMA_VERSION_DB=""
    SCHEMA_HASH_DB=""

    if [ ! -f "$DB_FILE" ]; then
        return 0
    fi

    local row
    row=$("$DUCKDB_BIN" -readonly "$DB_FILE" -csv -noheader -c \
        "SELECT Schema_Version, Schema_Hash FROM SchemaInfo ORDER BY Schema_Built_At DESC LIMIT 1" \
        2>/dev/null) || row=""

    if [ -n "$row" ]; then
        SCHEMA_VERSION_DB=$(echo "$row" | cut -d',' -f1)
        SCHEMA_HASH_DB=$(echo "$row" | cut -d',' -f2)
    fi
}

# Detection logic. Sets SCHEMA_ACTION and SCHEMA_REASON (global).
# Possible values: fresh_build | incremental | rebuild | warn
compute_schema_state() {
    read_template_schema_info
    read_db_schema_info

    if [ ! -f "$DB_FILE" ]; then
        SCHEMA_ACTION="fresh_build"
        SCHEMA_REASON="DB-Datei existiert nicht — normaler Erst-Import"
    elif [ -z "$SCHEMA_VERSION_DB" ]; then
        SCHEMA_ACTION="rebuild"
        SCHEMA_REASON="DB ohne SchemaInfo-Tabelle (Pre-Versioning-Stand oder Datei korrupt)"
    elif [ "$SCHEMA_VERSION_DB" != "$SCHEMA_VERSION_EXPECTED" ]; then
        SCHEMA_ACTION="rebuild"
        SCHEMA_REASON="Schema-Version $SCHEMA_VERSION_DB → $SCHEMA_VERSION_EXPECTED"
    elif [ "$SCHEMA_HASH_DB" != "$SCHEMA_HASH_EXPECTED" ]; then
        SCHEMA_ACTION="warn"
        SCHEMA_REASON="Schema-Hash drift erkannt (Version unverändert) — Rebuild empfohlen via --force-rebuild"
    else
        SCHEMA_ACTION="incremental"
        SCHEMA_REASON="Schema OK (v$SCHEMA_VERSION_DB)"
    fi
}

# Write an auto-heal block into the batch log.
log_schema_action() {
    local logfile="$1"
    [ -z "$logfile" ] && return 0
    [ ! -f "$logfile" ] && return 0

    {
        echo ""
        echo "================================================================================"
        echo "Schema Auto-Heal Detection"
        echo "================================================================================"
        echo "DB Version (before):   ${SCHEMA_VERSION_DB:-<none>}"
        echo "DB Hash    (before):   ${SCHEMA_HASH_DB:-<none>}"
        echo "Template Version:      $SCHEMA_VERSION_EXPECTED"
        echo "Template Hash:         $SCHEMA_HASH_EXPECTED"
        echo "Reason:                $SCHEMA_REASON"
        echo "Action:                $SCHEMA_ACTION_EXECUTED"
        echo "--------------------------------------------------------------------------------"
        echo ""
    } >> "$logfile"
}

# Delete the DB file (with confirmation at a TTY, without one in non-interactive mode).
# $1: reason (for the user message)
delete_db_for_rebuild() {
    local reason="$1"
    if [ ! -f "$DB_FILE" ]; then
        return 0
    fi

    if [[ -t 0 ]] && ! $FORCE_REBUILD; then
        echo ""
        echo "  Grund: $reason"
        echo "  Lösche $DB_FILE und baue neu auf? [y/N] "
        read -r CONFIRM
        if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
            echo "  Abgebrochen."
            exit 6
        fi
    fi

    rm -f "$DB_FILE"
    echo "  ✓ DB gelöscht: $DB_FILE"
}

# ============================================================================
# DuckDB settings helper
# Emits SET statements that are prepended to every DuckDB SQL stream
# (Convert/P1, Resolve/P2, Catalogs, Resolutions, Validate) — so they apply in the
# SAME DuckDB session as the ingestion query. The function name stays
# memory_limit_prefix on purpose (all call sites unchanged; minimally invasive).
#
# Output order:
#   1. memory_limit  — UNCHANGED, only when --memory_limit is set.
#   2. threads / temp_directory / max_temp_directory_size — each individually OPT-IN via
#      env var (DUCKDB_THREADS / DUCKDB_TEMP_DIR / DUCKDB_MAX_TEMP). They are set only
#      in the container (devcontainer.json containerEnv), so host runs and existing
#      tests stay unchanged.
#   3. preserve_insertion_order=false — ONLY when DUCKDB_PRESERVE_ORDER=false.
#
# Default (no env vars, no --memory_limit) = EMPTY output → the rendered prefix is
# byte-identical to before. Zero new dependencies (pure DuckDB SETs).
#
# preserve_insertion_order is opt-in on purpose (not default): for --split the script
# guarantees a "bit-identical" result to the unsplit run.
# preserve_insertion_order=false may reorder rows and could thus break
# diff/regression tests — hence it is only enableable on explicit request.
# ============================================================================
memory_limit_prefix() {
    if [ -n "$MEMORY_LIMIT" ]; then
        printf "SET memory_limit='%s';\n" "$MEMORY_LIMIT"
    fi
    if [ -n "$DUCKDB_THREADS" ];   then printf "SET threads=%s;\n" "$DUCKDB_THREADS"; fi
    if [ -n "$DUCKDB_TEMP_DIR" ];  then printf "SET temp_directory='%s';\n" "$DUCKDB_TEMP_DIR"; fi
    if [ -n "$DUCKDB_MAX_TEMP" ];  then printf "SET max_temp_directory_size='%s';\n" "$DUCKDB_MAX_TEMP"; fi
    if [ "$DUCKDB_PRESERVE_ORDER" = "false" ]; then printf "SET preserve_insertion_order=false;\n"; fi
}

# ============================================================================
# Phase 2 — reference resolution
# Runs convert_xml_02_resolve.sql exactly ONCE after all Phase-1 imports.
# Table-only (no read_xml, no fm_xml binding): rebuilds XMLStepReferences,
# XMLLayoutReferences, MBS_SubnameMap, GetSubparameterMap, XMLCalcReferences and
# PluginFunctionUsages for ALL File_Names from the P1 tables. Must run before
# convert_xml_04_catalog.sql (ObjectLinks depends on the P2 tables).
# Writes stdout+stderr to $1. Returns: DuckDB exit code.
# ============================================================================
run_phase2_resolve() {
    local logfile="$1"
    { memory_limit_prefix; cat "$P2_TEMPLATE"; } | "$DUCKDB_BIN" "$DB_FILE" > "$logfile" 2>&1
}

# ============================================================================
# Phase 2 — File_Name-PARTITIONED. Lowers the runtime floor that P2 sets at high
# --jobs: P2 is table-only, batch-fixed and does NOT parallelize over DuckDB's
# intra-query threads (the xml_extract UDF path is serialized per row). Instead of
# a single pass, the files are split across K workers; each worker builds its file
# slice of the 6 target tables into its own part DB (read-only ATTACH on the master,
# filtered VIEWs as sources, then the UNCHANGED P2 template), followed by a central merge.
#
# CORRECTNESS: all P2 INSERTs are File_Name-scoped (every produced row carries the
# File_Name of its source row; all joins are File_Name equality joins → no
# cross-file dependency). Slicing all source tables on the same File_Name set
# yields exactly the rows of those files; the union over a file partition ==
# single-pass result (set-identity verified, all 6 tables 0/0 EXCEPT). There are no
# ordering dependencies (downstream P3–P6 reads via joins; MBS proximity pairing
# partitions by (Calc_UUID, File_Name) → within a slice).
# ============================================================================

# Effective P2 worker count: FM_P2_JOBS (env override) or JOBS, capped at the
# number of files in the DB. <2 ⇒ the caller takes the single-pass path.
_p2_effective_jobs() {
    local want explicit=false
    if [ -n "${FM_P2_JOBS:-}" ]; then want="$FM_P2_JOBS"; explicit=true; else want="$JOBS"; fi
    case "$want" in ''|*[!0-9]*) want=1 ;; esac   # 'auto'/empty/invalid → 1 (single-pass)
    # Memory cap: P2 runs K-way partitioned, EACH slice is its own DuckDB with
    # memory_limit → the SUM over the K workers must fit the RAM band, otherwise
    # OOM at a tight band × high --jobs (4-GiB measurement: P2 ×2 fits, ×4 OOMs).
    # Hence cap the DEFAULT (P2 jobs = --jobs) at available RAM (per-P2-worker
    # estimate FM_P2_PER_MB, default 1800 MB) — decouples P2 from a high P1 W. An
    # EXPLICIT FM_P2_JOBS stays a hard override (no memcap).
    if ! $explicit && [ "${_avail_mb:-0}" -gt 0 ]; then
        local per="${FM_P2_PER_MB:-1800}" memcap
        if [ "$per" -gt 0 ]; then
            memcap=$(( _avail_mb / per )); [ "$memcap" -lt 1 ] && memcap=1
            [ "$want" -gt "$memcap" ] && want="$memcap"
        fi
    fi
    local nfiles
    nfiles=$("$DUCKDB_BIN" -readonly "$DB_FILE" -noheader -list \
        -c "SELECT count(*) FROM FilesCatalog;" 2>/dev/null)
    case "$nfiles" in ''|*[!0-9]*) nfiles=1 ;; esac
    [ "$want" -gt "$nfiles" ] && want="$nfiles"
    echo "$want"
}

# One P2 slice worker: builds the 6 target tables for the files in $partdir/bin_$idx.list
# into its own part DB ($partdir/p2_$idx.duckdb). Writes rc to $partdir/$idx.rc.
_p2_worker() {
    local idx="$1" partdir="$2"
    local pdb="$partdir/p2_${idx}.duckdb" list="$partdir/bin_${idx}.list"
    local ssql; ssql="$(mktemp)"
    # IN list of this slice's File_Names (single-quoted, internal quotes doubled).
    local infiles
    infiles=$(awk '{gsub(/'"'"'/,"'"'"''"'"'"); printf "%s'"'"'%s'"'"'", (NR>1?",":""), $0}' "$list")
    {
        memory_limit_prefix
        echo "ATTACH '$DB_FILE' AS src (READ_ONLY);"
        # Filtered VIEWs as sources — the P2 template reads the tables under their
        # bare names and stays unchanged. Filter pushdown ensures xml_extract only
        # runs over the slice's portion.
        local t
        for t in StepsForScripts LayoutObjects DDR_Calculations FieldsForTables CustomFunctionsCatalog PrivilegeSetRecordAccess; do
            echo "CREATE VIEW $t AS SELECT * FROM src.$t WHERE File_Name IN ($infiles);"
        done
        cat "$P2_TEMPLATE"
    } > "$ssql"
    "$DUCKDB_BIN" "$pdb" < "$ssql" > "$partdir/${idx}.log" 2>&1
    echo $? > "$partdir/${idx}.rc"
    rm -f "$ssql"
}

# Orchestrates the partitioned P2 run. $1=K (≥2), $2=combined logfile.
# Returns: 0 = ok, otherwise error (worker or merge rc).
run_phase2_partitioned() {
    local K="$1" logfile="$2"
    local partdir; partdir="$(mktemp -d)"
    : > "$logfile"

    # 1) File partition by weight (LayoutObjects + StepsForScripts = the
    #    xml_extract-heavy sources). Greedy LPT: heaviest file first into the
    #    currently lightest bin. With files ≥ K each bin gets ≥ 1 file.
    "$DUCKDB_BIN" -readonly "$DB_FILE" -noheader -list -c "
        SELECT f.File_Name || chr(9) || (COALESCE(lo.c,0)+COALESCE(s.c,0))
        FROM FilesCatalog f
        LEFT JOIN (SELECT File_Name fn,count(*) c FROM LayoutObjects   GROUP BY 1) lo ON lo.fn=f.File_Name
        LEFT JOIN (SELECT File_Name fn,count(*) c FROM StepsForScripts GROUP BY 1) s  ON s.fn=f.File_Name
        ORDER BY (COALESCE(lo.c,0)+COALESCE(s.c,0)) DESC, f.File_Name;" 2>>"$logfile" \
    | awk -F'\t' -v K="$K" -v dir="$partdir" '
        BEGIN { for (i=0;i<K;i++) load[i]=0 }
        { m=0; for (i=1;i<K;i++) if (load[i]<load[m]) m=i
          print $1 >> (dir"/bin_"m".list"); load[m]+=($2+0) }'

    # If the partition stayed empty (FilesCatalog empty / query error) → error;
    # the caller does NOT fall back to single-pass (it would see the same empty source).
    if ! ls "$partdir"/bin_*.list >/dev/null 2>&1; then
        echo "ERROR: P2-Partition leer (FilesCatalog?)" >> "$logfile"
        rm -rf "$partdir"; return 1
    fi

    # 2) K slice workers concurrently (P2 is RAM-light: no DOM, only xml_extract
    #    over the slice's portion — a background loop + wait is enough).
    local i pids=()
    for ((i=0; i<K; i++)); do
        [ -f "$partdir/bin_${i}.list" ] || continue
        _p2_worker "$i" "$partdir" &
        pids+=($!)
    done
    wait "${pids[@]}" 2>/dev/null

    # 3) Collect worker rc; mirror logs into the combined logfile.
    local rc=0 slices=()
    for ((i=0; i<K; i++)); do
        [ -f "$partdir/${i}.rc" ] || continue
        local wrc; wrc=$(cat "$partdir/${i}.rc")
        [ -s "$partdir/${i}.log" ] && { echo "--- slice $i (rc=$wrc) ---" >> "$logfile"; cat "$partdir/${i}.log" >> "$logfile"; }
        if [ "$wrc" = "0" ] && [ -f "$partdir/p2_${i}.duckdb" ]; then
            slices+=("$partdir/p2_${i}.duckdb")
        else
            rc=1
        fi
    done
    if [ "$rc" -ne 0 ] || [ ${#slices[@]} -eq 0 ]; then
        echo "ERROR: ≥1 P2-Slice fehlgeschlagen (rc=$rc, ok=${#slices[@]}/$K)" >> "$logfile"
        rm -rf "$partdir"; return 1
    fi

    # 4) Merge into the master: per target table freshly seed the schema from slice 0
    #    (DROP+CTAS LIMIT 0 — eliminates schema drift; P2 rebuilds these tables
    #    fully anyway, and between P2 and P3 nobody reads them), then fill additively
    #    from all slices. No persistent views depend on them.
    local msql ai=0 j s tbl
    msql="$(mktemp)"
    {
        for s in "${slices[@]}"; do echo "ATTACH '$s' AS s${ai} (READ_ONLY);"; ai=$((ai+1)); done
        for tbl in XMLStepReferences XMLLayoutReferences MBS_SubnameMap GetSubparameterMap XMLCalcReferences PluginFunctionUsages; do
            echo "DROP TABLE IF EXISTS $tbl;"
            echo "CREATE TABLE $tbl AS SELECT * FROM s0.$tbl LIMIT 0;"
            j=0
            for s in "${slices[@]}"; do echo "INSERT INTO $tbl BY NAME SELECT * FROM s${j}.$tbl;"; j=$((j+1)); done
        done
    } > "$msql"
    { memory_limit_prefix; cat "$msql"; } | "$DUCKDB_BIN" "$DB_FILE" >> "$logfile" 2>&1; rc=$?
    rm -f "$msql"
    rm -rf "$partdir"
    return $rc
}

# Dispatcher: partitioned (K≥2) or single-pass (run_pipeline_step). Mirrors the
# run_pipeline_step semantics (return 0=ok/continue, 2=fail-fast stop).
run_phase2() {
    local label="$1"
    local K; K=$(_p2_effective_jobs)
    if [ "${K:-1}" -lt 2 ]; then
        run_pipeline_step "$label" "$P2_TEMPLATE"; return $?
    fi
    local templog; templog=$(mktemp); local rc=0
    if (cd "$PROJECT_ROOT" && run_phase2_partitioned "$K" "$templog"); then
        echo "✓ $label (partitioniert ×$K)"
    else
        echo "✗ WARNING: $label (partitioniert ×$K) failed"
        {
            echo "================================================================================"
            echo "ERROR: $label (partitioniert ×$K)"
            echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
            echo "================================================================================"
            cat "$templog"; echo ""
        } >> "$ERROR_LOG_FILE"
        echo "Error details:"; sed 's/^/  /' "$templog"
        $FAIL_FAST && rc=2
    fi
    rm -f "$templog"
    return $rc
}

# ============================================================================
# Apply Phase 1 to ONE XML file (full file or chunk).
# $1 = directory (FM_XML_DIR), $2 = filename, $3 = error log (appended to).
# fm_xml + schema markers are injected into the template via sed as before.
# Returns: DuckDB exit code.
# ============================================================================
run_p1_on() {
    local xdir="$1" xfile="$2" elog="$3"
    # Target DB: default master ($DB_FILE). In parallel mode (--jobs N) the worker
    # sets P1_TARGET_DB to its own part DB so N P1 runs can write concurrently
    # without a DuckDB file-lock conflict (merge afterwards).
    local target="${P1_TARGET_DB:-$DB_FILE}"
    # Sub-chunk offset for Sequence_ID: default 0; when sub-chunking a
    # Sequence_ID catalog the split loop passes the global record offset through.
    local seqoff="${P1_SEQ_OFFSET:-0}"
    case "$seqoff" in ''|*[!0-9]*) seqoff=0 ;; esac
    local tsql; tsql="$(mktemp)"
    sed -e "s/SET VARIABLE fm_xml = '.*';/SET VARIABLE fm_xml = '$xfile';/" \
        -e "s/SET VARIABLE schema_version = '.*';/SET VARIABLE schema_version = '$SCHEMA_VERSION_EXPECTED';/" \
        -e "s/SET VARIABLE schema_hash = '.*';/SET VARIABLE schema_hash = '$SCHEMA_HASH_EXPECTED';/" \
        -e "s/SET VARIABLE seq_offset = [0-9]*;/SET VARIABLE seq_offset = $seqoff;/" \
        "$SQL_TEMPLATE" > "$tsql"

    # Patched-webbed mode (SAX streaming): redirect the LOAD line to the absolute
    # path of the patched (unsigned) build and insert the capability self-test at the
    # marker @WEBBED_SELFTEST@. The self-test reads the nested-attr probe with forced
    # SAX (maximum_file_size < fixture); only a webbed with the fix returns the UUID
    # non-NULL → use_streaming=true → dom_threshold is lowered.
    # Stock/public webbed returns NULL → DOM (safe, version-independent).
    local duck_flags=()
    if $PATCHED_WEBBED_ACTIVE; then
        duck_flags+=(-unsigned)
        local selftest
        selftest="SET VARIABLE use_streaming = ((SELECT count(*) FROM read_xml('${WEBBED_SAX_PROBE}', root_element='CalcsForCustomFunctions', record_element='CustomFunctionCalc', maximum_file_size=100, streaming=true, columns={'CustomFunctionReference':'STRUCT(UUID VARCHAR)'}) WHERE CustomFunctionReference.UUID IS NOT NULL) > 0); SET VARIABLE dom_threshold = (CASE WHEN getvariable('use_streaming') THEN ${WEBBED_STREAM_THRESHOLD} ELSE getvariable('max_filesize') END);"
        # '|' as the sed delimiter (paths contain '/'); escape '&' in the replacement.
        sed -i \
            -e "s|^LOAD webbed;|LOAD '${WEBBED_PATCHED_EXT}';|" \
            -e "s|^-- @WEBBED_SELFTEST@.*|${selftest//&/\\&}|" \
            "$tsql"
    fi

    { memory_limit_prefix; cat "$tsql"; } | FM_XML_DIR="$xdir" "$DUCKDB_BIN" "${duck_flags[@]}" "$target" >> "$elog" 2>&1
    local rc=$?
    rm -f "$tsql"
    return $rc
}

# ============================================================================
# Error-log helpers + disk-space guard
# ----------------------------------------------------------------------------
# log_error_section <title> [body-file] — append a clearly delimited section to
# ERROR_LOG_FILE. Without a body-file, reads the body from stdin. Used so that
# problems which never make it into the structured LOG_FILE (chunk failures, disk
# pressure, …) are always traceable after the run.
# ============================================================================
log_error_section() {
    local title="$1" body="${2:-}"
    mkdir -p "$LOG_DIR" 2>/dev/null
    {
        echo "================================================================================"
        echo "ERROR: $title"
        echo "Time:  $(date '+%Y-%m-%d %H:%M:%S')"
        echo "================================================================================"
        if [ -n "$body" ] && [ -f "$body" ]; then cat "$body"; else cat; fi
        echo ""
    } >> "$ERROR_LOG_FILE" 2>/dev/null
}

# _disk_free_mb <dir> — available space (MB) on the filesystem holding <dir>.
# Portable across Linux + macOS via POSIX `df -Pm` (field 4 = available 1 MiB blocks).
# Walks up to the nearest existing parent so it works before the dir is created.
# Echoes an integer, or nothing if undeterminable.
_disk_free_mb() {
    local d="$1"
    while [ -n "$d" ] && [ ! -d "$d" ]; do d="$(dirname "$d")"; [ "$d" = "/" ] && break; done
    [ -d "$d" ] || return 0
    df -Pm "$d" 2>/dev/null | awk 'NR==2{print $4}'
}

# _disk_snapshot <dir> [<dir2> …] — human-readable df dump (for the error log).
_disk_snapshot() {
    local d
    for d in "$@"; do
        [ -n "$d" ] || continue
        while [ -n "$d" ] && [ ! -d "$d" ]; do d="$(dirname "$d")"; [ "$d" = "/" ] && break; done
        [ -d "$d" ] && { echo "# df -h $d"; df -h "$d" 2>/dev/null; echo ""; }
    done
}

# check_disk_space <label> — verify every write target has >= FM_MIN_DISK_MB free
# (default 1024 MB). On shortfall: log a section (with a df snapshot) to the error
# log, emit a clear message, and return 1 so the caller can abort cleanly BEFORE the
# "No space left on device" cascade corrupts sidecars / hangs the dispatcher.
# Suppress entirely with FM_MIN_DISK_MB=0.
check_disk_space() {
    local label="${1:-}"
    local floor="${FM_MIN_DISK_MB:-1024}"
    case "$floor" in ''|*[!0-9]*) floor=1024 ;; esac
    [ "$floor" -eq 0 ] && return 0
    local dir worst="" worst_free="" free
    for dir in "$STREAMING_DIR" "$DB_DIR" "$LOG_DIR" "${TMPDIR:-/tmp}"; do
        [ -n "$dir" ] || continue
        free=$(_disk_free_mb "$dir")
        case "$free" in ''|*[!0-9]*) continue ;; esac
        if [ -z "$worst_free" ] || [ "$free" -lt "$worst_free" ]; then worst_free="$free"; worst="$dir"; fi
    done
    [ -z "$worst_free" ] && return 0   # df not parseable → don't block
    if [ "$worst_free" -lt "$floor" ]; then
        local msg="Zu wenig freier Speicher${label:+ ($label)}: nur ${worst_free} MB frei auf $worst (Mindestens ${floor} MB nötig; Override: FM_MIN_DISK_MB)."
        log_error_section "Disk space low${label:+ — $label}" < <(echo "$msg"; echo ""; _disk_snapshot "$STREAMING_DIR" "$DB_DIR" "$LOG_DIR" "${TMPDIR:-/tmp}")
        emit_error "$msg"
        return 1
    fi
    return 0
}

# preflight_disk_or_abort <label> — check_disk_space; on shortfall finalize the logs
# and abort cleanly (the structured log + JSON sidecar are still written, and the
# disk section is already in the error log). Used by the classic (non-turbo)
# Phase-1 paths, which would otherwise hit the same "No space left on device" cascade.
preflight_disk_or_abort() {
    check_disk_space "$1" && return 0
    finalize_logs
    emit_done false "Disk space too low: $1"
    echo "Error log: $ERROR_LOG_FILE" >&2
    exit 1
}

# ============================================================================
# Memory forensics (Linux/proc; a no-op on other platforms → empty values).
# Lets you trace how much RAM each file pulled and how tight system memory got
# meanwhile — important since the rolling pool can keep large files resident at the
# same time (OOM risk, exit 137).
# ============================================================================
# System-wide available memory in KB (MemAvailable); empty if not readable.
_mem_avail_kb() {
    [ -r /proc/meminfo ] && awk '/^MemAvailable:/{print $2; exit}' /proc/meminfo 2>/dev/null
}
# Summed VmRSS (KB) of the process tree from PID $1 (recursive over /proc children).
# Captures duckdb + children under the worker subshell.
# NON-FORKING: the entire tree walk runs in ONE awk process (awk-internal
# recursion). The earlier recursive command substitution
# `sum=$(( sum + $(_tree_rss_kb "$k") ))` forked a bash subshell PER process-tree
# node — called by the per-worker sampler every 0.2 s (only the parallel path,
# --jobs ≥2) it spawned more subshells under load than were reaped → process
# explosion (thousands of bash) → non-reclaimable kernel slab → host OOM. That was
# the true cause of the `--batch --jobs N` OOM (previously wrongly blamed on DOM RAM).
# Now: 1 awk per sample instead of O(nodes) forks.
_tree_rss_kb() {
    [ -r "/proc/$1/status" ] || { echo 0; return 0; }
    awk -v root="$1" '
    function rss_of(p,   line,r,f,a) {
        r=0; f="/proc/" p "/status"
        while ((getline line < f) > 0) if (line ~ /^VmRSS:/) { split(line,a," "); r=a[2]+0; break }
        close(f); return r
    }
    function walk(p,   line,kids,n,i,f) {
        total += rss_of(p)
        f="/proc/" p "/task/" p "/children"
        if ((getline line < f) > 0) { close(f); n=split(line,kids," "); for(i=1;i<=n;i++) if(kids[i]!="") walk(kids[i]) }
        else close(f)
    }
    BEGIN { total=0; walk(root); print total }' 2>/dev/null
}
# KB → integer MB (for log lines/tables).
_kb_mb() { awk -v k="${1:-0}" 'BEGIN{ printf "%d", (k+0)/1024 }'; }

# ============================================================================
# Parallel Phase-1 processing (opt-in via --jobs N)
# Each file runs into its own part DB under $PARTDB_DIR. Afterwards all successful
# part DBs are merged into the master DB. File_Names are disjoint per file → the
# merge is conflict-free (a DELETE pre-stage makes re-runs/incremental imports
# idempotent, analogous to the UPSERT/DELETE-INSERT semantics in P1).
# The result is bit-identical to the sequential run (verified via content hash).
# Per file $PARTDB_DIR/<idx>.{rc,out,dur} are written; the telemetry loop reads
# these instead of calling process_single_file itself. As its very last step the
# worker writes $PARTDB_DIR/<idx>.done — by that (and not by `kill -0`, which still
# reports an un-waited zombie as "alive") the rolling scheduler detects completion
# race-free.
# ============================================================================
_p1_worker() {
    local idx="$1"
    local fname; fname=$(basename "${XML_FILES[$idx]}")
    local pdb="$PARTDB_DIR/part_${idx}.duckdb"
    local t0 t1 out rc selfpid=$BASHPID sampler_pid=""
    # Memory sampler (Linux/proc only): every 0.2 s tracks the peak RSS of this
    # worker tree (duckdb) and the lowest system MemAvailable during the run;
    # continuously writes "<peak_rss_kb> <min_avail_kb>" to <idx>.mem, so the last
    # state survives even an OOM kill (SIGKILL).
    if [ -r /proc/meminfo ]; then
        (
            local peak=0 lowavail="" cur av
            while [ ! -f "$PARTDB_DIR/${idx}.memstop" ]; do
                cur=$(_tree_rss_kb "$selfpid"); [ "${cur:-0}" -gt "$peak" ] && peak=$cur
                av=$(_mem_avail_kb)
                if [ -n "$av" ] && { [ -z "$lowavail" ] || [ "$av" -lt "$lowavail" ]; }; then lowavail=$av; fi
                printf '%s %s' "$peak" "${lowavail:-}" > "$PARTDB_DIR/${idx}.mem"
                sleep 0.2
            done
        ) &
        sampler_pid=$!
    fi
    t0=$(date +%s.%N)
    out=$(P1_TARGET_DB="$pdb" process_single_file "$fname" 2>&1); rc=$?
    t1=$(date +%s.%N)
    if [ -n "$sampler_pid" ]; then
        : > "$PARTDB_DIR/${idx}.memstop"      # stop the sampler (it kept writing .mem)
        wait "$sampler_pid" 2>/dev/null
        rm -f "$PARTDB_DIR/${idx}.memstop"
    fi
    printf '%s' "$out" > "$PARTDB_DIR/${idx}.out"
    echo "$rc"        > "$PARTDB_DIR/${idx}.rc"
    awk -v a="$t1" -v b="$t0" 'BEGIN { printf "%.3f", a - b }' > "$PARTDB_DIR/${idx}.dur"
    # Keep the part DB only on success; failures/skips produce no merge.
    [ "$rc" -ne 0 ] && rm -f "$pdb"
    : > "$PARTDB_DIR/${idx}.done"   # sentinel: worker fully done (last action)
    return 0
}

# Live event for a file pre-processed in parallel mode (reads rc/out from
# $PARTDB_DIR). Quiet mode/parallel only — the detailed report/logging/array work
# is still done by the telemetry loop; this is solely about the `file` event for
# the frontend (counter + per-file highlight), which would otherwise arrive in one
# batch only after the (long) merge.
_emit_p1_file_event() {
    local idx="$1"
    local bn; bn=$(basename "${XML_FILES[$idx]}")
    local cur=$((idx + 1)) total=${#XML_FILES[@]}
    local rc; rc=$(cat "$PARTDB_DIR/${idx}.rc" 2>/dev/null); rc=${rc:-3}
    if [ "$rc" -eq 0 ]; then
        _emit_json file filename "$bn" index "int=$cur" total "int=$total" ok "bool=true"
    elif [ "$rc" -eq 4 ]; then
        _emit_json file filename "$bn" index "int=$cur" total "int=$total" ok "bool=false" status "skipped"
    else
        classify_error "$rc" "$(cat "$PARTDB_DIR/${idx}.out" 2>/dev/null)"
        _emit_json file filename "$bn" index "int=$cur" total "int=$total" ok "bool=false" status "failed" category "$ERR_CATEGORY"
    fi
}

# Rolling worker pool (bash-3.2-portable): continuously keeps up to $JOBS workers
# running — as soon as one finishes, the next file immediately moves into the freed
# slot (no waiting for the slowest of a wave). Completion is detected via the
# sentinel file $PARTDB_DIR/<idx>.done: `wait -n` only exists from bash 4.3
# (missing on macOS bash 3.2), and `kill -0` still reports an un-waited zombie as
# alive — the sentinel is portable and race-free. All NDJSON emissions stay here in
# the main process (serial) → no interleaving in the SSE stream; the workers only
# write sidecars. In quiet mode progress is emitted live per finished file
# (file_start at the start, file + phase_progress on collection). The 0.1 s poll
# latency is negligible against the seconds-long per-file parse times.
run_p1_parallel() {
    local n=${#XML_FILES[@]} i=0 done_count=0 s pid any bn
    local -a slot_pid slot_idx
    for ((s = 0; s < JOBS; s++)); do slot_pid[$s]=0; done

    while [ "$done_count" -lt "$n" ]; do
        # (a) fill free slots with the next file each
        for ((s = 0; s < JOBS && i < n; s++)); do
            [ "${slot_pid[$s]}" -ne 0 ] && continue
            if $QUIET_MODE; then
                bn=$(basename "${XML_FILES[$i]}")
                _emit_json file_start filename "$bn" index "int=$((i + 1))" total "int=$n"
                emit_log "[$((i + 1))/$n] Processing: $bn"
            fi
            rm -f "$PARTDB_DIR/${i}.done"
            _p1_worker "$i" &
            slot_pid[$s]=$!; slot_idx[$s]=$i; i=$((i + 1))
        done

        # (b) collect finished workers (sentinel file), free the slot immediately
        any=false
        for ((s = 0; s < JOBS; s++)); do
            pid=${slot_pid[$s]}; [ "$pid" -eq 0 ] && continue
            if [ -f "$PARTDB_DIR/${slot_idx[$s]}.done" ]; then
                wait "$pid" 2>/dev/null   # reap the zombie (returns immediately)
                $QUIET_MODE && _emit_p1_file_event "${slot_idx[$s]}"
                slot_pid[$s]=0; done_count=$((done_count + 1)); any=true
            fi
        done

        if $QUIET_MODE && $any; then
            phase_progress extract $(( 10 + (done_count * 90) / n )) "Phase 1: $done_count/$n Dateien"
        fi
        $any || sleep 0.1   # only wait if nothing finished (avoid a busy-spin)
    done
}

# Merge all successful part DBs (in file order) into the master DB.
# Sets $MERGE_RC (0 ok, otherwise the DuckDB exit code). Writes nothing to the
# master DB if no file succeeded (downstream P2-P6 then see an empty DB, just
# like the sequential case with no successful imports).
merge_part_dbs() {
    MERGE_RC=0
    local parts=() i
    for i in "${!XML_FILES[@]}"; do
        [ -f "$PARTDB_DIR/${i}.rc" ] && [ "$(cat "$PARTDB_DIR/${i}.rc")" = "0" ] \
            && [ -f "$PARTDB_DIR/part_${i}.duckdb" ] && parts+=("$PARTDB_DIR/part_${i}.duckdb")
    done
    [ ${#parts[@]} -eq 0 ] && return 0

    # Seed the master schema: if the master DB does not yet exist (force_rebuild
    # deleted it), copy the first part DB as the base (full schema + data of the
    # first file). Otherwise (incremental) the master DB stays the base.
    local start=0
    if [ ! -f "$DB_FILE" ]; then
        cp "${parts[0]}" "$DB_FILE" || { MERGE_RC=1; return 1; }
        start=1
    fi

    # Table list from a PART DB (not from the master DB!). The part DBs only run
    # P1 (extract) and carry exactly the mergeable tables. On an incremental run the
    # master DB additionally contains all P2–P6 objects (e.g. GetSubparameterMap,
    # MBS_SubnameMap) plus views (FolderHierarchy, v_check_*, v_*_stats) that are
    # absent from the part DBs — if they ended up here the merge would fail
    # ("Table does not exist" / "Can only delete from base table"). table_type='BASE
    # TABLE' additionally filters out views. parts[0] is representative; all part DBs
    # share the same P1 schema. SchemaInfo (version marker, one row) is omitted.
    local seed_db="${parts[0]}"
    local tables; tables=$("$DUCKDB_BIN" -readonly "$seed_db" -noheader -list -c \
        "SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE' AND table_name <> 'SchemaInfo' ORDER BY table_name;" 2>/dev/null)
    [ -z "$tables" ] && { MERGE_RC=0; return 0; }
    # Which tables carry a File_Name column? (Only for the DELETE pre-stage; a
    # "File_Name" reference to a table without that column is a bind error — so
    # decide per table up front.) Also from the part DB, so the DELETE pre-stage and
    # INSERT operate on the same set of tables.
    local fn_tables; fn_tables=$("$DUCKDB_BIN" -readonly "$seed_db" -noheader -list -c \
        "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='main' AND column_name='File_Name';" 2>/dev/null)

    # Generate merge SQL: per remaining part DB ATTACH (READ_ONLY) + per table
    # DELETE of the contained File_Names (idempotent) followed by INSERT BY NAME.
    local msql; msql="$(mktemp)"
    local k=$start ai=0 p tbl
    while [ "$k" -lt "${#parts[@]}" ]; do
        p="${parts[$k]}"
        ai=$((ai + 1))
        echo "ATTACH '$p' AS p${ai} (READ_ONLY);" >> "$msql"
        while IFS= read -r tbl; do
            [ -z "$tbl" ] && continue
            # File_Name column present? Then delete the affected names up front
            # (makes re-import idempotent; a no-op on force_rebuild since disjoint).
            if printf '%s\n' "$fn_tables" | grep -qxF "$tbl"; then
                echo "DELETE FROM \"$tbl\" WHERE \"File_Name\" IN (SELECT DISTINCT \"File_Name\" FROM p${ai}.\"$tbl\");" >> "$msql"
            fi
            echo "INSERT INTO \"$tbl\" BY NAME SELECT * FROM p${ai}.\"$tbl\";" >> "$msql"
        done <<< "$tables"
        k=$((k + 1))
    done

    if [ -s "$msql" ]; then
        "$DUCKDB_BIN" "$DB_FILE" < "$msql" > "$PARTDB_DIR/merge.log" 2>&1 || MERGE_RC=$?
    fi
    rm -f "$msql"
    return $MERGE_RC
}

# Phase C, stage 2 — PARQUET variant (opt-in FM_TURBO_PARQUET, format eval).
# Instead of ATTACH+INSERT per part: parts (except seed) → Parquet per (table,part),
# then per table ONE wildcard INSERT via read_parquet('<tbl>/*.parquet'). No ATTACH.
# In isolation ~3.4× faster + −22% RAM, snapshot-byte-identical (CTAS/INSERT-from-parquet
# preserves the schema; verified). Seed = cp(parts[0]) (full schema incl. SchemaInfo +
# part0 data, exactly like merge_part_dbs).
# PRECONDITION: no File_Name collision across parts (prod: 57 XML = 57 distinct File_Name,
# verified) → additive union == merge_part_dbs result. Incremental (master exists) →
# safe fallback to merge_part_dbs (DELETE-last-wins, not covered parquet-side in the prototype).
# Returns via MERGE_RC (like merge_part_dbs).
_turbo_merge_parquet() {
    MERGE_RC=0
    local parts=() i
    for i in "${!XML_FILES[@]}"; do
        [ -f "$PARTDB_DIR/${i}.rc" ] && [ "$(cat "$PARTDB_DIR/${i}.rc")" = "0" ] \
            && [ -f "$PARTDB_DIR/part_${i}.duckdb" ] && parts+=("$PARTDB_DIR/part_${i}.duckdb")
    done
    [ ${#parts[@]} -eq 0 ] && return 0
    # Incremental (master exists) not covered parquet-side in the prototype → fallback.
    [ -f "$DB_FILE" ] && { echo "  [parquet] Master existiert (Inkrement) → Fallback merge_part_dbs" >&2; merge_part_dbs; return $?; }

    # Seed: cp parts[0] (schema + SchemaInfo + part0 data) — identical to merge_part_dbs.
    cp "${parts[0]}" "$DB_FILE" || { MERGE_RC=1; return 1; }
    [ ${#parts[@]} -eq 1 ] && return 0

    local seed_db="${parts[0]}" tables
    tables=$("$DUCKDB_BIN" -readonly "$seed_db" -noheader -list -c \
        "SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE' AND table_name <> 'SchemaInfo' ORDER BY table_name;" 2>/dev/null)
    [ -z "$tables" ] && { MERGE_RC=0; return 0; }

    local pqdir="$PARTDB_DIR/pq"; mkdir -p "$pqdir"
    # Export parts[1..] → Parquet per (table, part) in ONE duckdb run (ATTACH + COPY).
    local esql k tbl; esql="$(mktemp)"
    for ((k = 1; k < ${#parts[@]}; k++)); do echo "ATTACH '${parts[$k]}' AS p${k} (READ_ONLY);" >> "$esql"; done
    while IFS= read -r tbl; do
        [ -z "$tbl" ] && continue
        mkdir -p "$pqdir/$tbl"
        for ((k = 1; k < ${#parts[@]}; k++)); do
            echo "COPY (SELECT * FROM p${k}.\"$tbl\") TO '$pqdir/$tbl/${k}.parquet' (FORMAT parquet);" >> "$esql"
        done
    done <<< "$tables"
    "$DUCKDB_BIN" ":memory:" < "$esql" > "$PARTDB_DIR/parquet_merge.log" 2>&1 || MERGE_RC=$?
    rm -f "$esql"
    [ "$MERGE_RC" -ne 0 ] && return $MERGE_RC

    # Merge: per table ONE wildcard INSERT into the seeded master (no ATTACH/DELETE).
    local msql; msql="$(mktemp)"
    while IFS= read -r tbl; do
        [ -z "$tbl" ] && continue
        echo "INSERT INTO \"$tbl\" BY NAME SELECT * FROM read_parquet('$pqdir/$tbl/*.parquet');" >> "$msql"
    done <<< "$tables"
    [ -s "$msql" ] && { "$DUCKDB_BIN" "$DB_FILE" < "$msql" >> "$PARTDB_DIR/parquet_merge.log" 2>&1 || MERGE_RC=$?; }
    rm -f "$msql"
    return $MERGE_RC
}

# Catalog→tables ownership (empirically verified): each P1 table is fed by exactly
# ONE catalog. Non-main catalogs own their specific tables (stable from the
# extract.sql branch mapping); main owns the rest (incl. per-doc
# FilesCatalog/XMLMetadata). Unknown non-main catalog → '?' (the caller aborts safely).
_turbo_catalog_owned() {
    case "$1" in
        main)            echo "__MAIN__" ;;
        StepsForScripts) echo "StepsForScripts" ;;
        DDR_INFO)        echo "DDR_Calculations DDR_ScriptSteps" ;;
        # DDR_INFO nest children. The Calculation half feeds ONLY DDR_Calculations
        # (the Script XPath finds nothing → 0 rows), the Script half ONLY
        # DDR_ScriptSteps. They are mutually exclusive with DDR_INFO (nest on XOR off) →
        # no OWNER conflict. WITHOUT these lines catmerge would fall back to the part path.
        Calculation)     echo "DDR_Calculations" ;;
        Script)          echo "DDR_ScriptSteps" ;;
        LayoutCatalog)   echo "Layouts LayoutObjects LayoutParts" ;;
        *)               echo "?" ;;
    esac
}

# Multi-fed tables: fed by MORE than one catalog → the single-owner model of the
# catmerge ownership does not apply. ScriptTriggers is the only case: file-level
# (//Metadata, main chunk) + layout-/object-level (//LayoutCatalog, LayoutCatalog chunk).
# As long as LayoutCatalog was NOT separated (old default SUBCHUNK=0), everything sat
# in the main chunk → single-fed. The windowing default separates LayoutCatalog → the
# layout/object triggers move into its chunk and were lost under single-owner catmerge.
# Fix: copy multi-fed tables from EVERY chunk (export below); the three sources are
# record-disjoint (different Owner_Type/Owner_UUID, collision-free PK) → union = complete.
_turbo_table_multifed() {
    case "$1" in
        ScriptTriggers) return 0 ;;
        *)              return 1 ;;
    esac
}

# May catalog $1 NOT be skipped by the catalog gate because it feeds a multi-fed
# table whose provenance the merge CANNOT scope? Since the provenance-scoped merge
# DELETE (see _turbo_multifed_delete_types) the ONLY multi-fed table (ScriptTriggers)
# is separable via `Owner_Type` (File↔main, Layout/LayoutObject↔LayoutCatalog) →
# LayoutCatalog is now skippable (its triggers survive the main reparse). 'main' is
# never skipped anyway (the gate filters `catalog <> 'main'`). So there is currently NO
# non-scopable feeder anymore — the function remains as a hook for future multi-fed
# tables WITHOUT a separating provenance column (add them here then).
_turbo_catalog_feeds_multifed() {
    case "$1" in
        *) return 1 ;;
    esac
}

# For a multi-fed table $1: the Owner_Type values of the feeders REPARSED in THIS run
# (from SEENCAT). Only these Owner_Type classes are deleted in the master — the classes
# of skipped feeders stay untouched (this enables the LayoutCatalog skip). Empty
# → no known provenance map → the caller falls back to a File-scoped DELETE (conservative).
# Assumption: ScriptTriggers.Owner_Type ∈ {File(main), Layout/LayoutObject(LayoutCatalog)}
# (prod verified). New Owner_Type/feeder → add it here.
_turbo_multifed_delete_types() {
    local t="$1" seen=" $2 " types=""   # $2 = space-delimited set of catalogs reparsed this run
    case "$t" in
        ScriptTriggers)
            case "$seen" in *" main "*)          types="$types${types:+,}'File'" ;; esac
            case "$seen" in *" LayoutCatalog "*) types="$types${types:+,}'Layout','LayoutObject'" ;; esac
            ;;
    esac
    printf '%s' "$types"
}

# Are ALL chunks of file $1 valid (rc=0 + DB present)? (for the per-file rc sidecar.)
# skipped_unchanged chunks (catalog gate) are deliberately NOT dispatched →
# they do not count as missing (their master rows are unchanged and valid).
_turbo_file_chunks_ok() {
    local idx="$1" fn cid
    fn="$(basename "${XML_FILES[$idx]}")"; fn="${fn%.xml}"
    while IFS= read -r cid; do
        [ -z "$cid" ] && continue
        { [ "$(cat "$STREAMING_DIR/chunk_${cid}.rc" 2>/dev/null)" = "0" ] && [ -f "$STREAMING_DIR/chunk_${cid}.duckdb" ]; } || return 1
    done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT chunk_id FROM chunkmap WHERE file_name='${fn//\'/\'\'}' AND status<>'skipped_unchanged';")
    return 0
}

# Phase C — CATALOG-GRANULAR (DEFAULT in turbo; opt-out FM_TURBO_NO_CATMERGE). Collapses C1+C2:
# chunks → master DIRECTLY (no part DBs), per catalog atomic DELETE-by-File + INSERT.
# Model: each (file×catalog) slice is record-disjoint & self-contained → wholesale
# replacement without a row-by-row reconciliation; matches the manifest hash
# (incremental) and per-catalog exports. Per-doc becomes a normal map rule (owned by
# main), no longer a special case. DELETE-by-File is a no-op on force-rebuild but makes
# the path collision-safe + incremental-capable (unlike the pure union in _turbo_merge_parquet).
# VARIANT A (export from chunk DBs); worker→parquet-direct (variant B, saves the C1 copy) later.
# Linear lookup over the catmerge OWNER_K/OWNER_V parallel arrays (dynamic scope from
# _turbo_merge_catalog — bash-3.2-safe stand-in for an associative array). Sets
# _owner_result to the catalog owning table $1 (empty if unmapped). Avoids command
# substitution so it can be called in the hot export loop without a per-call subshell.
_catmerge_owner_of() {
    local _j; _owner_result=""
    for _j in "${!OWNER_K[@]}"; do
        if [ "${OWNER_K[$_j]}" = "$1" ]; then _owner_result="${OWNER_V[$_j]}"; return 0; fi
    done
    return 1
}

_turbo_merge_catalog() {
    MERGE_RC=0
    local -a CID CCAT
    local cid cat
    while IFS=$'\t' read -r cid cat; do
        [ -z "$cid" ] && continue
        [ "$(cat "$STREAMING_DIR/chunk_${cid}.rc" 2>/dev/null)" = "0" ] || continue
        [ -f "$STREAMING_DIR/chunk_${cid}.duckdb" ] || continue
        CID+=("$cid"); CCAT+=("$cat")
    done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT chunk_id||chr(9)||catalog FROM chunkmap ORDER BY catalog, chunk_id;")
    [ ${#CID[@]} -eq 0 ] && return 0

    # P1 tables + File_Name tables from ONE chunk (NOT from the master — on incremental
    # the master additionally carries P2–P6 tables/views that must not be merged here).
    local seed_chunk="$STREAMING_DIR/chunk_${CID[0]}.duckdb" t
    local tables; tables=$("$DUCKDB_BIN" -readonly "$seed_chunk" -noheader -list -c \
        "SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE' AND table_name<>'SchemaInfo' ORDER BY table_name;")
    [ -z "$tables" ] && { MERGE_RC=0; return 0; }
    local fn_tables; fn_tables=$("$DUCKDB_BIN" -readonly "$seed_chunk" -noheader -list -c \
        "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='main' AND column_name='File_Name';")

    # Ownership: known non-main catalogs → their tables; main → the rest. (The
    # orchestrator pre-flight guarantees known catalogs; defensive abort if still unknown.)
    # bash-3.2-safe: OWNER as parallel indexed arrays (OWNER_K table → OWNER_V catalog)
    # with linear lookup (_catmerge_owner_of); SEENCAT as a space-delimited set of the
    # catalogs reparsed this run (catalog names are identifiers → no-space-safe).
    local -a OWNER_K OWNER_V; local _seencat="" _owner_result i owned tk cat
    for i in "${!CID[@]}"; do
        case " $_seencat " in *" ${CCAT[$i]} "*) ;; *) _seencat="$_seencat${_seencat:+ }${CCAT[$i]}" ;; esac
    done
    for cat in $_seencat; do
        owned="$(_turbo_catalog_owned "$cat")"
        [ "$owned" = "?" ] && { echo "  [catmerge] unbekannter Katalog '$cat' → Abbruch" >&2; MERGE_RC=2; return 2; }
        [ "$owned" = "__MAIN__" ] && continue
        for tk in $owned; do OWNER_K+=("$tk"); OWNER_V+=("$cat"); done
    done
    while IFS= read -r t; do [ -n "$t" ] && { _catmerge_owner_of "$t" || { OWNER_K+=("$t"); OWNER_V+=("main"); }; }; done <<< "$tables"

    # Seed ONLY in a full build (master missing): an empty, schema'd master from a chunk.
    # On incremental the existing master (with P2–P6) stays the base — below, DELETE-by-File
    # replaces only the rows of the (changed) files whose chunks are present.
    if [ ! -f "$DB_FILE" ]; then
        cp "$seed_chunk" "$DB_FILE" || { MERGE_RC=1; return 1; }
        local del=""
        while IFS= read -r t; do [ -n "$t" ] && del="$del DELETE FROM \"$t\";"; done <<< "$tables"
        "$DUCKDB_BIN" "$DB_FILE" -c "$del" >/dev/null 2>&1
    fi

    # Export (low-RAM): ONE duckdb run, per chunk ATTACH→COPY-owned→DETACH (max. 1 DB attached
    # → no 57-way ATTACH peak). Per-doc falls out automatically (FilesCatalog/XMLMetadata
    # belong to main → only main chunks copy them).
    local pqdir="$PARTDB_DIR/pq"; mkdir -p "$pqdir"
    while IFS= read -r t; do [ -n "$t" ] && mkdir -p "$pqdir/$t"; done <<< "$tables"
    local esql; esql="$(mktemp)"
    for i in "${!CID[@]}"; do
        echo "ATTACH '$STREAMING_DIR/chunk_${CID[$i]}.duckdb' AS k (READ_ONLY);" >> "$esql"
        while IFS= read -r t; do
            [ -z "$t" ] && continue
            # Owner chunk OR multi-fed (from every chunk; record-disjoint → union correct).
            _catmerge_owner_of "$t"
            { [ "$_owner_result" = "${CCAT[$i]}" ] || _turbo_table_multifed "$t"; } || continue
            echo "COPY (SELECT * FROM k.\"$t\") TO '$pqdir/$t/${CID[$i]}.parquet' (FORMAT parquet);" >> "$esql"
        done <<< "$tables"
        echo "DETACH k;" >> "$esql"
    done
    [ -s "$esql" ] && { "$DUCKDB_BIN" ":memory:" < "$esql" >> "$PARTDB_DIR/catmerge.log" 2>&1 || MERGE_RC=$?; }
    rm -f "$esql"
    [ "$MERGE_RC" -ne 0 ] && return $MERGE_RC

    # Merge: per table with Parquet files: DELETE-by-File (no-op on an empty master, but
    # collision-/incremental-safe) + wildcard INSERT. Atomic per (file×catalog) via owner partition.
    local msql dtypes; msql="$(mktemp)"
    while IFS= read -r t; do
        [ -z "$t" ] && continue
        ls "$pqdir/$t"/*.parquet >/dev/null 2>&1 || continue
        if _turbo_table_multifed "$t"; then
            # Provenance-scoped DELETE: delete only the Owner_Type classes of the feeders
            # reparsed in THIS run, across ALL processed files (the FilesCatalog parquet
            # carries the internal File_Names; main is always reparsed → contains all). This
            # keeps triggers of skipped feeders (e.g. LayoutCatalog) intact, while a trigger
            # removed in a reparsed feeder (drop-to-0) is still deleted.
            # Without a provenance map OR without the FilesCatalog parquet → conservatively File-scoped.
            dtypes="$(_turbo_multifed_delete_types "$t" "$_seencat")"
            if [ -n "$dtypes" ] && ls "$pqdir/FilesCatalog"/*.parquet >/dev/null 2>&1; then
                echo "DELETE FROM \"$t\" WHERE \"File_Name\" IN (SELECT \"File_Name\" FROM read_parquet('$pqdir/FilesCatalog/*.parquet')) AND \"Owner_Type\" IN ($dtypes);" >> "$msql"
            else
                echo "DELETE FROM \"$t\" WHERE \"File_Name\" IN (SELECT DISTINCT \"File_Name\" FROM read_parquet('$pqdir/$t/*.parquet'));" >> "$msql"
            fi
        elif printf '%s\n' "$fn_tables" | grep -qxF "$t"; then
            echo "DELETE FROM \"$t\" WHERE \"File_Name\" IN (SELECT DISTINCT \"File_Name\" FROM read_parquet('$pqdir/$t/*.parquet'));" >> "$msql"
        fi
        echo "INSERT INTO \"$t\" BY NAME SELECT * FROM read_parquet('$pqdir/$t/*.parquet');" >> "$msql"
    done <<< "$tables"
    [ -s "$msql" ] && { "$DUCKDB_BIN" "$DB_FILE" < "$msql" >> "$PARTDB_DIR/catmerge.log" 2>&1 || MERGE_RC=$?; }
    rm -f "$msql"
    return $MERGE_RC
}

# Pre-flight: is the catalog-granular merge applicable? Two conditions:
#  (1) all catalogs in the chunkmap have an owner map (empty chunkmap = yes);
#  (2) NO internal File_Name collision — if multiple XML exports share the same
#      internal FileMaker File_Name (e.g. with + without DDR), the catmerge bulk
#      `INSERT BY NAME` over ALL chunks at once would violate the PK/UNIQUE constraints
#      (duplicate key "<UUID>, <File>"); the part path (merge_part_dbs) by contrast
#      resolves this correctly via sequential DELETE-by-File → "last wins" (long
#      documented as a catmerge precondition, but it was unchecked → test-data-specific crash).
# Either not met → return 1 → part-path fallback (catalog-agnostic, collision-safe).
_turbo_catmerge_ok() {
    local c
    while IFS= read -r c; do
        [ -z "$c" ] && continue
        [ "$(_turbo_catalog_owned "$c")" = "?" ] && return 1
    done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT DISTINCT catalog FROM chunkmap;" 2>/dev/null)

    # (2) Collect the internal File_Name per main chunk (= per physical XML file) and
    # check for duplicates. ONE duckdb run (sequential ATTACH→SELECT→DETACH, max. 1 DB
    # attached → no RAM peak). Prod (57 distinct File_Name) → no collision → catmerge.
    local esql; esql="$(mktemp)" || return 0
    local cid
    while IFS= read -r cid; do
        [ -z "$cid" ] && continue
        [ -f "$STREAMING_DIR/chunk_${cid}.duckdb" ] || continue
        printf "ATTACH '%s' AS k (READ_ONLY); SELECT File_Name FROM k.FilesCatalog LIMIT 1; DETACH k;\n" \
            "$STREAMING_DIR/chunk_${cid}.duckdb" >> "$esql"
    done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT chunk_id FROM chunkmap WHERE catalog='main' ORDER BY chunk_id;" 2>/dev/null)
    local dup=0
    if [ -s "$esql" ]; then
        dup=$("$DUCKDB_BIN" ":memory:" -noheader -list < "$esql" 2>/dev/null \
              | grep -v '^$' | sort | uniq -d | head -1 | wc -l | tr -d ' ')
    fi
    rm -f "$esql"
    [ "${dup:-0}" -ge 1 ] && return 1
    return 0
}

# ============================================================================
# Turbo mode — phases S/D/C
# Generalizes run_p1_parallel/merge_part_dbs from file to CHUNK granularity:
#   Phase S (Split & Plan)  — preprocess+split all files sequentially, populate the
#                             chunkmap; chunks persist under db/streaming/chunks/.
#   Phase D (Dispatch)      — worker pool (W=JOBS) pulls open chunks from the chunkmap
#                             (heaviest-first) → one chunk_<id>.duckdb per chunk.
#   Phase C (Consolidate)   — merge all chunk DBs into the master (DELETE-by-File for
#                             idempotency + INSERT … BY NAME; separated branches are
#                             record-disjoint, hence additive — verified).
# Produces the same per-file sidecars as the file-parallel path ($PARTDB_DIR/<i>.{out,
# rc,dur}) so the telemetry loop keeps running unchanged (P1_PREPROCESSED=true).
# ============================================================================

# Phase S for ONE file: preprocess + (streamify) + root check + split (with a chunkmap
# sidecar) → persistent chunks under $STREAMING_DIR/chunks/<idx>. Loads the chunkmap.
# Writes the pre-/split report to $PARTDB_DIR/<idx>.out (for FILE_ENC grep + errors).
# Returns: 0 ok | 1 not-found | 2 enc | 4 skip (legacy/unknown) | 5 preprocess/streamify | 3 split/load.
_turbo_split_one_file() {
    local idx="$1" FILENAME="$2"
    local out="$PARTDB_DIR/${idx}.out"
    : > "$out"
    local src="$XML_DIR/$FILENAME"
    [ -f "$src" ] || { echo "ERROR: File not found: $FILENAME" >>"$out"; return 1; }

    local cdir="$STREAMING_DIR/chunks/$idx"
    mkdir -p "$cdir"
    local BASENAME="${FILENAME%.xml}"
    # FM_T5_TRACE (opt-in, default-off → byte-identical): per-step markers, to attribute
    # the iconv share vs. the fused-awk share per file after the pass fusion.
    local _t5_on=""; [ -n "${FM_T5_TRACE:-}" ] && _t5_on=1

    # ---- (P2.1) Encoding → UTF-8 (the only remaining non-awk full pass) ----
    # iconv keeps the BOM; the fused awk strips it (NR==1). No more _clean.xml
    # round-trip — clean/rename/split/counts is done by the single awk pass below.
    local UTF8="$cdir/${BASENAME}.utf8.xml"
    local PRE_ENCODING; PRE_ENCODING=$(detect_encoding "$src")
    [ -n "$_t5_on" ] && echo "@T5 ${idx} iconv_start $(date +%s.%N)" >>"$out"
    case "$PRE_ENCODING" in
        utf-16le) iconv -f UTF-16LE -t UTF-8 "$src" > "$UTF8" 2>>"$out" || { echo "  ERROR: UTF-8 conversion failed" >>"$out"; rm -f "$UTF8"; return 2; } ;;
        utf-16be) iconv -f UTF-16BE -t UTF-8 "$src" > "$UTF8" 2>>"$out" || { echo "  ERROR: UTF-8 conversion failed" >>"$out"; rm -f "$UTF8"; return 2; } ;;
        *)        cp "$src" "$UTF8" 2>>"$out" || { echo "  ERROR: UTF-8 conversion failed" >>"$out"; rm -f "$UTF8"; return 2; } ;;
    esac
    [ -n "$_t5_on" ] && echo "@T5 ${idx} iconv_end $(date +%s.%N)" >>"$out"

    # Root detection on the UTF-8 stream (grep finds <FMSaveAsXML even behind the BOM).
    local ROOT_ELEMENT
    ROOT_ELEMENT=$(head -c 4096 "$UTF8" | grep -oE '<(FMSaveAsXML|FMDynamicTemplate)[ >]' | head -1 | sed 's/[< >]//g')
    if [ "$ROOT_ELEMENT" = "FMDynamicTemplate" ]; then
        echo "  WARNING: Skipped — legacy SaXML v2.0.0.0 format (FMDynamicTemplate)" >>"$out"
        echo "  This format (FileMaker 18.x) is not supported. Minimum: SaXML v2.1.0.0 (FileMaker 19+)." >>"$out"
        rm -f "$UTF8"; return 4
    fi
    [ -z "$ROOT_ELEMENT" ] && { echo "  WARNING: Skipped — could not detect XML root element (expected FMSaveAsXML)" >>"$out"; rm -f "$UTF8"; return 4; }

    # recmap (streamify-aware, identical to the process_single_file logic): in
    # --streamify mode map to the renamed record anchors, otherwise the original SUBCHUNK_RECMAP.
    local EFFECTIVE_RECMAP="$SUBCHUNK_RECMAP"
    if $STREAMIFY_MODE && [ -n "$STREAMIFY_RULES" ] && [ "${SUBCHUNK:-0}" -gt 0 ]; then
        local _erm="" _e _br _rec _new
        for _e in $SUBCHUNK_RECMAP; do
            _br="${_e%%:*}"; _rec="${_e##*:}"
            _new=$(printf '%s' "$STREAMIFY_RULES" | tr ',' '\n' \
                   | awk -F: -v b="$_br" -v r="$_rec" '$1==b && $2==r {print $3; exit}')
            [ -n "$_new" ] && _rec="$_new"
            _erm="$_erm${_erm:+ }$_br:$_rec"
        done
        EFFECTIVE_RECMAP="$_erm"
    fi
    # DDR-2-level sub-chunk entries (Calculation:*:M Script:*:M): per-file M (capped), the
    # `*` anchor has no streamify rename, so it is appended AFTER the rename pass verbatim.
    local _ddr_rm; _ddr_rm=$(_ddr_recmap_for_file "$UTF8")
    if [ -n "$_ddr_rm" ]; then
        EFFECTIVE_RECMAP="$EFFECTIVE_RECMAP $_ddr_rm"
        echo "  DDR-Subchunk: $FILENAME → ${_ddr_rm%% *}" >>"$out"
    fi

    # ---- (P2.1/P2.2) Fused pass: clean + counts + (streamify-rename) + split ----
    # ONE awk (mawk via AWK_BIN, LC_ALL=C for byte transparency) replaces the earlier
    # ~7 passes (tr-clean, 4× wc/tr-counts, streamify-awk+mv, splitter-awk). Empty rules
    # ⇒ no rename (DOM mode). The counts sidecar provides the report counters.
    local _rules=""; $STREAMIFY_MODE && _rules="$STREAMIFY_RULES"
    local NCHUNKS
    [ -n "$_t5_on" ] && echo "@T5 ${idx} fuse_start $(date +%s.%N)" >>"$out"
    NCHUNKS=$(LC_ALL=C "$AWK_BIN" -v outdir="$cdir" -v subchunk="$SUBCHUNK" -v recmap="$EFFECTIVE_RECMAP" \
                  -v nest="$NEST_MAP" \
                  -v chunkmap="$cdir/chunkmap.tsv" -v counts="$cdir/counts.tsv" -v rules="$_rules" \
                  -f "$TURBO_FUSE_AWK" < "$UTF8" 2>>"$out")
    [ -n "$_t5_on" ] && echo "@T5 ${idx} fuse_end $(date +%s.%N)" >>"$out"
    if [ -z "$NCHUNKS" ] || [ ! -f "$cdir/chunk_000_main.xml" ]; then
        echo "  ERROR: XML split failed" >>"$out"; rm -f "$UTF8"; return 3
    fi
    rm -f "$UTF8"   # release the iconv intermediate file (chunks are written)

    # Report counters from the counts sidecar (in_size, out_size, pre_cr, pre_del, stripped)
    local PRE_CR_COUNT=0 PRE_DEL_GUARD_COUNT=0 PRE_STRIPPED=0
    if [ -f "$cdir/counts.tsv" ]; then
        IFS=$'\t' read -r _ _ PRE_CR_COUNT PRE_DEL_GUARD_COUNT PRE_STRIPPED < "$cdir/counts.tsv"
    fi
    echo "  Preprocessed (enc=$PRE_ENCODING): replaced_cr=$PRE_CR_COUNT del_guard=$PRE_DEL_GUARD_COUNT stripped_invalid=$PRE_STRIPPED" >>"$out"
    $STREAMIFY_MODE && echo "  Streamify-Renaming angewandt (rules: $STREAMIFY_RULES)" >>"$out"
    echo "  Phase S: $NCHUNKS chunk(s) geplant" >>"$out"

    # est_bytes per chunk (UTF-8 size) for heaviest-first dispatch (LPT).
    # content_hash per chunk (sha256 of the PREPROCESSED chunk bytes):
    # the basis of the catalog-granular manifest comparison. Same loop as sizes, so no
    # extra pass. Note: on the --streamify path the bytes are already renamed → the hash
    # is policy-stable only as long as the policy stays constant (holds between seed and
    # incremental run). In the DOM default no renaming → policy-independent.
    local sizes="$cdir/sizes.tsv"; : > "$sizes"
    local hashes="$cdir/hashes.tsv"; : > "$hashes"
    local cf
    for cf in "$cdir"/chunk_*.xml; do
        printf '%s\t%s\n' "$cf" "$(stat -c%s "$cf" 2>/dev/null || stat -f%z "$cf" 2>/dev/null || echo 0)" >> "$sizes"
        printf '%s\t%s\n' "$cf" "$(sha256sum "$cf" 2>/dev/null | awk '{print $1}')" >> "$hashes"
    done
    # (P2.3) NO chunkmap INSERT here anymore — that is single-writer/serialization-
    # bound (global chunk_id) and happens AFTER the parallel split in the main process
    # via _turbo_load_chunkmap_one (strict file order). The worker only writes the
    # per-file sidecars chunkmap.tsv + sizes.tsv (above).
    return 0
}

# (P2.3) Serial chunkmap load of ONE file in the main process (AFTER the parallel
# split pool). MUST be called in strict file order so the global chunk_id
# (MAX+ROW_NUMBER) is assigned deterministically as on the serial path — that is the
# identity gate. Pure metadata (tiny), no XML volume.
# Returns: 0 ok | 3 load error.
_turbo_load_chunkmap_one() {
    local idx="$1" FILENAME="$2"
    local out="$PARTDB_DIR/${idx}.out"
    local cdir="$STREAMING_DIR/chunks/$idx"
    local BASENAME="${FILENAME%.xml}"
    local _fn="${BASENAME//\'/\'\'}"
    local _pol; _pol=$($STREAMIFY_MODE && echo sax || echo dom)
    if ! "$DUCKDB_BIN" "$CHUNKMAP_DB" -c "
        INSERT INTO chunkmap
        SELECT
            (SELECT COALESCE(MAX(chunk_id),0) FROM chunkmap) + ROW_NUMBER() OVER () AS chunk_id,
            '$_fn', catalog, '$_fn' || '::' || catalog, split_number,
            '$cdir' || '/' || chunk_file, record_count,
            CAST(split_number AS BIGINT) * CAST(sub_m AS BIGINT),
            NULL, '$_pol', NULL, 'pending', 1
        FROM read_csv('$cdir/chunkmap.tsv', delim='\t', header=false,
             columns={'catalog':'VARCHAR','split_number':'INTEGER','record_count':'INTEGER','sub_m':'INTEGER','chunk_file':'VARCHAR'});
        UPDATE chunkmap SET est_bytes = s.b
        FROM (SELECT p, b FROM read_csv('$cdir/sizes.tsv', delim='\t', header=false, columns={'p':'VARCHAR','b':'BIGINT'})) s
        WHERE chunkmap.chunk_path = s.p AND chunkmap.est_bytes IS NULL;
        UPDATE chunkmap SET content_hash = h.h
        FROM (SELECT p, h FROM read_csv('$cdir/hashes.tsv', delim='\t', header=false, columns={'p':'VARCHAR','h':'VARCHAR'})) h
        WHERE chunkmap.chunk_path = h.p AND chunkmap.content_hash IS NULL;
        " >>"$out" 2>&1; then
        echo "  ERROR: Chunkmap-Load fehlgeschlagen" >>"$out"; return 3
    fi
    return 0
}

# (P2.3) Phase-S worker (slot pool, sentinel pattern like _p1_worker): splits ONE
# file and persists rc/dur as sidecars (arrays can't be filled from subshells).
# Writes NO chunkmap (serial load afterwards). Last action = .done sentinel.
_turbo_split_worker() {
    local idx="$1"
    local fname; fname=$(basename "${XML_FILES[$idx]}")
    local t0 t1 rc
    t0=$(date +%s.%N)
    _turbo_split_one_file "$idx" "$fname"; rc=$?
    t1=$(date +%s.%N)
    echo "$rc" > "$PARTDB_DIR/${idx}.splitrc"
    awk -v a="$t1" -v b="$t0" 'BEGIN { printf "%.3f", a - b }' > "$PARTDB_DIR/${idx}.dur"
    : > "$PARTDB_DIR/${idx}.done"
    return 0
}

# One chunk worker (Phase D): parses exactly one chunk into its own chunk_<id>.duckdb.
# Single-writer is preserved (separate DBs). Writes rc/out sidecar + .done sentinel.
# rc=137 (OOM SIGKILL) triggers the backoff under --auto. Test hook FM_AUTO_TEST_OOM=
# "Catalog[:N]" simulates an OOM for chunks of this catalog in the first N attempts —
# but ONLY for still-divisible chunks (record_count>1), like a real size OOM (a
# 1-record chunk would be tiny and would never OOM).
_turbo_chunk_worker() {
    local cid="$1" cpath="$2" coff="$3" ccat="$4" catt="$5" crc="$6"
    local pdb="$STREAMING_DIR/chunk_${cid}.duckdb"
    local clog="$STREAMING_DIR/chunk_${cid}.out"
    rm -f "$pdb"; : > "$clog"
    if [ -n "${FM_AUTO_TEST_OOM:-}" ]; then
        local _fc="${FM_AUTO_TEST_OOM%%:*}" _fn="${FM_AUTO_TEST_OOM##*:}"
        [ "$_fn" = "$FM_AUTO_TEST_OOM" ] && _fn=1
        if [ "$ccat" = "$_fc" ] && [ "${catt:-1}" -le "$_fn" ] && [ "${crc:-0}" -gt 1 ]; then
            echo "[FM_AUTO_TEST_OOM] simulierter OOM: catalog=$ccat attempt=$catt rc=$crc" > "$clog"
            echo 137 > "$STREAMING_DIR/chunk_${cid}.rc"; : > "$STREAMING_DIR/chunk_${cid}.done"; return 0
        fi
    fi
    # Per-worker thread budget. local + dynamic scoping → memory_limit_prefix
    # (in run_p1_on) sees this value; background subshell + local → P2–P6 untouched.
    local DUCKDB_THREADS="${TURBO_WORKER_THREADS:-${DUCKDB_THREADS:-}}"
    # Env-guarded per-chunk duration for the LPT-floor measurement. Default-off
    # (no .dur, no behavior change → byte identity untouched).
    local _t4t0=""; [ -n "${FM_T4_TRACE:-}" ] && _t4t0=$(date +%s.%N)
    P1_TARGET_DB="$pdb" P1_SEQ_OFFSET="$coff" run_p1_on "$(dirname "$cpath")" "$(basename "$cpath")" "$clog"
    local rc=$?
    [ -n "$_t4t0" ] && awk -v a="$(date +%s.%N)" -v b="$_t4t0" 'BEGIN{printf "%.3f", a-b}' > "$STREAMING_DIR/chunk_${cid}.dur"
    echo "$rc" > "$STREAMING_DIR/chunk_${cid}.rc"
    [ "$rc" -ne 0 ] && rm -f "$pdb"     # only successful chunk DBs go into consolidation
    : > "$STREAMING_DIR/chunk_${cid}.done"
}

# Auto-backoff: cut an OOM chunk finer. Re-splits the chunk XML with
# M' = ⌊M/2⌋ (same record anchor from SUBCHUNK_RECMAP), inserts the finer pieces as
# new 'pending' rows (seq_offset = orig_offset + local_split_number×M', attempt+1)
# and removes the OOM row + its sidecars. Returns 0 = resplit done, 1 = not
# divisible (main/DDR_INFO, M≤1) or attempts (K) exhausted → the caller escalates.
_turbo_resplit_chunk() {
    local cid="$1"
    local K="${FM_AUTO_MAX_ATTEMPT:-4}"
    # sub_m is NOT held in the chunkmap (only in the sidecar) — the finer granularity
    # derives from record_count (chunkmap column): mp = ⌈record_count/2⌉ halves the chunk.
    local row; row=$("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c \
        "SELECT file_name||chr(9)||catalog||chr(9)||chunk_path||chr(9)||seq_offset||chr(9)||COALESCE(record_count,0)||chr(9)||attempt||chr(9)||COALESCE(parser_policy,'dom') FROM chunkmap WHERE chunk_id=$cid;")
    [ -z "$row" ] && return 1
    local fn cat cpath off rc att pol
    IFS=$'\t' read -r fn cat cpath off rc att pol <<< "$row"
    [ "${att:-1}" -ge "$K" ] && return 1            # convergence limit (K attempts)
    [ "${rc:-0}" -le 1 ] && return 1                # only ≤1 record left → not divisible further
    local recelem="" e
    for e in $SUBCHUNK_RECMAP; do
        if [ "${e%%:*}" = "$cat" ]; then recelem="${e#*:}"; recelem="${recelem%%:*}"; break; fi
    done
    [ -z "$recelem" ] && return 1                   # main/DDR_INFO etc. → not sub-chunkable
    local mp=$(( (rc + 1) / 2 )); [ "$mp" -lt 1 ] && mp=1   # ⌈rc/2⌉
    local rdir; rdir="$(dirname "$cpath")/resplit_${cid}"
    rm -rf "$rdir"; mkdir -p "$rdir"
    local sc="$rdir/chunkmap.tsv"
    awk -v outdir="$rdir" -v subchunk="$mp" -v recmap="${cat}:${recelem}:${mp}" -v chunkmap="$sc" \
        -f "$SPLITTER_AWK" < "$cpath" >"$rdir/split.log" 2>&1 || return 1
    [ -f "$sc" ] || return 1
    # Only rows of the target catalog: the splitter ALWAYS emits a 'main' row (the
    # thinned-out wrapper remainder), which does NOT count as a branch chunk here. At
    # least one branch row must be present (otherwise the DELETE would lose the records).
    awk -F'\t' -v c="$cat" '$1==c{f=1} END{exit !f}' "$sc" || return 1
    local szf="$rdir/sizes.tsv"; : > "$szf"
    local cf; for cf in "$rdir"/chunk_*.xml; do printf '%s\t%s\n' "$cf" "$(stat -c%s "$cf" 2>/dev/null || echo 0)" >> "$szf"; done
    local fnq="${fn//\'/\'\'}" catq="${cat//\'/\'\'}" polq="${pol//\'/\'\'}"
    # Atomic (transaction): if INSERT/UPDATE fails, the OOM row is kept
    # (the caller escalates), rather than deleting it without inserting a replacement.
    "$DUCKDB_BIN" "$CHUNKMAP_DB" -c "
        BEGIN TRANSACTION;
        INSERT INTO chunkmap
        SELECT (SELECT COALESCE(MAX(chunk_id),0) FROM chunkmap) + ROW_NUMBER() OVER (),
               '$fnq', '$catq', '$fnq'||'::'||'$catq', split_number,
               '$rdir'||'/'||chunk_file, record_count,
               CAST($off AS BIGINT) + CAST(split_number AS BIGINT)*CAST(sub_m AS BIGINT),
               NULL, '$polq', NULL, 'pending', $((att + 1))
        FROM read_csv('$sc', delim='\t', header=false,
             columns={'catalog':'VARCHAR','split_number':'INTEGER','record_count':'INTEGER','sub_m':'INTEGER','chunk_file':'VARCHAR'})
        WHERE catalog='$catq';
        UPDATE chunkmap SET est_bytes=s.b FROM (SELECT p,b FROM read_csv('$szf',delim='\t',header=false,columns={'p':'VARCHAR','b':'BIGINT'})) s
          WHERE chunkmap.chunk_path=s.p AND chunkmap.est_bytes IS NULL;
        DELETE FROM chunkmap WHERE chunk_id=$cid;
        COMMIT;" >"$rdir/insert.log" 2>&1 || return 1
    rm -f "$STREAMING_DIR/chunk_${cid}.rc" "$STREAMING_DIR/chunk_${cid}.out" \
          "$STREAMING_DIR/chunk_${cid}.done" "$STREAMING_DIR/chunk_${cid}.duckdb"
    return 0
}

# Phase D: rolling worker pool over ALL open chunks (cross-file), heaviest-first.
# Generalizes run_p1_parallel from file to chunk level (sentinel-based, bash-3.2).
# Under --auto as a round loop: after each wave rc→status is written back;
# OOM chunks (rc=137) are cut finer (_turbo_resplit_chunk) and re-dispatched in the
# next round, until no OOMs occur anymore or nothing is divisible further.
_turbo_dispatch() {
    local round=0

    # ---- Phase-D per-file chunk bookkeeping (quiet/web only) ----------------
    # Drives the import_start / import_progress / import_done lifecycle so the
    # file-status table shows ✴️ + a live "k von N" chunk counter and flips to ✅
    # once a file's last chunk lands. Built ONCE up front (survives --auto backoff
    # rounds): totals come from the chunkmap (skipped_unchanged chunks excluded),
    # the done counter accumulates. bash-3-safe: parallel indexed arrays + a linear
    # file scan (a handful of files). Re-split chunks from an OOM backoff carry new
    # chunk_ids not in this map → their progress is simply not shown live; the
    # authoritative per-file `file` event (report loop) still sets the final state.
    # _D_chunkslot is keyed by chunk_id (integer); _D_slot_* are per distinct file.
    local _d_cid _d_fn _d_slot _d_k _d_xi _d_bn
    local -a _D_slot_key _D_slot_disp _D_total _D_done _D_started _D_finished _D_chunkslot
    _D_slot_key=(); _D_slot_disp=(); _D_total=(); _D_done=(); _D_started=(); _D_finished=(); _D_chunkslot=()
    if $QUIET_MODE; then
        while IFS=$'\t' read -r _d_cid _d_fn; do
            [ -z "$_d_cid" ] && continue
            _d_slot=-1
            for ((_d_k = 0; _d_k < ${#_D_slot_key[@]}; _d_k++)); do
                [ "${_D_slot_key[$_d_k]}" = "$_d_fn" ] && { _d_slot=$_d_k; break; }
            done
            if [ "$_d_slot" -lt 0 ]; then
                _d_slot=${#_D_slot_key[@]}
                _D_slot_key[$_d_slot]="$_d_fn"
                # Exact display filename (matches directory_status.filename): map the
                # chunkmap file_name (basename without .xml) back to the real XML file.
                _D_slot_disp[$_d_slot]="${_d_fn}.xml"
                for _d_xi in "${!XML_FILES[@]}"; do
                    _d_bn=$(basename "${XML_FILES[$_d_xi]}")
                    [ "${_d_bn%.xml}" = "$_d_fn" ] && { _D_slot_disp[$_d_slot]="$_d_bn"; break; }
                done
                _D_total[$_d_slot]=0; _D_done[$_d_slot]=0
                _D_started[$_d_slot]=0; _D_finished[$_d_slot]=0
            fi
            _D_total[$_d_slot]=$(( _D_total[$_d_slot] + 1 ))
            _D_chunkslot[$_d_cid]=$_d_slot
        done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c \
            "SELECT chunk_id::VARCHAR || chr(9) || file_name FROM chunkmap WHERE status<>'skipped_unchanged' ORDER BY chunk_id;")
    fi

    while :; do
        round=$((round + 1))
        local -a CID CPATH COFF CCAT CATT CRC
        CID=(); CPATH=(); COFF=(); CCAT=(); CATT=(); CRC=()
        local cid cpath coff ccat catt crc
        while IFS=$'\t' read -r cid cpath coff ccat catt crc; do
            [ -z "$cid" ] && continue
            CID+=("$cid"); CPATH+=("$cpath"); COFF+=("$coff"); CCAT+=("$ccat"); CATT+=("$catt"); CRC+=("$crc")
        done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c \
            "SELECT chunk_id::VARCHAR || chr(9) || chunk_path || chr(9) || seq_offset::VARCHAR || chr(9) || catalog || chr(9) || attempt::VARCHAR || chr(9) || COALESCE(record_count,0)::VARCHAR
             FROM chunkmap WHERE status='pending' ORDER BY est_bytes DESC NULLS LAST, chunk_id;")
        local n=${#CID[@]}
        [ "$n" -eq 0 ] && break
        # Per-round disk guard: each chunk writes its own chunk_<id>.duckdb (+ .out/.rc/
        # .done sidecars). If the volume is already tight, dispatching only deepens the
        # "No space left on device" cascade — stop now with a logged root cause.
        if ! check_disk_space "Phase D (Runde $round, $n Chunks ausstehend)"; then
            echo "  ✗ Phase D abgebrochen: kein Speicher mehr frei (Details im Error-Log)." >&2
            break
        fi
        local W="${TURBO_W:-1}"; [ "$W" -lt 1 ] && W=1
        if $QUIET_MODE; then emit_log "Phase D (Runde $round): $n Chunks auf $W Worker"
        else echo "  Phase D (Runde $round): $n Chunks auf $W Worker → chunk_<id>.duckdb"; fi

        local i=0 done_count=0 s pid any
        local -a slot_pid slot_k
        for ((s = 0; s < W; s++)); do slot_pid[$s]=0; done
        while [ "$done_count" -lt "$n" ]; do
            for ((s = 0; s < W && i < n; s++)); do
                [ "${slot_pid[$s]}" -ne 0 ] && continue
                rm -f "$STREAMING_DIR/chunk_${CID[$i]}.done"
                # Lifecycle: first dispatched chunk of a file → import_start (✴️).
                if $QUIET_MODE; then
                    _d_slot=${_D_chunkslot[${CID[$i]}]:-}
                    if [ -n "$_d_slot" ] && [ "${_D_started[$_d_slot]:-0}" -eq 0 ]; then
                        _D_started[$_d_slot]=1
                        # done/total mitsenden, damit der Datei-Fortschrittsbalken im
                        # Frontend sofort bei 0 % startet (statt bis zum ersten reapten
                        # Chunk indeterminiert zu pulsen — der erste/schwerste Chunk kann
                        # mehrere Sekunden laufen). total steht hier bereits fest (Planung).
                        _emit_json import_start filename "${_D_slot_disp[$_d_slot]}" done "int=0" total "int=${_D_total[$_d_slot]}"
                    fi
                fi
                _turbo_chunk_worker "${CID[$i]}" "${CPATH[$i]}" "${COFF[$i]}" "${CCAT[$i]}" "${CATT[$i]}" "${CRC[$i]}" &
                slot_pid[$s]=$!; slot_k[$s]=$i; i=$((i + 1))
            done
            any=false
            for ((s = 0; s < W; s++)); do
                pid=${slot_pid[$s]}; [ "$pid" -eq 0 ] && continue
                # Normal completion = the worker wrote its .done sentinel. Fallback: the
                # process is no longer alive but left NO sentinel — this happens when the
                # worker died before its last line could run (e.g. disk full prevented the
                # .rc/.done writes). Without this guard the loop would poll forever. The
                # missing .rc then defaults to rc=3 → status=error → captured in the log.
                if [ -f "$STREAMING_DIR/chunk_${CID[${slot_k[$s]}]}.done" ] || ! kill -0 "$pid" 2>/dev/null; then
                    wait "$pid" 2>/dev/null
                    # Lifecycle: chunk reaped → bump the file's done counter, emit
                    # import_progress (✴️ "k von N"); last chunk → import_done (✅).
                    if $QUIET_MODE; then
                        _d_slot=${_D_chunkslot[${CID[${slot_k[$s]}]}]:-}
                        if [ -n "$_d_slot" ]; then
                            _D_done[$_d_slot]=$(( _D_done[$_d_slot] + 1 ))
                            _emit_json import_progress filename "${_D_slot_disp[$_d_slot]}" done "int=${_D_done[$_d_slot]}" total "int=${_D_total[$_d_slot]}"
                            if [ "${_D_done[$_d_slot]}" -ge "${_D_total[$_d_slot]}" ] && [ "${_D_finished[$_d_slot]:-0}" -eq 0 ]; then
                                _D_finished[$_d_slot]=1
                                _emit_json import_done filename "${_D_slot_disp[$_d_slot]}"
                            fi
                        fi
                    fi
                    slot_pid[$s]=0; done_count=$((done_count + 1)); any=true
                fi
            done
            if $QUIET_MODE && $any; then phase_progress import $(( (done_count * 100) / n )) "Phase D: $done_count/$n Chunks"; fi
            $any || sleep 0.1
        done

        # rc → chunkmap status (main process = the only chunkmap writer).
        local upd="" r st
        for ((s = 0; s < n; s++)); do
            cid="${CID[$s]}"; r=$(cat "$STREAMING_DIR/chunk_${cid}.rc" 2>/dev/null); r=${r:-3}
            # 137 = SIGKILL (Linux cgroup OOM-killer), 143 = SIGTERM. A chunk worker is
            # killed by a signal almost only under memory pressure (nobody else TERMs a
            # single worker); some environments (macOS/Docker-Desktop VM) deliver the OOM
            # as SIGTERM(143) instead of SIGKILL(137). Treat both as OOM → --auto backoff.
            if [ "$r" = "0" ]; then st=done; elif [ "$r" = "137" ] || [ "$r" = "143" ]; then st=oom; else st=error; fi
            upd="$upd UPDATE chunkmap SET status='$st' WHERE chunk_id=$cid;"
            # Persist the failure for post-mortem: a hard error (st=error) is captured
            # immediately (no backoff will retry it); an OOM is captured only once the
            # backoff has actually exhausted it (handled below) to avoid noise on chunks
            # that succeed after a finer re-split. The chunk's .out holds the DuckDB/parse
            # stderr; an empty/missing .out itself is a signal (e.g. the worker could not
            # even create its log → disk full).
            if [ "$st" = "error" ]; then
                {
                    echo "chunk_id=$cid  rc=$r  catalog=${CCAT[$s]:-?}  attempt=${CATT[$s]:-?}"
                    echo "chunk_path=${CPATH[$s]:-?}"
                    echo "--- chunk_${cid}.out ---"
                    if [ -s "$STREAMING_DIR/chunk_${cid}.out" ]; then cat "$STREAMING_DIR/chunk_${cid}.out"
                    else echo "(leer oder fehlend — Worker konnte sein Log evtl. nicht schreiben, z.B. Disk voll)"; fi
                } | log_error_section "Phase D chunk $cid failed (rc=$r, catalog=${CCAT[$s]:-?})"
            fi
        done
        [ -n "$upd" ] && "$DUCKDB_BIN" "$CHUNKMAP_DB" -c "$upd" >/dev/null 2>&1

        $AUTO_MODE || break    # without backoff: one round

        local -a ooms; ooms=()
        while IFS= read -r cid; do [ -n "$cid" ] && ooms+=("$cid"); done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT chunk_id FROM chunkmap WHERE status='oom';")
        [ ${#ooms[@]} -eq 0 ] && break
        local progress=false diag
        for cid in "${ooms[@]}"; do
            if _turbo_resplit_chunk "$cid"; then
                progress=true
                if $QUIET_MODE; then emit_log "Auto-Backoff: Chunk $cid OOM → feiner geschnitten"
                else echo "  ↯ Auto-Backoff: Chunk $cid OOM → split-group feiner (M halbiert), re-dispatch"; fi
            else
                diag=$("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT file_name||' / '||catalog||' (records='||COALESCE(record_count,0)||', attempt='||attempt||', est_bytes='||COALESCE(est_bytes,0)||')' FROM chunkmap WHERE chunk_id=$cid;")
                "$DUCKDB_BIN" "$CHUNKMAP_DB" -c "UPDATE chunkmap SET status='error' WHERE chunk_id=$cid;" >/dev/null 2>&1
                echo "  ✗ Auto-Backoff erschöpft: $diag — passt nicht ins Speicherband (nicht weiter teilbar oder K erreicht)." >&2
                {
                    echo "Auto-Backoff erschöpft (nicht weiter teilbar oder K=${FM_AUTO_MAX_ATTEMPT:-4} Versuche erreicht)."
                    echo "$diag"
                    echo "--- chunk_${cid}.out ---"
                    if [ -s "$STREAMING_DIR/chunk_${cid}.out" ]; then cat "$STREAMING_DIR/chunk_${cid}.out"
                    else echo "(leer oder fehlend)"; fi
                } | log_error_section "Phase D chunk $cid OOM — Backoff exhausted"
            fi
        done
        $progress || break     # no divisible OOM left → stop (the rest stays an error)
    done
}

# Phase C, stage 1: merge the chunk DBs of ONE file into its part_<idx>.duckdb.
# seed = main chunk (lowest chunk_id, carries base catalogs + per-document tables);
# the remaining chunks contribute ONLY their (record-disjoint) branch tables. For
# non-seed chunks the PER-DOCUMENT tables FilesCatalog/XMLMetadata are skipped — they
# are identical in EVERY chunk (each chunk is a full <FMSaveAsXML>) and would
# otherwise be duplicated per chunk; all other tables are disjoint across the chunks
# (unique UUIDs) → additive INSERT. Result = exactly the part_<idx>.duckdb that a
# classic --jobs+--split worker would have produced via UPSERT. Returns: 0 ok | 3 error.
# Reads the file's chunk list from the chunkmap (chunk_id order = XML order).
TURBO_PERDOC_SKIP="FilesCatalog XMLMetadata"
_turbo_build_part() {
    local idx="$1"
    local fn; fn="$(basename "${XML_FILES[$idx]}")"; fn="${fn%.xml}"
    local part="$PARTDB_DIR/part_${idx}.duckdb"
    rm -f "$part"
    local -a cdbs; local cid bad=0
    while IFS= read -r cid; do
        [ -z "$cid" ] && continue
        if [ "$(cat "$STREAMING_DIR/chunk_${cid}.rc" 2>/dev/null)" != "0" ] || [ ! -f "$STREAMING_DIR/chunk_${cid}.duckdb" ]; then
            bad=1; cat "$STREAMING_DIR/chunk_${cid}.out" >> "$PARTDB_DIR/${idx}.out" 2>/dev/null
            continue
        fi
        cdbs+=("$STREAMING_DIR/chunk_${cid}.duckdb")
    done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c \
        "SELECT chunk_id FROM chunkmap WHERE file_name = '${fn//\'/\'\'}' ORDER BY chunk_id;")
    [ "$bad" -ne 0 ] && return 3
    [ ${#cdbs[@]} -eq 0 ] && return 3

    cp "${cdbs[0]}" "$part" || return 3
    [ ${#cdbs[@]} -eq 1 ] && return 0   # only main → done
    local tables; tables=$("$DUCKDB_BIN" -readonly "$part" -noheader -list -c \
        "SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE' AND table_name <> 'SchemaInfo' ORDER BY table_name;")
    local msql; msql="$(mktemp)"
    local k=1 cdb tbl
    while [ "$k" -lt "${#cdbs[@]}" ]; do
        cdb="${cdbs[$k]}"
        echo "ATTACH '$cdb' AS c (READ_ONLY);" >> "$msql"
        while IFS= read -r tbl; do
            [ -z "$tbl" ] && continue
            case " $TURBO_PERDOC_SKIP " in *" $tbl "*) continue ;; esac
            echo "INSERT INTO \"$tbl\" BY NAME SELECT * FROM c.\"$tbl\";" >> "$msql"
        done <<< "$tables"
        echo "DETACH c;" >> "$msql"
        k=$((k + 1))
    done
    local prc=0
    [ -s "$msql" ] && { "$DUCKDB_BIN" "$part" < "$msql" >> "$PARTDB_DIR/${idx}.out" 2>&1 || prc=3; }
    rm -f "$msql"
    return $prc
}

# sha256 of the RAW XML (authoritative content hash). First field only (the hash).
_turbo_file_hash() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

# ── Phase R (Reconciliation) — ONLY under --changed-only ─────────────────────
# Determines the file indices to SKIP (INCR_SKIP[idx]=1): unchanged per the
# (mtime,size) prefilter, otherwise the content hash; plus a converter/schema version
# gate (drift ⇒ full build, no skips) and master existence (missing ⇒ full build).
# Collision group: if multiple XML share the same internal File_Name and ONE of them
# changes, ALL must be redone (otherwise "last wins" breaks at merge time).
# INCR_SKIP[idx]=1 — keys are integer file indices → a plain (sparse) indexed array
# (bash-3.2-safe; was `declare -gA`, which needs bash 4.2+ for both -g and -A).
INCR_SKIP=()
_turbo_phase_r() {
    INCR_SKIP=()
    $CHANGED_ONLY || return 0
    $FORCE_REBUILD && { echo "  --changed-only + --force-rebuild → Voll-Build (Manifest ignoriert)"; return 0; }
    [ -f "$DB_FILE" ] || { echo "  --changed-only: Master fehlt → Voll-Build (kein Skip)"; return 0; }
    local mcount; mcount=$("$DUCKDB_BIN" -readonly "$MANIFEST_DB" -noheader -list -c "SELECT COUNT(*) FROM manifest_file;" 2>/dev/null)
    [ "${mcount:-0}" -eq 0 ] && { echo "  --changed-only: leeres Manifest → Voll-Build"; return 0; }

    local i fn mt sz rec m_mt m_sz m_hash m_conv m_schema m_internal h
    local -a cand_internal     # idx → internal_file_name (skip candidates); integer keys → indexed
    # changed_internal: SET of internal_file_names that have at least one changed XML.
    # bash-3.2-safe set = newline-delimited string (keys may contain spaces, e.g.
    # "Aufträge Verkauf"); membership via a native case-glob (no subprocess).
    local changed_internal=$'\n'
    for i in "${!XML_FILES[@]}"; do
        fn="$(basename "${XML_FILES[$i]}")"; fn="${fn%.xml}"
        mt=$(stat -c%Y "${XML_FILES[$i]}" 2>/dev/null || stat -f%m "${XML_FILES[$i]}" 2>/dev/null)
        sz=$(stat -c%s "${XML_FILES[$i]}" 2>/dev/null || stat -f%z "${XML_FILES[$i]}" 2>/dev/null)
        rec=$("$DUCKDB_BIN" -readonly "$MANIFEST_DB" -noheader -list -c \
            "SELECT file_mtime||chr(9)||file_size||chr(9)||COALESCE(file_hash,'')||chr(9)||COALESCE(converter_version,'')||chr(9)||COALESCE(schema_version,'')||chr(9)||COALESCE(internal_file_name,'') FROM manifest_file WHERE file_name='${fn//\'/\'\'}';")
        [ -z "$rec" ] && continue   # new file → treat as changed (no skip)
        IFS=$'\t' read -r m_mt m_sz m_hash m_conv m_schema m_internal <<< "$rec"
        if [ "$m_conv" != "$CONVERTER_VERSION" ] || [ "$m_schema" != "$SCHEMA_VERSION_EXPECTED" ]; then
            echo "  --changed-only: Konverter/Schema-Drift → Voll-Build (alles neu)"
            INCR_SKIP=(); return 0
        fi
        if [ "$mt" = "$m_mt" ] && [ "$sz" = "$m_sz" ]; then
            cand_internal[$i]="$m_internal"
        else
            h=$(_turbo_file_hash "${XML_FILES[$i]}")
            if [ -n "$h" ] && [ "$h" = "$m_hash" ]; then cand_internal[$i]="$m_internal"
            else changed_internal="${changed_internal}${m_internal}"$'\n'; fi
        fi
    done
    for i in "${!cand_internal[@]}"; do
        # group (internal_file_name) has a change → do not skip
        case "$changed_internal" in *$'\n'"${cand_internal[$i]}"$'\n'*) continue ;; esac
        INCR_SKIP[$i]=1
    done
}

# ── Phase S (catalog level): catalog gate ────────────────────────
# Marks unchanged NON-main catalogs of changed files as skipped_unchanged, provided
# (a) --changed-only without --force-rebuild, (b) the batch is COLLISION-FREE
# (otherwise the part-path fallback kicks in at Phase C, which does not respect
# catalog skips), (c) the current catalog_hash == manifest_catalog.catalog_hash.
# Effect: the dispatcher (status='pending') skips them, and _turbo_merge_catalog
# produces no parquet for them → their master rows stay untouched (the scoped DELETE
# is by construction, since DELETE is limited to the File_Names present in the parquet).
# 'main' is NEVER skipped (carries FilesCatalog/XMLMetadata + feeds _turbo_write_manifest).
_turbo_catalog_gate() {
    $CHANGED_ONLY || return 0
    $FORCE_REBUILD && return 0
    [ -f "$MANIFEST_DB" ] || return 0
    # Non-skippable catalogs: 'main' (metadata/manifest) + feeders of multi-fed tables.
    local c _excl=""
    while IFS= read -r c; do
        [ -z "$c" ] && continue
        _turbo_catalog_feeds_multifed "$c" && _excl="$_excl${_excl:+,}'${c//\'/\'\'}'"
    done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT DISTINCT catalog FROM chunkmap;" 2>/dev/null)
    [ -z "$_excl" ] && _excl="''"
    "$DUCKDB_BIN" "$CHUNKMAP_DB" -c "
        ATTACH '$MANIFEST_DB' AS mf (READ_ONLY);
        UPDATE chunkmap SET status='skipped_unchanged'
        FROM (
            SELECT cur.file_name AS fn, cur.catalog AS cat
            FROM (
                SELECT file_name, catalog,
                       md5(string_agg(content_hash, '|' ORDER BY split_number)) AS h
                FROM chunkmap
                WHERE catalog <> 'main' AND catalog NOT IN ($_excl)
                GROUP BY file_name, catalog
            ) cur
            JOIN mf.manifest_catalog mc
              ON mc.file_name = cur.file_name AND mc.catalog = cur.catalog
             AND mc.catalog_hash = cur.h
            -- Nur wenn KEINE interne File_Name-Kollision unter den Batch-Dateien:
            WHERE NOT EXISTS (
                SELECT 1 FROM mf.manifest_file f1
                JOIN mf.manifest_file f2
                  ON f1.internal_file_name = f2.internal_file_name
                 AND f1.file_name <> f2.file_name
                WHERE f1.file_name IN (SELECT DISTINCT file_name FROM chunkmap)
                  AND f2.file_name IN (SELECT DISTINCT file_name FROM chunkmap)
            )
        ) skip
        WHERE chunkmap.file_name = skip.fn AND chunkmap.catalog = skip.cat
          AND chunkmap.status = 'pending';
        DETACH mf;
    " >/dev/null 2>&1 || true
}

# ── Update the manifest — ALWAYS after a successful consolidation ──────
# For the files actually processed (not skipped, rc 0): signature +
# internal File_Name (from the part_<idx>.duckdb, before it is cleaned up) + versions.
_turbo_write_manifest() {
    local i fn part mcid internal fmver ddr h mt sz esc
    for i in "${!XML_FILES[@]}"; do
        [ -f "$PARTDB_DIR/${i}.unchanged" ] && continue          # skipped → manifest row stays valid
        [ "$(cat "$PARTDB_DIR/${i}.rc" 2>/dev/null)" = "0" ] || continue   # successes only
        fn="$(basename "${XML_FILES[$i]}")"; fn="${fn%.xml}"
        # Metadata source: part_<i> (part path) OR the file's main chunk (the catalog-
        # granular path builds no parts). Both carry the file's FilesCatalog/XMLMetadata.
        part="$PARTDB_DIR/part_${i}.duckdb"
        if [ ! -f "$part" ]; then
            mcid=$("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT chunk_id FROM chunkmap WHERE file_name='${fn//\'/\'\'}' AND catalog='main' ORDER BY chunk_id LIMIT 1;" 2>/dev/null)
            [ -n "$mcid" ] && part="$STREAMING_DIR/chunk_${mcid}.duckdb"
        fi
        [ -f "$part" ] || continue                                # neither part nor main chunk → skip
        internal=$("$DUCKDB_BIN" -readonly "$part" -noheader -list -c "SELECT File_Name FROM FilesCatalog LIMIT 1;" 2>/dev/null)
        fmver=$("$DUCKDB_BIN" -readonly "$part" -noheader -list -c "SELECT FileMaker_Version FROM FilesCatalog LIMIT 1;" 2>/dev/null)
        ddr=$("$DUCKDB_BIN" -readonly "$part" -noheader -list -c "SELECT Has_DDR_INFO FROM FilesCatalog LIMIT 1;" 2>/dev/null)
        mt=$(stat -c%Y "${XML_FILES[$i]}" 2>/dev/null || stat -f%m "${XML_FILES[$i]}" 2>/dev/null)
        sz=$(stat -c%s "${XML_FILES[$i]}" 2>/dev/null || stat -f%z "${XML_FILES[$i]}" 2>/dev/null)
        h=$(_turbo_file_hash "${XML_FILES[$i]}")
        esc() { printf '%s' "$1" | sed "s/'/''/g"; }
        "$DUCKDB_BIN" "$MANIFEST_DB" -c "
            INSERT INTO manifest_file
              (file_name, internal_file_name, file_mtime, file_size, file_hash,
               fm_version, has_ddr_info, converter_version, schema_version, last_ingest_ts)
            VALUES ('$(esc "$fn")', '$(esc "$internal")', ${mt:-0}, ${sz:-0}, '$(esc "$h")',
               '$(esc "$fmver")', '$(esc "$ddr")', '$(esc "$CONVERTER_VERSION")', '$(esc "$SCHEMA_VERSION_EXPECTED")', (now() AT TIME ZONE 'UTC'))
            ON CONFLICT (file_name) DO UPDATE SET
               internal_file_name=excluded.internal_file_name, file_mtime=excluded.file_mtime,
               file_size=excluded.file_size, file_hash=excluded.file_hash,
               fm_version=excluded.fm_version, has_ddr_info=excluded.has_ddr_info,
               converter_version=excluded.converter_version, schema_version=excluded.schema_version,
               last_ingest_ts=excluded.last_ingest_ts;" >/dev/null 2>&1
        # manifest_catalog: catalog_hash per (file × catalog) from the content_hashes of
        # the split-group (ordered by split_number). The chunkmap contains ALL catalogs of
        # this file (skipped_unchanged ones also carry their content_hash from Phase S), so
        # the hash reflects the full current state. UPSERT only →
        # file-level skipped files (not in the chunkmap) keep their rows.
        "$DUCKDB_BIN" "$MANIFEST_DB" -c "
            ATTACH '$CHUNKMAP_DB' AS cm (READ_ONLY);
            INSERT INTO manifest_catalog (file_name, catalog, catalog_hash, record_count, last_ingest_ts)
            SELECT file_name, catalog,
                   md5(string_agg(content_hash, '|' ORDER BY split_number)),
                   SUM(record_count), (now() AT TIME ZONE 'UTC')
            FROM cm.chunkmap WHERE file_name='$(esc "$fn")'
            GROUP BY file_name, catalog
            ON CONFLICT (file_name, catalog) DO UPDATE SET
               catalog_hash=excluded.catalog_hash, record_count=excluded.record_count,
               last_ingest_ts=excluded.last_ingest_ts;
            DETACH cm;" >/dev/null 2>&1
    done
}

# catalogs_built-Marker (pipeline_state in der Manifest-DB) lesen/schreiben.
# 'ok' ⇔ P2–P6 wurden zuletzt für den aktuellen Manifest-Stand vollständig gebaut.
# Read echot den Wert (leer, wenn DB/Tabelle/Zeile fehlt → konservativ „nicht ok").
_catalogs_state() {
    [ -f "$MANIFEST_DB" ] || { echo ""; return 0; }
    "$DUCKDB_BIN" -readonly "$MANIFEST_DB" -noheader -list -c \
        "SELECT value FROM pipeline_state WHERE key='catalogs_built';" 2>/dev/null
}
# _catalogs_state_set <ok|building> — idempotenter Upsert (Fehler nicht fatal).
_catalogs_state_set() {
    [ -f "$MANIFEST_DB" ] || return 0
    "$DUCKDB_BIN" "$MANIFEST_DB" -c \
        "INSERT INTO pipeline_state VALUES ('catalogs_built', '$1') ON CONFLICT (key) DO UPDATE SET value=excluded.value;" \
        >/dev/null 2>&1 || true
}

# Orchestrates S→D→C and writes the per-file sidecars for the telemetry loop.
# Phase C uses the proven merge_part_dbs (file-parallel path): stage 1 builds a
# part_<idx>.duckdb per file from its chunks, stage 2 merges the parts (DELETE-by-internal-
# File_Name) into the master — so the multiple-XML-per-File_Name collision (two XML
# exports of the same FileMaker file) is resolved identically to the classic path (last wins).
# Sets $TURBO_RC (= MERGE_RC; per-file errors appear as an rc sidecar as on the classic path).
run_turbo_pipeline() {
    TURBO_RC=0
    # T-3 trace (opt-in via FM_T3_TRACE): timestamp the phase boundaries S/D/C1/C2 to
    # separate the serial consolidation (stage 1 _turbo_build_part) from the parallel
    # dispatch. Default-off → byte-identical behavior (pure stdout echo).
    _t3() { [ -n "${FM_T3_TRACE:-}" ] && echo "@T3 $1 $(date +%s.%N)"; return 0; }
    local CHUNKS_ROOT="$STREAMING_DIR/chunks"
    rm -rf "$CHUNKS_ROOT"; mkdir -p "$CHUNKS_ROOT"
    rm -f "$STREAMING_DIR"/chunk_*.duckdb "$STREAMING_DIR"/chunk_*.rc "$STREAMING_DIR"/chunk_*.out "$STREAMING_DIR"/chunk_*.done "$STREAMING_DIR"/chunk_*.dur

    # Preflight: the turbo pipeline materializes one chunk_<id>.duckdb per chunk plus
    # split XML — a disk-full mid-run corrupts sidecars (.rc/.done) and stalls the
    # dispatcher. Fail fast with a logged, actionable error instead.
    if ! check_disk_space "Turbo-Preflight (Phase S)"; then TURBO_RC=8; return 8; fi

    # ---- Phase R (Reconciliation, --changed-only only): determine the skip set ----
    _turbo_phase_r
    local _nskip=${#INCR_SKIP[@]}
    if $CHANGED_ONLY && [ "$_nskip" -gt 0 ]; then
        if $QUIET_MODE; then emit_log "Phase R: $_nskip/$TOTAL Datei(en) unverändert → übersprungen"
        else echo "Phase R: $_nskip/$TOTAL Datei(en) unverändert → übersprungen (Manifest)"; fi
    fi

    # ---- Phase S (P2.3: parallel split pool + serial chunkmap load) ----
    # The split part is independent per file (its own chunks/<idx>/) → slot pool over
    # W_S workers (sentinel pattern like run_p1_parallel). The chunkmap INSERT is
    # single-writer + serialization-bound (global chunk_id) and runs AFTERWARDS serially
    # in the main process in strict file order → identity W_S-invariant.
    # W_S = FM_PHASE_S_JOBS (default JOBS); the I/O-saturation / S→C question is decided
    # by the bench matrix, NOT the identity (which is by construction).
    if $QUIET_MODE; then emit_log "Phase S: $TOTAL Datei(en) splitten + Chunkmap planen"
    else echo "Phase S: $TOTAL Datei(en) splitten + Chunkmap planen"; fi
    local i
    local -a FILE_SPLIT_RC
    local SJOBS="${FM_PHASE_S_JOBS:-$JOBS}"; [ "$SJOBS" -ge 1 ] 2>/dev/null || SJOBS=1
    _t3 S_start

    # Mark skip files (manifest) up front — no worker needed.
    # Lifecycle event (quiet/web only): file_skip → ⏭️ in the file-status table.
    for i in "${!XML_FILES[@]}"; do
        if [ -n "${INCR_SKIP[$i]}" ]; then
            echo "  unverändert (Manifest-Skip)" > "$PARTDB_DIR/${i}.out"
            : > "$PARTDB_DIR/${i}.unchanged"
            echo "0" > "$PARTDB_DIR/${i}.splitrc"
            echo "0.000" > "$PARTDB_DIR/${i}.dur"
            $QUIET_MODE && _emit_json file_skip filename "$(basename "${XML_FILES[$i]}")"
        fi
    done

    # Slot pool: split only non-skip files (in parallel, without the chunkmap INSERT).
    # Lifecycle event: file_plan → 🟡 (geplant) for every file that will be processed.
    local -a _sq=()
    for i in "${!XML_FILES[@]}"; do
        if [ -z "${INCR_SKIP[$i]}" ]; then
            _sq+=("$i")
            $QUIET_MODE && _emit_json file_plan filename "$(basename "${XML_FILES[$i]}")"
        fi
    done
    local _sn=${#_sq[@]} _si=0 _sdone=0 _ss _spid _sany
    local -a _sslot_pid _sslot_idx
    for ((_ss = 0; _ss < SJOBS; _ss++)); do _sslot_pid[$_ss]=0; done
    while [ "$_sdone" -lt "$_sn" ]; do
        for ((_ss = 0; _ss < SJOBS && _si < _sn; _ss++)); do
            [ "${_sslot_pid[$_ss]}" -ne 0 ] && continue
            i=${_sq[$_si]}
            rm -f "$PARTDB_DIR/${i}.done"
            _turbo_split_worker "$i" &
            # Lifecycle event: chunk_start → 🔥 (wird gerade gechunkt).
            $QUIET_MODE && _emit_json chunk_start filename "$(basename "${XML_FILES[$i]}")"
            _sslot_pid[$_ss]=$!; _sslot_idx[$_ss]=$i; _si=$((_si + 1))
        done
        _sany=false
        for ((_ss = 0; _ss < SJOBS; _ss++)); do
            _spid=${_sslot_pid[$_ss]}; [ "$_spid" -eq 0 ] && continue
            if [ -f "$PARTDB_DIR/${_sslot_idx[$_ss]}.done" ]; then
                wait "$_spid" 2>/dev/null
                # Lifecycle event: chunk_done → 🟢 (Split fertig, wartet auf Import).
                $QUIET_MODE && _emit_json chunk_done filename "$(basename "${XML_FILES[${_sslot_idx[$_ss]}]}")"
                _sslot_pid[$_ss]=0; _sdone=$((_sdone + 1)); _sany=true
            fi
        done
        # Opt 1: Phase S füllt das `chunk`-Balkensegment (0-25) live mit dem
        # Split-Pool-Fortschritt — sonst stünde der Balken die ganze Split-Phase auf
        # ~5 % und spränge erst beim ersten Phase-D-Worker auf das Import-Segment.
        if $QUIET_MODE && $_sany && [ "$_sn" -gt 0 ]; then
            phase_progress chunk $(( (_sdone * 100) / _sn )) "Phase S: $_sdone/$_sn Dateien gesplittet"
        fi
        $_sany || sleep 0.1
    done

    # Serial chunkmap load in strict file order (global chunk_id = identical to the
    # serial path). FILE_SPLIT_RC from the splitrc sidecars; load error → rc 3.
    for i in "${!XML_FILES[@]}"; do
        FILE_SPLIT_RC[$i]=$(cat "$PARTDB_DIR/${i}.splitrc" 2>/dev/null || echo 3)
        if [ "${FILE_SPLIT_RC[$i]}" -eq 0 ] && [ ! -f "$PARTDB_DIR/${i}.unchanged" ]; then
            _turbo_load_chunkmap_one "$i" "$(basename "${XML_FILES[$i]}")" || FILE_SPLIT_RC[$i]=3
        fi
    done

    # ---- Phase S (catalog gate): unchanged catalogs → skipped_unchanged ----
    _turbo_catalog_gate
    if $CHANGED_ONLY && ! $FORCE_REBUILD; then
        local _nskipcat
        _nskipcat=$("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT COUNT(*) FROM chunkmap WHERE status='skipped_unchanged';" 2>/dev/null)
        if [ "${_nskipcat:-0}" -gt 0 ]; then
            if $QUIET_MODE; then emit_log "Phase S: $_nskipcat Katalog-Chunk(s) unverändert → übersprungen (manifest_catalog)"
            else echo "  Phase S: $_nskipcat Katalog-Chunk(s) unverändert → übersprungen (manifest_catalog)"; fi
        fi
    fi

    # ---- Phase S → „nichts geändert"-Short-Circuit-Entscheidung ----
    # 'main' wird NIE gegated → jede nicht-manifest-übersprungene Datei erzeugt ≥1
    # 'pending'-Chunk. Also bedeutet pending==0 exakt „keine einzige Datei geändert".
    # Dann ist der Master-DB byte-identisch zum Vorlauf → P2–P6 + Sync sind reine
    # Wiederholungen. Nur überspringen, wenn der catalogs_built-Marker bestätigt, dass die
    # Kataloge zuletzt VOLLSTÄNDIG (bis P6) gebaut wurden (Absicherung gegen Abbruch
    # zwischen Phase C und P6). --force-rebuild übergeht das bewusst.
    if $CHANGED_ONLY && ! $FORCE_REBUILD; then
        local _pending
        _pending=$("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT COUNT(*) FROM chunkmap WHERE status='pending';" 2>/dev/null)
        [[ "$_pending" =~ ^[0-9]+$ ]] || _pending=1   # Query-Fehler → sicherheitshalber NICHT skippen
        if [ "$_pending" -eq 0 ] && [ "$(_catalogs_state)" = "ok" ]; then
            TURBO_NO_CHANGES=true
            if $QUIET_MODE; then emit_log "Phase S: keine Änderungen erkannt → Katalog-Rebuild (P2–P6) + Sync übersprungen (DB bereits aktuell)"
            else echo "Phase S: keine Änderungen erkannt → Katalog-Rebuild (P2–P6) + Sync übersprungen (DB bereits aktuell)"; fi
        fi
    fi
    # Dieser Lauf verändert P1/Kataloge (oder die Kataloge sind noch nicht 'ok') →
    # Marker invalidieren, damit ein Abbruch zwischen Phase C und P6 beim nächsten Lauf
    # NICHT fälschlich überspringt. Erst nach erfolgreichem P6 wieder auf 'ok' setzen.
    $TURBO_NO_CHANGES || _catalogs_state_set building

    # ---- Phase S (explosion guard): hard ceiling on the total planned chunk count ----
    # Defense-in-depth backstop (the 119k-chunk crash lesson): even with the per-file DDR
    # cap + record gate, a pathological config (e.g. FM_DDR_MIN_RECORDS lowered to engage
    # the whole corpus at a small M) could multiply chunks corpus-wide. Phase D spawns ~1
    # DuckDB process per chunk → abort BEFORE dispatch rather than exhaust the host. Raise
    # / disable via FM_MAX_TOTAL_CHUNKS (default 10000; 0 = off). Legitimate runs sit well
    # below: ~880 base, ~1650 with DDR-auto, ~3800 with explicit DDR M=2.
    local _max_chunks="${FM_MAX_TOTAL_CHUNKS:-10000}"
    if [ "${_max_chunks:-0}" -gt 0 ]; then
        local _tot_chunks
        _tot_chunks=$("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c "SELECT COUNT(*) FROM chunkmap;" 2>/dev/null)
        [[ "$_tot_chunks" =~ ^[0-9]+$ ]] || _tot_chunks=0
        if [ "$_tot_chunks" -gt "$_max_chunks" ]; then
            { echo "✗ Phase-S-Abbruch: $_tot_chunks geplante Chunks überschreiten den Sicherheits-Deckel FM_MAX_TOTAL_CHUNKS=$_max_chunks."
              echo "  Schutz gegen Chunk-Explosion (1 Chunk ≈ 1 DuckDB-Prozess + Merge in Phase D — der 119k-Crash)."
              echo "  Häufigste Ursache: DDR-Subchunk. Abhilfe: M erhöhen (FM_DDR_AUTO_M / FM_DDR_SUBCHUNK)"
              echo "  oder die Record-Schwelle anheben (FM_DDR_MIN_RECORDS)."
              echo "  Bewusst gewollt? Deckel anheben: FM_MAX_TOTAL_CHUNKS=$((_tot_chunks + 1))  (oder 0 = aus)."
            } | log_error_section "Phase S chunk-count guard ($_tot_chunks > $_max_chunks)"
            echo "  ✗ Phase S abgebrochen: zu viele Chunks ($_tot_chunks > $_max_chunks). Details im Error-Log." >&2
            TURBO_RC=9; return 9
        fi
        if $QUIET_MODE; then emit_log "Phase S: $_tot_chunks Chunk(s) geplant (Deckel $_max_chunks)"
        else echo "  Phase S: $_tot_chunks Chunk(s) geplant (Deckel $_max_chunks)"; fi
    fi

    # ---- Phase D (worker pool over all chunks) ----
    _t3 D_start
    _turbo_dispatch
    _t3 C1_start

    local rc USE_CATMERGE=false
    # The catalog-granular merge is DEFAULT (collapses C1+C2: faster + identity-preserving).
    # Opt-out: FM_TURBO_NO_CATMERGE=1 → part path (merge_part_dbs, optionally with
    # FM_TURBO_PARQUET). Auto-fallback to the part path when the chunkmap contains a catalog
    # without an owner map (e.g. FM_SUBCHUNK_RECMAP override / splitter mode=fine) OR
    # multiple XML share the same internal File_Name (collision → catmerge PK violation).
    if [ -z "${FM_TURBO_NO_CATMERGE:-}" ] && _turbo_catmerge_ok; then
        USE_CATMERGE=true
    elif [ -z "${FM_TURBO_NO_CATMERGE:-}" ]; then
        if $QUIET_MODE; then emit_log "Hinweis: katalog-granularer Merge nicht anwendbar (unbekannter Katalog ODER File_Name-Kollision) → Part-Pfad"
        else echo "  Hinweis: katalog-granularer Merge nicht anwendbar (unbekannter Katalog ODER File_Name-Kollision) → Part-Pfad"; fi
    fi
    if $USE_CATMERGE; then
        # ---- Phase C CATALOG-GRANULAR (collapses stages 1+2): no part DBs ----
        # rc per file from chunk validity (replaces the build_part rc setting); _turbo_merge_catalog
        # reads the chunks directly. Skipped files (manifest) stay rc 0 with no merge contribution.
        for i in "${!XML_FILES[@]}"; do
            if [ -f "$PARTDB_DIR/${i}.unchanged" ]; then echo 0 > "$PARTDB_DIR/${i}.rc"; continue; fi
            rc=${FILE_SPLIT_RC[$i]:-3}
            [ "$rc" -eq 0 ] && { _turbo_file_chunks_ok "$i" || rc=3; }
            echo "$rc" > "$PARTDB_DIR/${i}.rc"
        done
        _t3 C2_start
        if $QUIET_MODE; then phase_progress import 100 "Phase C: Chunks → Master (katalog-granular)…"
        else echo "  Phase C: Chunks → Master mergen (katalog-granular, DELETE-by-File + Wildcard-INSERT)…"; fi
        _turbo_merge_catalog
        _t3 C2_end
        TURBO_RC=${MERGE_RC:-0}
    else
        # ---- Phase C, stage 1: per file chunk DBs → part_<idx>.duckdb + rc sidecar ----
        # Skipped files build NO part_<idx> → merge_part_dbs leaves their master rows
        # untouched (rc 0, no part). Changed files: DELETE-by-File + INSERT.
        for i in "${!XML_FILES[@]}"; do
            rc=${FILE_SPLIT_RC[$i]:-3}
            if [ "$rc" -eq 0 ] && [ ! -f "$PARTDB_DIR/${i}.unchanged" ]; then
                _turbo_build_part "$i"; rc=$?
            fi
            echo "$rc" > "$PARTDB_DIR/${i}.rc"
        done

        # ---- Phase C, stage 2: parts → master (proven merge_part_dbs) ----
        _t3 C2_start
        if $QUIET_MODE; then phase_progress import 100 "Phase C: Parts → Master mergen…"
        else echo "  Phase C: Parts in den Master mergen… $([ -n "${FM_TURBO_PARQUET:-}" ] && echo '(Parquet-Wildcard)')"; fi
        if [ -n "${FM_TURBO_PARQUET:-}" ]; then _turbo_merge_parquet; else merge_part_dbs; fi
        _t3 C2_end
        TURBO_RC=${MERGE_RC:-0}
    fi

    # ---- Update the manifest (ALWAYS) — only on a successful consolidation ----
    [ "${TURBO_RC:-0}" -eq 0 ] && _turbo_write_manifest
}

# ============================================================================
# Stage 1 — Pre-Processor
# ============================================================================

# detect_encoding <file> — echoes one of: utf-16le | utf-16be | utf-8-bom | utf-8
#
# BOM sniffing as the primary detection: POSIX-compliant and platform-independent.
# FileMaker exports SaXML consistently as UTF-16-LE *with* a BOM (FF FE). The formerly
# used BSD-specific `file -I` (uppercase) failed on GNU/Linux and let UTF-16 files
# pass through unconverted (empty DB). `file -i` (lowercase) remains only a fallback
# if no BOM is found.
detect_encoding() {
    local f="$1"
    local b3
    b3=$(od -An -tx1 -N3 "$f" 2>/dev/null | tr -d ' \n')
    case "$b3" in
        fffe*)  echo "utf-16le"; return 0 ;;
        feff*)  echo "utf-16be"; return 0 ;;
        efbbbf) echo "utf-8-bom"; return 0 ;;
    esac
    # Fallback: file -i (lowercase — valid on macOS AND Linux). GNU file often
    # classifies UTF-16 as 'binary' because of the null bytes; then the utf-8 default
    # below kicks in, which is correct for BOM-less UTF-8 sources.
    local charset
    charset=$(file -i "$f" 2>/dev/null | grep -o 'charset=[^ ;]*' | cut -d= -f2)
    case "$charset" in
        utf-16le) echo "utf-16le" ;;
        utf-16be) echo "utf-16be" ;;
        *)        echo "utf-8" ;;
    esac
}

# preprocess_file <src_path> <out_path>
#
# Pipeline of interchangeable sub-steps (order = pipeline):
#   (a)  Encoding → UTF-8                    — BOM sniffing primary, file -i fallback
#   (d)  BOM stripping (UTF-8 EF BB BF)      — after (a), also covers the iconv residual byte
#   (c2) DEL guard: strip literal 0x7F       — BEFORE (b), prevents a sentinel collision
#                                              with CR→DEL / chr(127)→chr(10) in convert_xml_01_extract.sql
#   (b)  Linebreak sentinel CR (0x0D) → DEL (0x7F)
#   (c)  Strip XML-1.0-invalid C0 bytes (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F; covers U+001C)
#   (e)  TODO: entity normalization (&#13; etc.) — only if confirmed to be a problem
#   (f)  --split: chunk Phase 1 (implemented in the script via tools/katana-xml/split_fm_xml.awk)
#   (h)  Known low-prio gap: U+FFFE/U+FFFF (Unicode non-characters, multibyte) — documented
#
# tr is byte-oriented, but UTF-8-safe here: UTF-8 continuation bytes always lie in the
# range 0x80-0xBF, never 0x0D or any other C0 byte. TAB/LF are preserved.
#
# Returns: 0 ok | 2 encoding error (iconv) | 5 cleanup error (tr)
# Sets global report variables: PRE_ENCODING, PRE_CR_COUNT, PRE_DEL_GUARD_COUNT, PRE_STRIPPED
preprocess_file() {
    local SRC="$1"
    local OUT="$2"
    local TMP_UTF8="${OUT}.utf8.$$"

    # (a) Encoding → UTF-8
    PRE_ENCODING=$(detect_encoding "$SRC")
    case "$PRE_ENCODING" in
        utf-16le)
            iconv -f UTF-16LE -t UTF-8 "$SRC" > "$TMP_UTF8" || { rm -f "$TMP_UTF8"; return 2; } ;;
        utf-16be)
            iconv -f UTF-16BE -t UTF-8 "$SRC" > "$TMP_UTF8" || { rm -f "$TMP_UTF8"; return 2; } ;;
        *)
            # utf-8 / utf-8-bom: copy unchanged; the BOM strip is handled by (d)
            cp "$SRC" "$TMP_UTF8" || { rm -f "$TMP_UTF8"; return 2; } ;;
    esac

    # (d) BOM stripping: remove the UTF-8 BOM. Occurs for utf-8-bom sources AND
    # after `iconv -f UTF-16LE` (the leading FF-FE BOM becomes U+FEFF = EF BB BF there).
    if [ "$(od -An -tx1 -N3 "$TMP_UTF8" 2>/dev/null | tr -d ' \n')" = "efbbbf" ]; then
        tail -c +4 "$TMP_UTF8" > "${TMP_UTF8}.nobom" && mv -f "${TMP_UTF8}.nobom" "$TMP_UTF8"
    fi

    # Report counters before the byte cleanup
    local in_size
    in_size=$(wc -c < "$TMP_UTF8" | tr -d ' ')
    PRE_CR_COUNT=$(tr -dc '\r' < "$TMP_UTF8" | wc -c | tr -d ' ')
    PRE_DEL_GUARD_COUNT=$(tr -dc '\177' < "$TMP_UTF8" | wc -c | tr -d ' ')

    # (c2) DEL guard → (b) CR→DEL → (c) strip C0-invalid
    if ! tr -d '\177' < "$TMP_UTF8" \
            | tr '\r' '\177' \
            | tr -d '\000-\010\013\014\016-\037' > "$OUT"; then
        rm -f "$TMP_UTF8"
        return 5
    fi

    local out_size
    out_size=$(wc -c < "$OUT" | tr -d ' ')
    PRE_STRIPPED=$((in_size - out_size))
    rm -f "$TMP_UTF8"
    return 0
}

# ============================================================================
# Function: Process a single XML file
# Arguments: $1 = filename (just the basename, not full path)
# Returns: 0 on success, non-zero on error
# ============================================================================
process_single_file() {
    local FILENAME="$1"

    # 1. Validate XML file exists
    if [ ! -f "$XML_DIR/$FILENAME" ]; then
        echo "ERROR: File not found: $FILENAME"
        return 1
    fi

    # 2. Create temporary working directory
    local TEMP_DIR=$(mktemp -d)
    trap "rm -rf '$TEMP_DIR'" RETURN  # Ensure cleanup on return

    # 3. Pre-Processor (stage 1): encoding→UTF-8 (BOM sniffing) + special-char
    #    cleanup in one step. Produces the cleaned UTF-8 file directly.
    local BASENAME="${FILENAME%.xml}"
    local XML_FILE="${BASENAME}_clean.xml"
    local PRE_OUTPUT="$TEMP_DIR/$XML_FILE"

    preprocess_file "$XML_DIR/$FILENAME" "$PRE_OUTPUT"
    local PRE_RC=$?
    if [ $PRE_RC -eq 2 ]; then
        echo "  ERROR: UTF-8 conversion failed"
        return 2
    elif [ $PRE_RC -ne 0 ]; then
        echo "  ERROR: XML preprocessing failed"
        return 5
    fi
    echo "  Preprocessed (enc=$PRE_ENCODING): replaced_cr=$PRE_CR_COUNT del_guard=$PRE_DEL_GUARD_COUNT stripped_invalid=$PRE_STRIPPED"

    # 3b. --streamify: branch-aware element renaming on the cleaned file
    #     (TAB-indented, one element/line — exactly what the renamer expects).
    #     Makes the heavyweight anchors unique (LayoutCatalog>Layout→LC_Layout, …),
    #     so the streamify SQL can stream them via read_xml(record_element=…).
    #     Surgical: only the anchor tags change; all other bytes stay the same.
    if $STREAMIFY_MODE; then
        local RENAMED="$TEMP_DIR/${BASENAME}_streamify.xml"
        if awk -v rules="$STREAMIFY_RULES" -f "$STREAMIFY_RENAMER" < "$PRE_OUTPUT" > "$RENAMED" 2>"$TEMP_DIR/streamify_err.log"; then
            mv "$RENAMED" "$PRE_OUTPUT"
            echo "  Streamify-Renaming angewandt (rules: $STREAMIFY_RULES)"
        else
            echo "  ERROR: Streamify-Renaming fehlgeschlagen"
            sed 's/^/    /' "$TEMP_DIR/streamify_err.log" 2>/dev/null
            return 5
        fi
    fi

    # 4. Validate XML root element — only FMSaveAsXML (SaXML v2.1.0.0+) is supported.
    #    Runs on the cleaned UTF-8 file; the byte cleanup leaves the ASCII pattern
    #    <FMSaveAsXML untouched.
    local ROOT_ELEMENT=$(head -c 4096 "$PRE_OUTPUT" | grep -oE '<(FMSaveAsXML|FMDynamicTemplate)[ >]' | head -1 | sed 's/[< >]//g')

    if [[ "$ROOT_ELEMENT" == "FMDynamicTemplate" ]]; then
        echo "  WARNING: Skipped — legacy SaXML v2.0.0.0 format (FMDynamicTemplate)"
        echo "  This format (FileMaker 18.x) is not supported. Minimum: SaXML v2.1.0.0 (FileMaker 19+)."
        return 4
    fi

    if [[ -z "$ROOT_ELEMENT" ]]; then
        echo "  WARNING: Skipped — could not detect XML root element (expected FMSaveAsXML)"
        return 4
    fi

    # 5. Run Phase 1 (extraction) — optionally split (--split).
    # Phase 2 (resolution) no longer runs per file: it is table-only and is called
    # exactly once after all P1 imports (run_phase2_resolve), analogous to the
    # universal catalogs.
    #   fm_xml/schema_version/schema_hash are injected by run_p1_on via sed.
    local ERROR_LOG="$TEMP_DIR/error.log"
    : > "$ERROR_LOG"
    local RESULT=0

    if $SPLIT_MODE; then
        # Split the XML into chunks (StepsForScripts + DDR_INFO separated out, the rest
        # = main). Each chunk runs as a standalone P1 run; the base catalogs are
        # chunk-safe (UPSERT or branch-guarded PrivilegeSet DELETE).
        echo "  Splitting XML into chunks (--split)..."
        local CHUNK_DIR="$TEMP_DIR/chunks"
        mkdir -p "$CHUNK_DIR"
        local NCHUNKS
        # subchunk>0 additionally cuts the safe heavy branches (SUBCHUNK_RECMAP) into
        # N-record pieces. 0 = unchanged --split behavior.
        # In --streamify mode the splitter runs AFTER the renamer, so it sees the
        # renamed record anchors (LayoutCatalog>Layout→LC_Layout, Script→SFS_Script,
        # see STREAMIFY_RULES). The recmap passed to the splitter must therefore match
        # the renamed record element name — otherwise the branch is separated but the
        # sub-chunk rotation never fires. (The BRANCH tag stays un-renamed → the offset
        # loop below keeps using the original SUBCHUNK_RECMAP.)
        local EFFECTIVE_RECMAP="$SUBCHUNK_RECMAP"
        if $STREAMIFY_MODE && [ -n "$STREAMIFY_RULES" ] && [ "${SUBCHUNK:-0}" -gt 0 ]; then
            local _erm="" _e _br _rec _new
            for _e in $SUBCHUNK_RECMAP; do
                _br="${_e%%:*}"; _rec="${_e##*:}"
                _new=$(printf '%s' "$STREAMIFY_RULES" | tr ',' '\n' \
                       | awk -F: -v b="$_br" -v r="$_rec" '$1==b && $2==r {print $3; exit}')
                [ -n "$_new" ] && _rec="$_new"
                _erm="$_erm${_erm:+ }$_br:$_rec"
            done
            EFFECTIVE_RECMAP="$_erm"
            echo "  Sub-Chunk recmap (streamify-aware): $EFFECTIVE_RECMAP"
        fi
        # DDR-2-level sub-chunk entries (`*` anchor, no rename): per-file M (capped).
        local _ddr_rm; _ddr_rm=$(_ddr_recmap_for_file "$PRE_OUTPUT")
        if [ -n "$_ddr_rm" ]; then
            EFFECTIVE_RECMAP="$EFFECTIVE_RECMAP $_ddr_rm"
            echo "  DDR-Subchunk: ${_ddr_rm%% *}"
        fi
        # Turbo (Phase S): the splitter additionally writes a chunkmap sidecar
        # (catalog/split_number/record_count/sub_m/chunk_file). On the classic path the
        # variable stays empty → no sidecar output, the splitter behaves unchanged.
        local CHUNKMAP_TSV=""
        $TURBO_MODE && CHUNKMAP_TSV="$CHUNK_DIR/chunkmap.tsv"
        NCHUNKS=$(awk -v outdir="$CHUNK_DIR" -v subchunk="$SUBCHUNK" -v recmap="$EFFECTIVE_RECMAP" \
                      -v nest="$NEST_MAP" \
                      -v chunkmap="$CHUNKMAP_TSV" \
                      -f "$SPLITTER_AWK" < "$PRE_OUTPUT" 2>>"$ERROR_LOG")
        if [ -z "$NCHUNKS" ] || [ ! -f "$CHUNK_DIR/chunk_000_main.xml" ]; then
            echo "  ERROR: XML split failed"
            sed 's/^/    /' "$ERROR_LOG"
            cat "$ERROR_LOG"
            return 3
        fi
        echo "  Converting $NCHUNKS chunk(s) to DuckDB..."
        # chunk_000_main first (glob order), then the branch chunks.
        # Sub-chunks of a Sequence_ID catalog (LayoutCatalog) appear consecutively in
        # glob order (= XML order). The global record offset of a sub-chunk = (its
        # occurrence index for this branch) × SUBCHUNK. With that, ROW_NUMBER()+seq_offset
        # yields the global XML order. Branches without a Sequence_ID (StepsForScripts)
        # also get an offset — inconsequential there (no Sequence_ID read in the chunk).
        # Offset 0 ⇒ unsplit/coarse byte-identical.
        if $TURBO_MODE; then
            # Phase S (load): take this file's chunkmap from the sidecar into the run
            # chunkmap. seq_offset = split_number×sub_m is computed by the DB (replaces the
            # inline _seqocc loop); content_hash stays NULL until a later step,
            # est_bytes until the dispatch-weight step. chunk_id globally continuous.
            local _fn="${BASENAME//\'/\'\'}"
            local _pol; _pol=$($STREAMIFY_MODE && echo sax || echo dom)
            if ! "$DUCKDB_BIN" "$CHUNKMAP_DB" -c "
                INSERT INTO chunkmap
                SELECT
                    (SELECT COALESCE(MAX(chunk_id),0) FROM chunkmap) + ROW_NUMBER() OVER () AS chunk_id,
                    '$_fn' AS file_name,
                    catalog,
                    '$_fn' || '::' || catalog AS split_group,
                    split_number,
                    '$CHUNK_DIR' || '/' || chunk_file AS chunk_path,
                    record_count,
                    CAST(split_number AS BIGINT) * CAST(sub_m AS BIGINT) AS seq_offset,
                    NULL AS content_hash,
                    '$_pol' AS parser_policy,
                    NULL AS est_bytes,
                    'pending' AS status,
                    1 AS attempt
                FROM read_csv('$CHUNK_DIR/chunkmap.tsv', delim='\t', header=false,
                     columns={'catalog':'VARCHAR','split_number':'INTEGER','record_count':'INTEGER','sub_m':'INTEGER','chunk_file':'VARCHAR'});
                " >>"$ERROR_LOG" 2>&1; then
                echo "  ERROR: Chunkmap-Load fehlgeschlagen"
                sed 's/^/    /' "$ERROR_LOG"; cat "$ERROR_LOG"
                return 3
            fi
            # Phase D: parse chunkmap-driven sequentially into the master. Order by
            # chunk_path (main=chunk_000 first, like the glob on the classic path);
            # seq_offset NOW comes from the chunkmap row. UPSERT makes the order
            # result-irrelevant, the master path is == classic.
            local _coff _cp
            while IFS=$'\t' read -r _coff _cp; do
                [ -z "$_cp" ] && continue
                P1_SEQ_OFFSET="$_coff" run_p1_on "$(dirname "$_cp")" "$(basename "$_cp")" "$ERROR_LOG" || RESULT=$?
            done < <("$DUCKDB_BIN" -readonly "$CHUNKMAP_DB" -noheader -list -c \
                "SELECT seq_offset::VARCHAR || chr(9) || chunk_path FROM chunkmap WHERE file_name='$_fn' ORDER BY chunk_path;")
        else
        local chunk base ctag off _j _cur _found
        # _seqocc: ctag → occurrence count. bash-3.2-safe as parallel indexed arrays
        # (ctags are identifiers, small N) with a linear lookup; no associative array.
        local -a _seqocc_k _seqocc_v
        for chunk in "$CHUNK_DIR"/chunk_*.xml; do
            base="$(basename "$chunk" .xml)"
            ctag="${base#chunk_[0-9][0-9][0-9]_}"   # branch tag after chunk_NNN_
            off=0
            if [ "${SUBCHUNK:-0}" -gt 0 ]; then
                case " $SUBCHUNK_RECMAP " in
                    *" ${ctag}:"*)
                        _cur=0; _found=-1
                        for _j in "${!_seqocc_k[@]}"; do
                            if [ "${_seqocc_k[$_j]}" = "$ctag" ]; then _cur="${_seqocc_v[$_j]}"; _found=$_j; break; fi
                        done
                        off=$(( _cur * SUBCHUNK ))
                        if [ "$_found" -ge 0 ]; then _seqocc_v[$_found]=$(( _cur + 1 ))
                        else _seqocc_k+=("$ctag"); _seqocc_v+=("1"); fi
                        ;;
                esac
            fi
            P1_SEQ_OFFSET="$off" run_p1_on "$CHUNK_DIR" "$(basename "$chunk")" "$ERROR_LOG" || RESULT=$?
        done
        fi
    else
        echo "  Converting XML to DuckDB..."
        run_p1_on "$TEMP_DIR" "$XML_FILE" "$ERROR_LOG" || RESULT=$?
    fi

    # Report result (cleanup happens automatically via trap)
    if [ $RESULT -eq 0 ]; then
        return 0
    else
        echo "  ERROR: DuckDB conversion failed (exit code: $RESULT)"
        echo "  Error details:"
        sed 's/^/    /' "$ERROR_LOG"
        cat "$ERROR_LOG"
        return 3
    fi
}

# ============================================================================
# Stage 3 — Post-Processor
# Pure DuckDB read queries against the finished DB, run AFTER the universal
# catalogs + resolutions and BEFORE the sync. Collects findings in POSTCHECK_FINDINGS[]
# (format: category|severity|message|fix-hint). No step hard-aborts here — the
# validity assessment happens centrally in finalize_run() (stage 4).
# ============================================================================
POSTCHECK_FINDINGS=()
POSTCHECK_WARN=0
CHECKS_RUN=0

# Single scalar read against the master DB (read-only). Empty output on a
# missing table/error → treated as 0 by the caller.
pp_query() {
    "$DUCKDB_BIN" -readonly "$DB_FILE" -noheader -csv -c "$1" 2>/dev/null | head -n1
}

# Like pp_query, but guaranteed to return a non-negative integer (else 0).
pp_num() {
    local v; v=$(pp_query "$1")
    if [[ "$v" =~ ^[0-9]+$ ]]; then echo "$v"; else echo 0; fi
}

# add_finding <kategorie> <schweregrad ok|warn|error> <nachricht> <fix-hint>
add_finding() {
    POSTCHECK_FINDINGS+=("$1|$2|$3|$4")
    case "$2" in
        warn)  POSTCHECK_WARN=$((POSTCHECK_WARN + 1)); emit_warn "[check:$1] $3 — $4" ;;
        error) emit_error "[check:$1] $3 — $4" ;;
        info)  emit_log "[check:$1] $3 — $4" ;;  # visible, non-fatal, NOT counted as warn
    esac
    if $QUIET_MODE; then
        _emit_json check category "$1" severity "$2" message "$3" hint "$4"
    fi
}

postprocess_db() {
    POSTCHECK_FINDINGS=()
    POSTCHECK_WARN=0
    CHECKS_RUN=0
    [ ! -f "$DB_FILE" ] && return 0

    # Phase 6: (re)create the check views — data logic in the SQL, assessment here.
    # CREATE OR REPLACE VIEW is idempotent; needs write access (master DB).
    # The views stay in the DB and are thus usable for REST-API/ad-hoc too.
    if [ -f "$VALIDATE_TEMPLATE" ]; then
        { memory_limit_prefix; cat "$VALIDATE_TEMPLATE"; } | "$DUCKDB_BIN" "$DB_FILE" >/dev/null 2>&1 \
            || emit_warn "Phase-6-Prüf-Views konnten nicht erstellt werden (Post-Checks evtl. unvollständig)"
    fi

    local files_n; files_n=$(pp_num "SELECT files_n FROM v_check_counts")

    # --- 4.1 Plausibility checks (counts) ---
    if [ "$files_n" -gt 0 ]; then
        CHECKS_RUN=$((CHECKS_RUN + 1))
        local bt; bt=$(pp_num "SELECT basetables_n FROM v_check_counts")
        if [ "$bt" -eq 0 ]; then
            add_finding plausibility warn "BaseTableCatalog leer trotz $files_n importierter Datei(en)" "Import unvollständig? convert_xml_01_extract.sql-Lauf prüfen"
        fi

        CHECKS_RUN=$((CHECKS_RUN + 1))
        local lay lobj
        lay=$(pp_num "SELECT layouts_n FROM v_check_counts")
        lobj=$(pp_num "SELECT layoutobjects_n FROM v_check_counts")
        if [ "$lay" -gt 0 ] && [ "$lobj" -eq 0 ]; then
            add_finding plausibility warn "$lay Layout(s), aber 0 LayoutObjects" "LayoutObject-Parser prüfen"
        fi

        CHECKS_RUN=$((CHECKS_RUN + 1))
        local scr steps
        scr=$(pp_num "SELECT scripts_n FROM v_check_counts")
        steps=$(pp_num "SELECT steps_n FROM v_check_counts")
        if [ "$scr" -gt 0 ] && [ "$steps" -eq 0 ]; then
            add_finding plausibility warn "$scr Script(s), aber 0 StepsForScripts" "Script-Step-Parser prüfen"
        fi
    fi

    # --- 4.2 Consistency checks ---
    # C1 — no empty/NULL Calc_UUID (primary regression guard).
    # By the slot-preserving regex '<(_[^\s>]+)' in convert_xml_01_extract.sql it is 0 by construction;
    # only catches future, unexpected ObjectList element forms.
    CHECKS_RUN=$((CHECKS_RUN + 1))
    local c1; c1=$(pp_num "SELECT bad_calc_uuid FROM v_check_calc_uuid")
    if [ "$c1" -gt 0 ]; then
        add_finding consistency warn "$c1 DDR_Calculations-Zeile(n) mit leerer/NULL Calc_UUID" "ObjectList-Element-Form prüfen (Calc_UUID-Slot-Regex in convert_xml_01_extract.sql)"
    fi

    # Orphan same-file link targets (true count, no cap): ObjectLinks targets
    # without an ObjectCatalog entry. Cross-file links are excluded (they resolve
    # cleanly). Severity is gated on corpus completeness: on an INCOMPLETE corpus
    # (referenced external files not imported) such orphans are EXPECTED — refs
    # point into files whose objects live in no catalog → report as info, not warn.
    # Only on a complete corpus (missing_ext_files=0) do orphans signal genuine
    # dangling references / an integrity problem.
    CHECKS_RUN=$((CHECKS_RUN + 1))
    local orphans missing_ext
    orphans=$(pp_num "SELECT orphan_n FROM v_check_orphan_links")
    missing_ext=$(pp_num "SELECT missing_ext_files FROM v_check_orphan_links")
    if [ "$orphans" -gt 0 ]; then
        if [ "$missing_ext" -gt 0 ]; then
            add_finding consistency info "$orphans verwaiste Referenz-Ziel(e) — erwartbar: $missing_ext referenzierte externe Datei(en) nicht importiert (Teil-Korpus)" "Für vollständige Auflösung alle referenzierten FileMaker-Dateien nach xml/ importieren"
        else
            add_finding consistency warn "$orphans verwaiste Same-File-Link-Ziel(e) fehlen in ObjectCatalog (Korpus vollständig)" "Echte tote Referenzen — referenzielle Integrität prüfen"
        fi
    fi

    # Schema consistency: DB SchemaInfo == template version (double-check of the detection)
    CHECKS_RUN=$((CHECKS_RUN + 1))
    local db_ver; db_ver=$(pp_query "SELECT db_version FROM v_check_schema")
    if [ -n "$db_ver" ] && [ -n "$SCHEMA_VERSION_EXPECTED" ] && [ "$db_ver" != "$SCHEMA_VERSION_EXPECTED" ]; then
        add_finding consistency warn "SchemaInfo-Version $db_ver ≠ Template-Version $SCHEMA_VERSION_EXPECTED" "Rebuild via --batch --force-rebuild"
    fi

    local ok_n=$((CHECKS_RUN - POSTCHECK_WARN))
    [ "$ok_n" -lt 0 ] && ok_n=0
    emit_log "Post-Checks: $ok_n ok, $POSTCHECK_WARN warn"
    return 0
}

# ============================================================================
# Stage 4 — Error handling
# ============================================================================

# classify_error <exit_rc> <error_text> — sets ERR_CATEGORY and ERR_RETRY_HINT
# based on DuckDB/iconv stderr patterns (primary) or the exit code (fallback).
classify_error() {
    local rc="$1"
    local txt="$2"
    ERR_CATEGORY=""
    ERR_RETRY_HINT=""
    # OOM: on a clean memory stop DuckDB reports its own stderr text. An OS OOM kill
    # (cgroup/kernel), by contrast, sends SIGKILL → DuckDB exit 137 (=128+9), WITHOUT
    # stderr. process_single_file wraps this as
    # "DuckDB conversion failed (exit code: 137)" in $txt; hence additionally check
    # for 137 here, otherwise an OOM kill would go undetected. 143 (=128+15, SIGTERM)
    # is the same OOM in disguise on some VMs (macOS/Docker-Desktop) → treat it as OOM too.
    if echo "$txt" | grep -qiE 'out of memory|failed to allocate|exceeds.*memory_limit|exit code: 13(7|3)'; then
        ERR_CATEGORY="oom"
        ERR_RETRY_HINT="OOM (exit 137=SIGKILL / 143=SIGTERM): mehr RAM/Spill (DUCKDB_TEMP_DIR) oder --split/--turbo --auto bzw. reduziertes --memory_limit"
    elif echo "$txt" | grep -qiE 'invalid input error.*invalid|invalid xml|not well-formed|parser error'; then
        ERR_CATEGORY="invalid_xml"
        ERR_RETRY_HINT="Pre-Processor/Quelle prüfen — evtl. ungültige Zeichen in der XML"
    # IMPORTANT: match only the REAL iconv message ("UTF-8 conversion failed") —
    # NOT the generic "DuckDB conversion failed", otherwise every DuckDB error
    # (incl. OOM) would be wrongly classified as encoding.
    elif echo "$txt" | grep -qiE 'iconv|UTF-8 conversion failed'; then
        ERR_CATEGORY="encoding"
        ERR_RETRY_HINT="Encoding der Quelle prüfen (BOM-Detection greift; binär-Detection deutet auf altes file -I)"
    else
        case "$rc" in
            2) ERR_CATEGORY="encoding";           ERR_RETRY_HINT="Encoding der Quelle prüfen" ;;
            4) ERR_CATEGORY="unsupported_format";  ERR_RETRY_HINT="Re-Export aus FileMaker 19+ als SaXML v2.1+" ;;
            5) ERR_CATEGORY="invalid_xml";         ERR_RETRY_HINT="Pre-Processor/Quelle prüfen" ;;
            6) ERR_CATEGORY="schema_drift";        ERR_RETRY_HINT="--batch --force-rebuild" ;;
            7) ERR_CATEGORY="lock";                ERR_RETRY_HINT="später erneut; ggf. stale Lock entfernen" ;;
            *) ERR_CATEGORY="sql_error";           ERR_RETRY_HINT="Error-Log prüfen, Stelle benennen" ;;
        esac
    fi
}

# finalize_run — closing assessment: prints collected warnings (post-checks),
# skipped files and — for failed files — the error category + a copyable retry
# command. Reads the global batch variables (FAILED_FILES_INFO, SKIPPED_FILES,
# POSTCHECK_FINDINGS). Pure reporting logic, no abort decision of its own.
finalize_run() {
    local self="bash tools/convert_fm_xml.sh"

    # Show collected warn findings from the post-checks
    if [ "${#POSTCHECK_FINDINGS[@]}" -gt 0 ]; then
        echo ""
        echo "Post-Checks (Stufe 3):"
        local f
        for f in "${POSTCHECK_FINDINGS[@]}"; do
            local cat="${f%%|*}"; local rest="${f#*|}"
            local sev="${rest%%|*}"; rest="${rest#*|}"
            local msg="${rest%%|*}"; local hint="${rest#*|}"
            echo "  [$sev/$cat] $msg"
            [ -n "$hint" ] && echo "      → $hint"
        done
    fi

    # Classify failed files + suggest a retry command
    if [ "${#FAILED_FILES_INFO[@]}" -gt 0 ]; then
        echo ""
        echo "Fehler-Klassifikation & Wiederholungs-Vorschläge:"
        local entry
        for entry in "${FAILED_FILES_INFO[@]}"; do
            local file="${entry%%|*}"; local rest="${entry#*|}"
            local cat="${rest%%|*}"; local hint="${rest#*|}"
            echo "  ✗ $file  [$cat]"
            echo "      → $hint"
            if [ "$cat" = "oom" ]; then
                echo "      Wiederholen: $self \"$file\" --memory_limit 4GB"
            elif [ "$cat" = "schema_drift" ]; then
                echo "      Wiederholen: $self --batch --force-rebuild"
            fi
            if $QUIET_MODE; then
                _emit_json retry filename "$file" category "$cat" hint "$hint"
            fi
        done
    fi
}

# ============================================================================
# Conversion log v2
# Phase timeline, object counts, environment context, JSON sidecar.
# Data-driven from parallel arrays (Bash 3 safe) → text log + JSON are written
# exactly ONCE at the end of the run (write_text_log / write_json_sidecar).
# ============================================================================

# --- Phasen-Sammlung (parallele Arrays) ---
PH_ID=();    PH_NAME=();     PH_START_ISO=(); PH_END_ISO=()
PH_DUR=();   PH_PROD_TXT=(); PH_PROD_JSON=()
_PH_CUR_ID=""; _PH_CUR_NAME=""; _PH_CUR_START_EPOCH=""; _PH_CUR_START_ISO=""

# --- Per-file collection (P1 per file) ---
FL_NAME=(); FL_SIZE=(); FL_ENC=(); FL_STATUS=()
FL_DUR=();  FL_COMPLETED=(); FL_ERR_CAT=(); FL_ERR_RC=(); FL_ERR_HINT=()
FL_PEAKRSS=(); FL_MINAVAIL=()   # memory forensics (KB; empty = not sampled/non-Linux)

# --- Per-file object counts (filled after P1) ---
FO_NAME=(); FO_COUNT=()

# Guard against double writes (multiple exit paths, e.g. fail-fast).
LOGS_FINALIZED=false

iso_now() { date '+%Y-%m-%dT%H:%M:%S'; }

# phase_begin <id> <name> — records the start time of the current phase.
# In quiet/web mode it also emits a live `phase` marker (state=begin) so the
# streamed/frontend log shows a clean per-phase trace for all 6 SQL phases P1–P6.
# In the CLI the section banners + the end-of-run phase table already cover this.
phase_begin() {
    _PH_CUR_ID="$1"; _PH_CUR_NAME="$2"
    _PH_CUR_START_EPOCH=$(date +%s.%N)
    _PH_CUR_START_ISO=$(iso_now)
    $QUIET_MODE && _emit_json phase id "$1" name "$2" state "begin"
}

# phase_finish <produced_text> <produced_json> — closes the current phase.
# Quiet/web: emits a live `phase` marker (state=done) carrying the duration and
# the produced summary (e.g. "12.345 Referenzen") — the per-phase result line.
phase_finish() {
    local end_epoch end_iso dur
    end_epoch=$(date +%s.%N); end_iso=$(iso_now)
    dur=$(awk -v a="$end_epoch" -v b="$_PH_CUR_START_EPOCH" 'BEGIN{printf "%.3f", a-b}')
    PH_ID+=("$_PH_CUR_ID");               PH_NAME+=("$_PH_CUR_NAME")
    PH_START_ISO+=("$_PH_CUR_START_ISO"); PH_END_ISO+=("$end_iso")
    PH_DUR+=("$dur");                     PH_PROD_TXT+=("$1")
    PH_PROD_JSON+=("$2")
    $QUIET_MODE && _emit_json phase id "$_PH_CUR_ID" name "$_PH_CUR_NAME" state "done" \
        duration "$(dur_human "$dur")" produced "$1"
}

# group_de <int> → deutsche Tausender-Punkte (903141 → 903.141).
group_de() {
    awk -v n="$1" 'BEGIN{
        s=sprintf("%d", n+0); out=""; c=0
        for(i=length(s); i>=1; i--){ out=substr(s,i,1) out; c++; if(c%3==0 && i>1) out="." out }
        print out
    }'
}

# dur_human <seconds> → "54m 34.5s" bzw. "11.8s".
dur_human() {
    awk -v d="$1" 'BEGIN{
        if(d+0>=60){ m=int(d/60); s=d-m*60; printf "%dm %.1fs", m, s }
        else printf "%.1fs", d+0
    }'
}

# fmt_gib <bytes> → "14.0 GiB" | "n/a".
fmt_gib() {
    awk -v b="$1" 'BEGIN{ if(b+0<=0) print "n/a"; else printf "%.1f GiB", b/1073741824 }'
}

# phase_label_txt <id> <name> — decorative column label for the timeline.
phase_label_txt() {
    case "$1" in
        P1) echo "Extract  (XML → Tabellen)" ;;
        P2) echo "Resolve  Referenzen" ;;
        P3) echo "Details  (Variablen)" ;;
        P4) echo "Catalog  (Objekte+Links)" ;;
        P5) echo "Homes    (Cross-File)" ;;
        P6) echo "Validate (Post-Checks)" ;;
        *)  echo "$2" ;;
    esac
}

# ----------------------------------------------------------------------------
# Object counts — read-only COUNT(*) against the master DB after the phases finish.
# ----------------------------------------------------------------------------

# Fixed set of tables for objects_extracted. Excluded are pure
# metadata/helper tables (FilesCatalog, SchemaInfo, XMLMetadata, PasteIndexList);
# DDR_Calculations is counted separately as ddr_calc_chunks.
P1_OBJECT_TABLES=(
    BaseTableCatalog TableOccurrenceCatalog RelationshipCatalog FieldsForTables
    ScriptCatalog StepsForScripts Layouts LayoutObjects LayoutParts
    ValueListCatalog OptionsForValueLists CustomFunctionsCatalog CalcsForCustomFunctions
    AccountsCatalog PrivilegeSetsCatalog PrivilegeSetRecordAccess PrivilegeSetFieldAccess
    PrivilegeSetObjectAccess ThemeCatalog CustomMenuCatalog ExtendedPrivilegesCatalog
    ScriptTriggers ExternalDataSourceCatalog BaseDirectoryCatalog DDR_ScriptSteps
)

# Like pp_query, but quoting-free (-list instead of -csv): needed when the returned
# value itself contains commas (e.g. dynamically built SQL expressions), which the CSV
# writer would otherwise wrap in quotes and thereby break the follow-up query.
pp_query_raw() {
    "$DUCKDB_BIN" -readonly "$DB_FILE" -noheader -list -c "$1" 2>/dev/null | head -n1
}

# _sql_inlist <names...> → "'a','b',...".
_sql_inlist() {
    local t out=""
    for t in "$@"; do
        if [ -z "$out" ]; then out="'$t'"; else out="$out,'$t'"; fi
    done
    printf '%s' "$out"
}

# count_table_sum <names...> → Σ rows over all EXISTING tables in the list
# (robust against missing tables: the sum expression is built dynamically over only
# the present tables, missing ones do not count and do not abort).
count_table_sum() {
    local inlist sumexpr
    inlist=$(_sql_inlist "$@")
    sumexpr=$(pp_query_raw "SELECT string_agg('(SELECT COUNT(*) FROM '||table_name||')','+') FROM information_schema.tables WHERE table_name IN ($inlist)")
    [ -z "$sumexpr" ] && { echo 0; return; }
    pp_num "SELECT $sumexpr"
}

# load_per_file_objects — a grouped query over all existing P1 object tables →
# FO_NAME[]/FO_COUNT[]. The key is the ORIGINAL XML filename (incl. .xml),
# reconstructed from FilesCatalog.XML_Path (which holds the `<base>_clean.xml`
# name). So the lookup matches directly on the loop's XML basename — robust even
# where the internal File_Name differs from the XML filename (e.g. test data); in
# production they are equal anyway.
load_per_file_objects() {
    FO_NAME=(); FO_COUNT=()
    local inlist unionexpr
    inlist=$(_sql_inlist "${P1_OBJECT_TABLES[@]}")
    unionexpr=$(pp_query_raw "SELECT string_agg('SELECT File_Name AS fn, COUNT(*) AS c FROM '||table_name||' GROUP BY File_Name', ' UNION ALL ') FROM information_schema.tables WHERE table_name IN ($inlist)")
    [ -z "$unionexpr" ] && return 0
    local cnt fn
    while IFS=$'\t' read -r cnt fn; do
        [ -z "$fn" ] && continue
        FO_NAME+=("$fn"); FO_COUNT+=("$cnt")
    done < <("$DUCKDB_BIN" -readonly "$DB_FILE" -noheader -list -c \
        "WITH per_file AS ($unionexpr),
              mapped AS (
                SELECT p.c AS c,
                       COALESCE(regexp_replace(regexp_replace(f.XML_Path, '^.*/', ''), '_clean\.xml\$', '.xml'), p.fn || '.xml') AS xml_name
                FROM per_file p
                LEFT JOIN FilesCatalog f ON f.File_Name = p.fn
              )
         SELECT SUM(c)::BIGINT || chr(9) || xml_name FROM mapped GROUP BY xml_name" 2>/dev/null)
}

# lookup_file_objects <XML file name incl. .xml> → object count or empty (unknown).
lookup_file_objects() {
    local i
    for i in "${!FO_NAME[@]}"; do
        if [ "${FO_NAME[$i]}" = "$1" ]; then echo "${FO_COUNT[$i]}"; return; fi
    done
    echo ""
}

# ----------------------------------------------------------------------------
# Environment context — robust detection with fallbacks, never hard-aborts.
# Fills the ENV_* globals; collect_duckdb_settings adds the effective settings
# (with the memory_limit_prefix active — otherwise wrong defaults would be logged).
# ----------------------------------------------------------------------------
collect_environment() {
    ENV_OS_PRETTY=$(grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"')
    [ -z "$ENV_OS_PRETTY" ] && ENV_OS_PRETTY="unknown"
    ENV_KERNEL=$(uname -r 2>/dev/null || echo "unknown")
    ENV_ARCH=$(uname -m 2>/dev/null || echo "unknown")

    if [ -n "$CODESPACES" ]; then
        ENV_CONTAINER_MODE="codespaces"
    elif [ -f /.dockerenv ] && [ "$REMOTE_CONTAINERS" = "true" ]; then
        ENV_CONTAINER_MODE="devcontainer"
    elif [ -f /.dockerenv ]; then
        ENV_CONTAINER_MODE="container"
    else
        ENV_CONTAINER_MODE="host"
    fi

    ENV_CPU_CORES=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 0)

    # RAM limit: cgroup v2 → v1 → /proc/meminfo (bytes). 'max' (no limit) → fallback.
    ENV_RAM_BYTES=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)
    if [[ ! "$ENV_RAM_BYTES" =~ ^[0-9]+$ ]]; then
        ENV_RAM_BYTES=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
    fi
    if [[ ! "$ENV_RAM_BYTES" =~ ^[0-9]+$ ]]; then
        local memkb
        memkb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)
        if [[ "$memkb" =~ ^[0-9]+$ ]]; then ENV_RAM_BYTES=$((memkb * 1024)); else ENV_RAM_BYTES=0; fi
    fi
    ENV_SWAP_BYTES=$(cat /sys/fs/cgroup/memory.swap.max 2>/dev/null)
    [[ "$ENV_SWAP_BYTES" =~ ^[0-9]+$ ]] || ENV_SWAP_BYTES=0

    local dv
    dv=$("$DUCKDB_BIN" --version 2>/dev/null)
    ENV_DUCKDB_VERSION=$(echo "$dv" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | tr -d 'v')
    [ -z "$ENV_DUCKDB_VERSION" ] && ENV_DUCKDB_VERSION="unknown"
    ENV_DUCKDB_BUILD=$(echo "$dv" | grep -oE '[0-9a-f]{8,}$' | head -1)
    # Display without the build hash, e.g. "v1.5.3 (Variegata)".
    ENV_DUCKDB_DISPLAY=$(echo "$dv" | sed -E 's/[[:space:]]+[0-9a-f]{8,}$//')
    [ -z "$ENV_DUCKDB_DISPLAY" ] && ENV_DUCKDB_DISPLAY="unknown"
}

# Determine the effective DuckDB settings WITH memory_limit_prefix active.
collect_duckdb_settings() {
    local row
    row=$( { memory_limit_prefix
             echo "SELECT current_setting('threads')||chr(9)||current_setting('memory_limit')||chr(9)||current_setting('temp_directory')||chr(9)||current_setting('max_temp_directory_size')||chr(9)||current_setting('preserve_insertion_order');"
           } | "$DUCKDB_BIN" -noheader -list 2>/dev/null | head -1 )
    IFS=$'\t' read -r ENV_DUCKDB_THREADS ENV_DUCKDB_MEM ENV_SPILL_DIR ENV_SPILL_MAX ENV_PRESERVE_ORDER <<< "$row"
    [ -z "$ENV_DUCKDB_THREADS" ] && ENV_DUCKDB_THREADS="n/a"
    [ -z "$ENV_DUCKDB_MEM" ]     && ENV_DUCKDB_MEM="n/a"
    [ -z "$ENV_SPILL_DIR" ]      && ENV_SPILL_DIR="n/a"
    [ -z "$ENV_SPILL_MAX" ]      && ENV_SPILL_MAX="n/a"
    [ -z "$ENV_PRESERVE_ORDER" ] && ENV_PRESERVE_ORDER="n/a"

    # Is the spill dir its own mount? (mountpoint preferred, /proc/mounts as fallback).
    ENV_SPILL_DEDICATED=false
    if [ -n "$ENV_SPILL_DIR" ] && [ "$ENV_SPILL_DIR" != "n/a" ] && [ "$ENV_SPILL_DIR" != ".tmp" ]; then
        if command -v mountpoint >/dev/null 2>&1 && mountpoint -q "$ENV_SPILL_DIR" 2>/dev/null; then
            ENV_SPILL_DEDICATED=true
        elif grep -q " $ENV_SPILL_DIR " /proc/mounts 2>/dev/null; then
            ENV_SPILL_DEDICATED=true
        fi
    fi
    if $ENV_SPILL_DEDICATED; then ENV_SPILL_DEDICATED_TXT="dediziertes Volume"; else ENV_SPILL_DEDICATED_TXT="shared"; fi
}

# build_run_meta — derived display strings (Options/Attempt/Mode) for the header.
build_run_meta() {
    if $TEST_MODE;          then RUN_MODE="test";   RUN_MODE_TITLE="TEST Batch"
    elif [[ "$MODE" == "single" ]]; then RUN_MODE="single"; RUN_MODE_TITLE="Single File"
    else                         RUN_MODE="batch";  RUN_MODE_TITLE="Batch"; fi

    local parts=()
    $FORCE_REBUILD && parts+=("force-rebuild")
    $SPLIT_MODE    && parts+=("split")
    parts+=("memory-limit=${MEMORY_LIMIT:-default}")
    if $FAIL_FAST;    then parts+=("fail-fast=on");    else parts+=("fail-fast=off");    fi
    if $NO_AUTO_HEAL; then parts+=("no-auto-heal=on"); else parts+=("no-auto-heal=off"); fi
    OPTIONS_TEXT=$(printf '%s · ' "${parts[@]}"); OPTIONS_TEXT="${OPTIONS_TEXT% · }"

    if [ "$ATTEMPT" -le 1 ] && [ -z "$RETRY_REASON" ] && [ -z "$RETRY_OF" ]; then
        ATTEMPT_TEXT="1 (first run)"
    else
        ATTEMPT_TEXT="$ATTEMPT"
        if [ -n "$RETRY_REASON" ]; then
            if $RETRY_REASON_KNOWN; then
                ATTEMPT_TEXT="$ATTEMPT_TEXT · retry-reason: $RETRY_REASON"
            else
                ATTEMPT_TEXT="$ATTEMPT_TEXT · retry-reason: $RETRY_REASON (custom)"
            fi
        fi
        [ -n "$RETRY_OF" ] && ATTEMPT_TEXT="$ATTEMPT_TEXT · retry-of: $RETRY_OF"
    fi
}

# ----------------------------------------------------------------------------
# Writer — text log + JSON sidecar (at the end of the run, idempotent).
# ----------------------------------------------------------------------------

write_text_log() {
    local logfile="$1"
    local phases_sum=0 i
    for i in "${!PH_DUR[@]}"; do
        phases_sum=$(awk -v a="$phases_sum" -v b="${PH_DUR[$i]}" 'BEGIN{printf "%.3f", a+b}')
    done

    {
        printf '================================================================================\n'
        printf 'FileMaker XML %s Import Log\n' "$RUN_MODE_TITLE"
        printf '================================================================================\n'
        printf 'Start Time:        %s\n' "$RUN_STARTED_HUMAN"
        printf 'End Time:          %s\n' "$RUN_ENDED_HUMAN"
        printf 'Converter Version: %s\n' "$CONVERTER_VERSION"
        printf 'Log Schema:        %s\n' "$LOG_SCHEMA"
        printf 'Schema Version:    %s  (Template)\n' "$SCHEMA_VERSION_EXPECTED"
        printf 'Mode:              %s\n' "$RUN_MODE"
        printf 'Options:           %s\n' "$OPTIONS_TEXT"
        printf 'Attempt:           %s\n' "$ATTEMPT_TEXT"
        printf -- '--------------------------------------------------------------------------------\n'
        printf 'Environment\n'
        printf '  OS:              %s · %s %s\n' "$ENV_OS_PRETTY" "$ENV_KERNEL" "$ENV_ARCH"
        printf '  Container:       %s\n' "$ENV_CONTAINER_MODE"
        printf '  CPU cores:       %s\n' "$ENV_CPU_CORES"
        printf '  RAM limit:       %s  (swap %s)\n' "$(fmt_gib "$ENV_RAM_BYTES")" "$(fmt_gib "$ENV_SWAP_BYTES")"
        printf '  DuckDB:          %s\n' "$ENV_DUCKDB_DISPLAY"
        printf '  DuckDB threads:  %s\n' "$ENV_DUCKDB_THREADS"
        printf '  DuckDB memory:   %s (effektiv)\n' "$ENV_DUCKDB_MEM"
        printf '  Spill dir:       %s  (%s, max %s)\n' "$ENV_SPILL_DIR" "$ENV_SPILL_DEDICATED_TXT" "$ENV_SPILL_MAX"
        printf '  preserve_order:  %s\n' "$ENV_PRESERVE_ORDER"
        printf -- '--------------------------------------------------------------------------------\n'
        printf 'Files:             %s   (Success %s · Skipped %s · Failed %s)\n' \
            "$TOTAL" "$SUCCESS_COUNT" "$SKIPPED_COUNT" "${#FAILED_FILES[@]}"
        printf 'Total Duration:    %s  (%s s)\n' "$(dur_human "$BATCH_DURATION")" "$BATCH_DURATION"

        if [[ "$SCHEMA_ACTION_EXECUTED" =~ ^(auto_heal_rebuild|force_rebuild)$ ]]; then
            printf '\nSchema Action:     %s (%s)\n' "$SCHEMA_ACTION_EXECUTED" "$SCHEMA_REASON"
        fi

        printf '\n'
        printf '================================================================================\n'
        printf 'Phase Timeline                              (P2–P6 batch-weit, nicht pro Datei)\n'
        printf '================================================================================\n'
        printf '%-4s %-26s %-9s %-9s %-13s %s\n' "#" "Phase" "Start" "End" "Duration" "Produziert"
        printf -- '--------------------------------------------------------------------------------\n'
        for i in "${!PH_ID[@]}"; do
            printf '%-4s %-26s %-9s %-9s %-13s %s\n' \
                "${PH_ID[$i]}" "$(phase_label_txt "${PH_ID[$i]}" "${PH_NAME[$i]}")" \
                "${PH_START_ISO[$i]#*T}" "${PH_END_ISO[$i]#*T}" \
                "$(dur_human "${PH_DUR[$i]}")" "${PH_PROD_TXT[$i]}"
        done
        printf -- '--------------------------------------------------------------------------------\n'
        printf '%-51s %s\n' "                                          Σ Phasen" "$(dur_human "$phases_sum")"

        printf '\n'
        printf '================================================================================\n'
        printf 'P1 · Extract — pro Datei                                  (Substep von Phase 1)\n'
        printf '================================================================================\n'
        printf '%-11s %-33s %-12s %-10s %-11s %s\n' "Fertig um" "Datei" "Dauer" "Peak-RSS" "Sys-Avail↓" "Objekte"
        printf -- '--------------------------------------------------------------------------------\n'
        local sum_obj=0 j objs objs_disp peak_disp avail_disp
        for j in "${!FL_NAME[@]}"; do
            objs=$(lookup_file_objects "${FL_NAME[$j]}")
            if [ -n "$objs" ]; then sum_obj=$((sum_obj + objs)); objs_disp=$(group_de "$objs"); else objs_disp="n/a"; fi
            if [ -n "${FL_PEAKRSS[$j]:-}" ]; then peak_disp="$(_kb_mb "${FL_PEAKRSS[$j]}") MB"; else peak_disp="n/a"; fi
            if [ -n "${FL_MINAVAIL[$j]:-}" ]; then avail_disp="$(_kb_mb "${FL_MINAVAIL[$j]}") MB"; else avail_disp="n/a"; fi
            printf '%-11s %-33s %11.3fs %-10s %-11s %s\n' \
                "${FL_COMPLETED[$j]#*T}" "${FL_NAME[$j]}" "${FL_DUR[$j]}" "$peak_disp" "$avail_disp" "$objs_disp"
        done
        printf -- '--------------------------------------------------------------------------------\n'
        printf '%-11s %-33s %11.3fs %-10s %-11s %s\n' "" "Σ ${#FL_NAME[@]} Dateien" "$phases_sum" "" "" "$(group_de "$sum_obj")"

        if [ "$SKIPPED_COUNT" -gt 0 ]; then
            printf '\nSkipped Files (unsupported format):\n'
            for j in "${SKIPPED_FILES[@]}"; do printf '  - %s\n' "$j"; done
        fi
        if [ "${#FAILED_FILES[@]}" -gt 0 ]; then
            printf '\nFailed Files:\n'
            for j in "${FAILED_FILES_INFO[@]}"; do
                local fn="${j%%|*}" rest="${j#*|}"; local cat="${rest%%|*}" hint="${rest#*|}"
                printf '  ✗ %s  [%s]\n      → %s\n' "$fn" "$cat" "$hint"
            done
        fi
        if [ "$POSTCHECK_WARN" -gt 0 ]; then
            printf '\nPost-Check Warnings: %s\n' "$POSTCHECK_WARN"
            for j in "${POSTCHECK_FINDINGS[@]}"; do printf '  - %s\n' "$j"; done
        fi
        printf '================================================================================\n'
    } > "$logfile"
}

write_json_sidecar() {
    local jsonfile="$1"
    local ph_tsv fl_tsv i j
    ph_tsv=$(mktemp); fl_tsv=$(mktemp)

    # Store phases/files as TAB-separated tables (idx as the first column for stable
    # order). DuckDB reads them as in-memory tables and assembles the JSON itself —
    # all escaping (filenames, quotes, Unicode) is done by json_object/COPY FORMAT json.
    # Scalars come via getenv() from the J_* env vars.
    for i in "${!PH_ID[@]}"; do
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$i" "${PH_ID[$i]}" "${PH_NAME[$i]}" "${PH_START_ISO[$i]}" "${PH_END_ISO[$i]}" \
            "${PH_DUR[$i]}" "${PH_PROD_JSON[$i]}" >> "$ph_tsv"
    done
    for j in "${!FL_NAME[@]}"; do
        local objs; objs=$(lookup_file_objects "${FL_NAME[$j]}")
        [ -z "$objs" ] && objs="null"
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$j" "${FL_NAME[$j]}" "${FL_SIZE[$j]:-null}" "${FL_ENC[$j]}" "${FL_STATUS[$j]}" \
            "${FL_DUR[$j]}" "${FL_COMPLETED[$j]}" "$objs" \
            "${FL_ERR_CAT[$j]}" "${FL_ERR_RC[$j]}" "${FL_ERR_HINT[$j]}" >> "$fl_tsv"
    done

    # read_csv fails on an EMPTY file (can happen with fail-fast before P1 finishes
    # → 0 phases). In that case create an empty, typed table instead, so the COPY
    # query (with COALESCE → '[]') still writes a valid document.
    local ph_cols="{'idx':'INT','id':'VARCHAR','name':'VARCHAR','started_at':'VARCHAR','ended_at':'VARCHAR','duration_s':'VARCHAR','produced':'VARCHAR'}"
    local fl_cols="{'idx':'INT','name':'VARCHAR','size':'VARCHAR','encoding':'VARCHAR','status':'VARCHAR','duration_s':'VARCHAR','completed_at':'VARCHAR','objects':'VARCHAR','ecat':'VARCHAR','erc':'VARCHAR','ehint':'VARCHAR'}"
    local ph_create fl_create
    if [ -s "$ph_tsv" ]; then
        ph_create="CREATE TEMP TABLE _ph AS SELECT * FROM read_csv('$ph_tsv', delim='\t', header=false, quote='', escape='', columns=$ph_cols);"
    else
        ph_create="CREATE TEMP TABLE _ph(idx INT, id VARCHAR, name VARCHAR, started_at VARCHAR, ended_at VARCHAR, duration_s VARCHAR, produced VARCHAR);"
    fi
    if [ -s "$fl_tsv" ]; then
        fl_create="CREATE TEMP TABLE _fl AS SELECT * FROM read_csv('$fl_tsv', delim='\t', header=false, quote='', escape='', columns=$fl_cols);"
    else
        fl_create="CREATE TEMP TABLE _fl(idx INT, name VARCHAR, size VARCHAR, encoding VARCHAR, status VARCHAR, duration_s VARCHAR, completed_at VARCHAR, objects VARCHAR, ecat VARCHAR, erc VARCHAR, ehint VARCHAR);"
    fi

    local rc=0
    # In-memory DuckDB (no master-DB access → no lock contention). getenv() reads the
    # exported J_* scalars; TRY_CAST keeps the output robust (non-numeric values →
    # JSON null instead of an abort). COPY … (FORMAT json) writes the document as one
    # line directly to *.json.tmp; then an atomic mv.
    if PH_TSV="$ph_tsv" FL_TSV="$fl_tsv" \
       J_SCHEMA="$LOG_SCHEMA" \
       J_STARTED="$RUN_STARTED_ISO" J_ENDED="$RUN_ENDED_ISO" J_DURATION="$BATCH_DURATION" \
       J_CONVERTER="$CONVERTER_VERSION" J_SCHEMAVER="$SCHEMA_VERSION_EXPECTED" \
       J_MODE="$RUN_MODE" \
       J_FORCE_REBUILD="$FORCE_REBUILD" J_SPLIT="$SPLIT_MODE" J_FAIL_FAST="$FAIL_FAST" \
       J_NO_AUTO_HEAL="$NO_AUTO_HEAL" J_QUIET="$QUIET_MODE" J_MEMORY_LIMIT="$MEMORY_LIMIT" \
       J_JOBS="$JOBS" J_PARALLEL="${PARALLEL_P1:-false}" \
       J_ATTEMPT="$ATTEMPT" J_RETRY_REASON="$RETRY_REASON" J_RETRY_REASON_KNOWN="$RETRY_REASON_KNOWN" \
       J_RETRY_OF="$RETRY_OF" J_SCHEMA_ACTION="$SCHEMA_ACTION_EXECUTED" \
       J_TOTAL="$TOTAL" J_SUCCESS="$SUCCESS_COUNT" J_SKIPPED="$SKIPPED_COUNT" J_FAILED="${#FAILED_FILES[@]}" \
       J_OS_PRETTY="$ENV_OS_PRETTY" J_KERNEL="$ENV_KERNEL" J_ARCH="$ENV_ARCH" \
       J_CONTAINER="$ENV_CONTAINER_MODE" J_CPU="$ENV_CPU_CORES" \
       J_RAM="$ENV_RAM_BYTES" J_SWAP="$ENV_SWAP_BYTES" \
       J_DUCKDB_VER="$ENV_DUCKDB_VERSION" J_DUCKDB_BUILD="$ENV_DUCKDB_BUILD" \
       J_DUCKDB_THREADS="$ENV_DUCKDB_THREADS" J_DUCKDB_MEM="$ENV_DUCKDB_MEM" \
       J_PRESERVE_ORDER="$ENV_PRESERVE_ORDER" \
       J_SPILL_DIR="$ENV_SPILL_DIR" J_SPILL_MAX="$ENV_SPILL_MAX" J_SPILL_DEDICATED="$ENV_SPILL_DEDICATED" \
       "$DUCKDB_BIN" <<SQL >/dev/null 2>&1
$ph_create
$fl_create
COPY (
  SELECT
    getenv('J_SCHEMA') AS "schema",
    {
      'started_at': getenv('J_STARTED'),
      'ended_at': getenv('J_ENDED'),
      'duration_s': TRY_CAST(getenv('J_DURATION') AS DOUBLE),
      'converter_version': getenv('J_CONVERTER'),
      'schema_version': getenv('J_SCHEMAVER'),
      'mode': getenv('J_MODE'),
      'options': {
        'force_rebuild': getenv('J_FORCE_REBUILD')='true',
        'split': getenv('J_SPLIT')='true',
        'fail_fast': getenv('J_FAIL_FAST')='true',
        'no_auto_heal': getenv('J_NO_AUTO_HEAL')='true',
        'quiet': getenv('J_QUIET')='true',
        'memory_limit': nullif(getenv('J_MEMORY_LIMIT'),''),
        'jobs': TRY_CAST(getenv('J_JOBS') AS BIGINT),
        'parallel': getenv('J_PARALLEL')='true'
      },
      'attempt': TRY_CAST(getenv('J_ATTEMPT') AS BIGINT),
      'retry_reason': nullif(getenv('J_RETRY_REASON'),''),
      'retry_reason_known': getenv('J_RETRY_REASON_KNOWN')='true',
      'retry_of': nullif(getenv('J_RETRY_OF'),''),
      'schema_action': nullif(getenv('J_SCHEMA_ACTION'),''),
      'result': {
        'total': TRY_CAST(getenv('J_TOTAL') AS BIGINT),
        'success': TRY_CAST(getenv('J_SUCCESS') AS BIGINT),
        'skipped': TRY_CAST(getenv('J_SKIPPED') AS BIGINT),
        'failed': TRY_CAST(getenv('J_FAILED') AS BIGINT)
      }
    } AS run,
    {
      'os': {'pretty_name': getenv('J_OS_PRETTY'), 'kernel': getenv('J_KERNEL'), 'arch': getenv('J_ARCH')},
      'container_mode': getenv('J_CONTAINER'),
      'cpu_cores': TRY_CAST(getenv('J_CPU') AS BIGINT),
      'ram_limit_bytes': TRY_CAST(getenv('J_RAM') AS BIGINT),
      'swap_limit_bytes': TRY_CAST(getenv('J_SWAP') AS BIGINT),
      'duckdb': {
        'version': getenv('J_DUCKDB_VER'),
        'build': nullif(getenv('J_DUCKDB_BUILD'),''),
        'threads': TRY_CAST(getenv('J_DUCKDB_THREADS') AS BIGINT),
        'memory_limit': getenv('J_DUCKDB_MEM'),
        'preserve_insertion_order': getenv('J_PRESERVE_ORDER')='true'
      },
      'spill': {'dir': getenv('J_SPILL_DIR'), 'max': getenv('J_SPILL_MAX'), 'dedicated_volume': getenv('J_SPILL_DEDICATED')='true'}
    } AS environment,
    COALESCE((SELECT to_json(list(json_object(
        'id', id, 'name', name,
        'started_at', started_at, 'ended_at', ended_at,
        'duration_s', TRY_CAST(duration_s AS DOUBLE),
        'produced', produced::JSON
      ) ORDER BY idx)) FROM _ph), '[]'::JSON) AS phases,
    COALESCE((SELECT to_json(list(json_object(
        'name', name,
        'size_bytes', CASE WHEN size IN ('','null') THEN NULL ELSE TRY_CAST(size AS BIGINT) END,
        'encoding', nullif(encoding,''),
        'status', status,
        'duration_s', TRY_CAST(duration_s AS DOUBLE),
        'completed_at', nullif(completed_at,''),
        'objects', CASE WHEN objects IN ('','null') THEN NULL ELSE TRY_CAST(objects AS BIGINT) END,
        'error', CASE WHEN status='failed'
                      THEN json_object('category', nullif(ecat,''), 'exit_code', TRY_CAST(nullif(erc,'') AS INT), 'hint', nullif(ehint,''))
                      ELSE NULL END
      ) ORDER BY idx)) FROM _fl), '[]'::JSON) AS files
) TO '$jsonfile.tmp' (FORMAT json);
SQL
    then
        mv -f "$jsonfile.tmp" "$jsonfile"
    else
        rc=1
        rm -f "$jsonfile.tmp" 2>/dev/null
    fi
    rm -f "$ph_tsv" "$fl_tsv"
    return $rc
}

# finalize_logs — writes the text log + JSON sidecar exactly once. Idempotent,
# so it can be called from multiple exit paths (normal end, fail-fast).
finalize_logs() {
    $LOGS_FINALIZED && return 0
    LOGS_FINALIZED=true
    mkdir -p "$LOG_DIR"
    # Ensure end time/duration are set in case they aren't yet (e.g. fail-fast).
    if [ -z "$BATCH_END" ]; then BATCH_END=$(date +%s.%N); fi
    if [ -z "$BATCH_DURATION" ]; then
        BATCH_DURATION=$(awk -v a="$BATCH_END" -v b="${BATCH_START:-$BATCH_END}" 'BEGIN{printf "%.3f", a-b}')
    fi
    [ -z "$RUN_ENDED_HUMAN" ] && RUN_ENDED_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
    [ -z "$RUN_ENDED_ISO" ]   && RUN_ENDED_ISO=$(iso_now)
    write_text_log "$LOG_FILE"
    write_json_sidecar "$JSON_FILE" || emit_warn "JSON-Sidecar konnte nicht geschrieben werden ($JSON_FILE)"
}

# run_pipeline_step <label> <sql-file...> — runs a table-only SQL pass
# (cd PROJECT_ROOT for relative CSV paths, memory_limit_prefix prepended).
# Returns: 0 = ok/continue (even on a non-fatal error), 2 = fail-fast stop.
run_pipeline_step() {
    local label="$1"; shift
    local templog; templog=$(mktemp)
    local rc=0
    if (cd "$PROJECT_ROOT" && { memory_limit_prefix; cat "$@"; } | "$DUCKDB_BIN" "$DB_FILE") > "$templog" 2>&1; then
        echo "✓ $label"
    else
        echo "✗ WARNING: $label failed"
        {
            echo "================================================================================"
            echo "ERROR: $label"
            echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
            echo "================================================================================"
            cat "$templog"; echo ""
        } >> "$ERROR_LOG_FILE"
        echo "Error details:"; sed 's/^/  /' "$templog"
        $FAIL_FAST && rc=2
    fi
    rm -f "$templog"
    return $rc
}

# fail_fast_stop <stage> — shared fail-fast abort (write logs + banner).
fail_fast_stop() {
    finalize_logs
    echo ""
    echo "========================================="
    echo "FAIL-FAST MODE: Stopping batch import"
    echo "========================================="
    echo "Failed during: $1"
    echo "Error log: $ERROR_LOG_FILE"
    echo ""
    emit_done false "Failed during: $1"
    exit 1
}

# ============================================================================
# Main Script Execution
# ============================================================================

# Concurrency lock before any write operation. Protects CLI ↔ REST-API against
# double runs on the same database. A no-op in test mode.
if ! acquire_lock; then
    if $QUIET_MODE; then
        emit_done false "Another conversion is already running"
    fi
    exit 7
fi

# Set the phase budget for the progress bar — the SQL pipeline phases as labelled
# segments in the web frontend (see project/prd_webclient_xml_import_progress*.md).
# Opt 1 (v2): P1/extract is split into two visible segments — `chunk` (Phase S:
# split XML into chunks) and `import` (Phase D/C: chunks → DuckDB → master). The
# turbo path (always used by the web frontend) emits `chunk`/`import`. The
# CLI-only non-turbo paths (serial loop, --jobs parallel) keep emitting `extract`,
# which is retained here mapped to the full 0-70 union so their bar still fills
# smoothly (the frontend has no `extract` segment, but its fill math derives each
# segment's fill from the global pct, so chunk+import fill correctly regardless).
# P2–P5 are the fast catalog phases; P6/validate absorbs the post-processor checks
# AND the rest-api sync/reload at its tail.
set_phase_budget "chunk:0-25 import:25-70 extract:0-70 resolve:70-78 details:78-84 catalog:84-90 homes:90-96 validate:96-100"

# One-off start event in --quiet mode so clients immediately know the process is
# running. The controller streams this out anyway, but an explicit script-owned
# event decouples script ↔ stream.
if $QUIET_MODE; then
    emit_progress chunk 0 "Starting XML conversion"
fi

# ----------------------------------------------------------------------------
# Schema detection & auto-heal (before every import)
# ----------------------------------------------------------------------------
compute_schema_state
SCHEMA_ACTION_EXECUTED="$SCHEMA_ACTION"

if ! $QUIET_MODE; then
    echo "========================================="
    echo "Schema-Detection"
    echo "========================================="
    echo "Template Version:  $SCHEMA_VERSION_EXPECTED"
    echo "Template Hash:     ${SCHEMA_HASH_EXPECTED:0:12}…"
    if [ -n "$SCHEMA_VERSION_DB" ]; then
        echo "DB Version:        $SCHEMA_VERSION_DB"
        echo "DB Hash:           ${SCHEMA_HASH_DB:0:12}…"
    else
        echo "DB Version:        <keine SchemaInfo / DB existiert nicht>"
    fi
    echo "Action:            $SCHEMA_ACTION"
    echo "Reason:            $SCHEMA_REASON"
else
    emit_log "Schema action: $SCHEMA_ACTION ($SCHEMA_REASON)"
fi
# Schema check is an early signpost inside the chunk phase → map it to a small
# within-phase value (Phase S then fills the remaining chunk range 5..100).
phase_progress chunk 5 "Schema check complete"

# 1. --force-rebuild overrides all detection results
if $FORCE_REBUILD && [ -f "$DB_FILE" ]; then
    echo ""
    echo "  ⚠ --force-rebuild aktiv: DB wird vor dem Import gelöscht"
    delete_db_for_rebuild "--force-rebuild explizit gesetzt"
    SCHEMA_ACTION_EXECUTED="force_rebuild"
fi

# 2. Schema-Drift behandeln
if [ "$SCHEMA_ACTION" = "rebuild" ] && ! $FORCE_REBUILD; then
    if $NO_AUTO_HEAL; then
        echo ""
        echo "ERROR: Schema-Drift erkannt und --no-auto-heal aktiv → Abbruch."
        echo "       $SCHEMA_REASON"
        echo ""
        echo "       Manueller Rebuild: bash \"$0\" --batch --force-rebuild"
        exit 6
    fi

    if [[ "$MODE" == "single" ]]; then
        echo ""
        echo "ERROR: Schema-Drift erkannt — DB ist nicht kompatibel mit aktuellen SQL-Templates."
        echo "       DB-Version: ${SCHEMA_VERSION_DB:-<none>}   Template-Version: $SCHEMA_VERSION_EXPECTED"
        echo "       Reason: $SCHEMA_REASON"
        echo ""
        echo "Auto-Heal ist im Single-File-Modus deaktiviert (würde alle anderen Dateien"
        echo "aus der DB verlieren). Wähle einen der folgenden Wege:"
        echo ""
        echo "  Empfohlen:  bash \"$0\" --batch --force-rebuild"
        echo "              (löscht DB, importiert alle XML-Dateien aus xml/ neu)"
        echo ""
        echo "  Manuell:    rm \"$DB_FILE\" && bash \"$0\" \"$FILENAME\""
        echo "              (Vorsicht: andere Dateien sind dann nicht mehr in der DB)"
        exit 6
    fi

    # Batch mode: perform auto-heal
    echo ""
    echo "  ⚠ Auto-Heal: DB wird gelöscht und im Batch-Modus neu aufgebaut"
    delete_db_for_rebuild "$SCHEMA_REASON"
    SCHEMA_ACTION_EXECUTED="auto_heal_rebuild"
fi

# 3. Warn path (hash drift without a version bump)
if [ "$SCHEMA_ACTION" = "warn" ]; then
    echo ""
    echo "  ⚠ WARNING: $SCHEMA_REASON"
fi

echo ""

if [[ "$MODE" == "batch" ]]; then
    # ========================================================================
    # BATCH MODE: Process all XML files
    # ========================================================================
    echo "========================================="
    if $TEST_MODE; then
        echo "FileMaker XML TEST Import"
        echo "Source: xml-test/ → db/fm_test.duckdb"
    else
        echo "FileMaker XML Batch Import"
    fi
    if $FAIL_FAST; then
        echo "(Fail-Fast Mode: Stop on first error)"
    fi
    echo "========================================="

    # 1. Discover all XML files
    shopt -s nullglob  # Return empty array if no matches
    XML_FILES=("$XML_DIR"/*.xml)
    TOTAL=${#XML_FILES[@]}

    if [ $TOTAL -eq 0 ]; then
        echo "ERROR: No XML files found in $XML_DIR"
        exit 1
    fi

    echo "Found $TOTAL XML files to process"
    echo ""

    # 2. Create logs directory (text log + JSON are written at the end of the run).
    mkdir -p "$LOG_DIR"

    # Collect environment context + derived header strings once.
    collect_environment
    collect_duckdb_settings
    build_run_meta

    # 3. Initialize counters + collection arrays
    SUCCESS_COUNT=0
    SKIPPED_COUNT=0
    UNCHANGED_COUNT=0   # Turbo --changed-only: files skipped via the manifest (unchanged)
    declare -a FAILED_FILES
    declare -a SKIPPED_FILES
    # FAILED_FILES_INFO: "file|category|hint" per failed file (stage 4)
    declare -a FAILED_FILES_INFO

    # 4. Start timer for entire batch + run start time
    BATCH_START=$(date +%s.%N)
    RUN_STARTED_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
    RUN_STARTED_ISO=$(iso_now)

    # Disk preflight for the classic (non-turbo) paths — sequential, --split and the
    # --jobs part-DB merge all write into the master DB and (parallel path) part DBs
    # under $TMPDIR. Turbo runs its own (per-round) guard inside run_turbo_pipeline.
    $TURBO_MODE || preflight_disk_or_abort "Batch-Preflight (Phase 1)"

    # Phase 1 (Extract) timer start — wraps the entire file loop.
    phase_begin P1 Extract

    # Parallel mode (--jobs N>1). Run Phase 1 for all files concurrently up front
    # into part DBs and merge into the master DB. The telemetry loop below then
    # reads the pre-produced results ($PARTDB_DIR/<idx>.{rc,out,dur}) instead of
    # calling process_single_file itself — the entire report/error logic stays
    # unchanged. Bit-identical to the sequential run.
    # PARALLEL_P1 = "events arrived in waves up front" (file-parallel path only → the
    # telemetry loop then suppresses its own file events). P1_PREPROCESSED =
    # "results exist as $PARTDB_DIR/<i> sidecars" (file-parallel OR turbo → the loop
    # reads them instead of calling process_single_file). Turbo sets only
    # P1_PREPROCESSED (not PARALLEL_P1), so the loop fires the file events itself.
    PARALLEL_P1=false
    P1_PREPROCESSED=false
    if $TURBO_MODE; then
        # Turbo engine (phases S/D/C). Produces the master DB + per-file sidecars.
        P1_PREPROCESSED=true
        PARTDB_DIR=$(mktemp -d)
        if $QUIET_MODE; then
            emit_log "Turbo: Phase S/D/C ($TURBO_W Worker, Chunkmap-getrieben)"
        else
            echo "Turbo-Engine: Phase S/D/C, $TURBO_W Worker, $TOTAL Dateien → Chunkmap + chunk_<id>.duckdb"
        fi
        run_turbo_pipeline
        if [ "${TURBO_RC:-0}" -ne 0 ]; then
            echo "ERROR: Turbo-Konsolidierung fehlgeschlagen (rc=$TURBO_RC)"
            [ -f "$PARTDB_DIR/merge.log" ] && sed 's/^/    /' "$PARTDB_DIR/merge.log"
            [ -f "$PARTDB_DIR/catmerge.log" ] && { echo "    --- catmerge.log ---"; sed 's/^/    /' "$PARTDB_DIR/catmerge.log"; }
            rm -rf "$PARTDB_DIR"
            exit 3
        fi
        # Free transient turbo artifacts (chunkmap.duckdb = plan stays for inspection;
        # cleanup later optionally via --keep-streaming). The chunk XML splits under
        # chunks/ can be hundreds of MB in production → remove them specifically here.
        if [ -n "${FM_T3_KEEP:-}" ]; then
            echo "@T3 PARTDB_DIR $PARTDB_DIR"   # keep artifacts (ATTACH/INSERT probe)
        else
            rm -f "$PARTDB_DIR"/part_*.duckdb
            rm -rf "$STREAMING_DIR/chunks"
            rm -f "$STREAMING_DIR"/chunk_*.duckdb "$STREAMING_DIR"/chunk_*.rc \
                  "$STREAMING_DIR"/chunk_*.out "$STREAMING_DIR"/chunk_*.done "$STREAMING_DIR"/chunk_*.dur "$STREAMING_DIR"/consolidate.log
        fi
    elif [ "$JOBS" -gt 1 ] && [ "$TOTAL" -gt 1 ]; then
        PARALLEL_P1=true
        P1_PREPROCESSED=true
        PARTDB_DIR=$(mktemp -d)
        if $QUIET_MODE; then
            emit_log "Phase 1 parallel: $JOBS Worker für $TOTAL Dateien (Teil-DBs + Merge)"
        else
            echo "Phase 1 parallel: $JOBS Worker, $TOTAL Dateien → Teil-DBs + Merge"
        fi
        run_p1_parallel
        # Sign of life for the (otherwise silent) merge phase at the convert→catalog boundary.
        phase_progress extract 100 "Teil-DBs mergen…"
        merge_part_dbs
        if [ "${MERGE_RC:-0}" -ne 0 ]; then
            echo "ERROR: Merge der Teil-DBs fehlgeschlagen (rc=$MERGE_RC)"
            [ -f "$PARTDB_DIR/merge.log" ] && sed 's/^/    /' "$PARTDB_DIR/merge.log"
            [ -f "$PARTDB_DIR/catmerge.log" ] && { echo "    --- catmerge.log ---"; sed 's/^/    /' "$PARTDB_DIR/catmerge.log"; }
            rm -rf "$PARTDB_DIR"
            exit 3
        fi
        rm -f "$PARTDB_DIR"/part_*.duckdb   # free part DBs after the merge
    fi

    # 5. Process each file
    for i in "${!XML_FILES[@]}"; do
        FILE="${XML_FILES[$i]}"
        BASENAME=$(basename "$FILE")
        CURRENT=$((i + 1))

        # In quiet mode, continuous progress based on the file index, so the
        # progress bar does not stall during a long batch run. Per-file granularity
        # is enough — within a file the DuckDB phase is an opaque block.
        # On the quiet-parallel path run_p1_parallel already emitted file_start/progress
        # live in waves — do not fire them again here (else double counting). In all
        # other cases as before; the report work further below runs path-independently.
        # Opt 2 (Log-Entrümpelung): Im preprocessten Pfad (Turbo/Parallel) steht das
        # Datei-Ergebnis bereits in den Sidecars. Unveränderte (Manifest-Skip, rc 0 +
        # .unchanged) und übersprungene (nicht unterstütztes Format, rc 4) Dateien
        # erzeugen im Web-Log KEINE „Processing"/file_start-Zeile mehr — die
        # ⏭️-Status-Tabelle (file_skip aus Phase S) deckt sie ohnehin ab. Das terminale
        # `file`-Event bleibt erhalten (Node-Zähler processed/total) und wird
        # frontend-seitig (eventToLine) nicht als Zeile gerendert.
        PRE_QUIET_SKIP=false
        if $P1_PREPROCESSED; then
            PRE_RC=$(cat "$PARTDB_DIR/${i}.rc" 2>/dev/null); PRE_RC=${PRE_RC:-3}
            if { [ "$PRE_RC" -eq 0 ] && [ -f "$PARTDB_DIR/${i}.unchanged" ]; } || [ "$PRE_RC" -eq 4 ]; then
                PRE_QUIET_SKIP=true
            fi
        fi

        if $QUIET_MODE && $PARALLEL_P1; then
            :   # live events already came from the wave
        else
            # On the turbo path (preprocessed) Phase D already filled the import
            # segment AND the per-file import_* lifecycle gives finer live feedback —
            # re-emitting per-file progress here would make the bar jump
            # backwards. Only the truly-serial path (no preprocessing) needs it.
            if ! $P1_PREPROCESSED; then
                FILE_PCT=$(( (i * 100) / TOTAL ))
                phase_progress extract $(( 10 + (FILE_PCT * 90) / 100 )) "Processing: $BASENAME"
            fi

            if $QUIET_MODE; then
                if $PRE_QUIET_SKIP; then
                    :   # unverändert/übersprungen → keine Processing/file_start-Zeile (siehe oben)
                else
                    # file_start: carries the total and the current filename already
                    # before the (long) DuckDB block, so the frontend can fill the status
                    # line ("x of TOTAL") immediately and highlight the running file in the
                    # list.
                    _emit_json file_start filename "$BASENAME" index "int=$CURRENT" total "int=$TOTAL"
                    emit_log "[$CURRENT/$TOTAL] Processing: $BASENAME"
                fi
            else
                echo "[$CURRENT/$TOTAL] Processing: $BASENAME"
            fi
        fi

        # Start timer for this file + file size (JSON only)
        FILE_START=$(date +%s.%N)
        FILE_SIZE=$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE" 2>/dev/null || echo "")

        # Call single-file processing function (capture error output).
        # Parallel/turbo mode: the result was produced up front → just read it.
        if $P1_PREPROCESSED; then
            ERROR_OUTPUT=$(cat "$PARTDB_DIR/${i}.out" 2>/dev/null)
            RESULT=$(cat "$PARTDB_DIR/${i}.rc" 2>/dev/null); RESULT=${RESULT:-3}
        else
            ERROR_OUTPUT=$(process_single_file "$BASENAME" 2>&1)
            RESULT=$?
        fi

        # Extract the encoding from the Preprocessed line (process_single_file runs
        # in a subshell, so PRE_ENCODING does not come back directly).
        FILE_ENC=$(printf '%s\n' "$ERROR_OUTPUT" | grep -oE 'enc=[^)]*' | head -1 | cut -d= -f2)
        FILE_FAILED=false
        FILE_ERR_CAT=""; FILE_ERR_RC=""; FILE_ERR_HINT=""

        if [ $RESULT -eq 0 ] && $P1_PREPROCESSED && [ -f "$PARTDB_DIR/${i}.unchanged" ]; then
            # Turbo --changed-only: unchanged file (manifest skip) — do not count as an import.
            ((UNCHANGED_COUNT++))
            FILE_STATUS="unchanged"
            if $QUIET_MODE; then
                _emit_json file filename "$BASENAME" index "int=$CURRENT" total "int=$TOTAL" ok "bool=true" status "unchanged"
            else
                echo "  ↻ Unverändert (übersprungen)"
            fi
        elif [ $RESULT -eq 0 ]; then
            ((SUCCESS_COUNT++))
            FILE_STATUS="success"
            if $QUIET_MODE; then
                # file event only emitted serially here; in parallel it came from the wave.
                $PARALLEL_P1 || _emit_json file filename "$BASENAME" index "int=$CURRENT" total "int=$TOTAL" ok "bool=true"
            else
                echo "  ✓ Success"
            fi
        elif [ $RESULT -eq 4 ]; then
            ((SKIPPED_COUNT++))
            SKIPPED_FILES+=("$BASENAME")
            FILE_STATUS="skipped"
            if $QUIET_MODE; then
                $PARALLEL_P1 || _emit_json file filename "$BASENAME" index "int=$CURRENT" total "int=$TOTAL" ok "bool=false" status "skipped"
            else
                echo "  ⊘ Skipped (unsupported format)"
            fi
        else
            FAILED_FILES+=("$BASENAME")
            FILE_STATUS="failed"
            FILE_FAILED=true
            # Stage 4: classify the error (for the retry suggestion in the final report)
            classify_error "$RESULT" "$ERROR_OUTPUT"
            FAILED_FILES_INFO+=("$BASENAME|$ERR_CATEGORY|$ERR_RETRY_HINT")
            FILE_ERR_CAT="$ERR_CATEGORY"; FILE_ERR_RC="$RESULT"; FILE_ERR_HINT="$ERR_RETRY_HINT"
            if $QUIET_MODE; then
                # file event only serially here; in parallel it came from the wave.
                # The detail logs (emit_warn) are log events without double counting
                # and therefore run on both paths.
                $PARALLEL_P1 || _emit_json file filename "$BASENAME" index "int=$CURRENT" total "int=$TOTAL" ok "bool=false" status "failed" category "$ERR_CATEGORY"
                # Wrap the single-file step's detail output in log events so the
                # browser log block can display it.
                while IFS= read -r line; do
                    [ -z "$line" ] && continue
                    emit_warn "$BASENAME: $line"
                done <<< "$ERROR_OUTPUT"
            else
                echo "  ✗ Failed"
            fi

            # Write error details to separate error log file
            if [ -n "$ERROR_OUTPUT" ]; then
                echo "================================================================================" >> "$ERROR_LOG_FILE"
                echo "ERROR: $BASENAME" >> "$ERROR_LOG_FILE"
                echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
                echo "================================================================================" >> "$ERROR_LOG_FILE"
                echo "$ERROR_OUTPUT" >> "$ERROR_LOG_FILE"
                echo "" >> "$ERROR_LOG_FILE"
            fi
        fi

        # End timer and calculate duration
        # awk instead of bc: bc is not installed in the devcontainer (→ "command not
        # found" and 0.000s in the logs); awk is a hard dependency anyway (splitter
        # + log formatting). %s.%N timestamps are floats.
        FILE_END=$(date +%s.%N)
        FILE_PEAKRSS_KB=""; FILE_MINAVAIL_KB=""
        if $P1_PREPROCESSED; then
            # The loop's wall-clock is ~0 here (work ran up front, parallel/turbo) —
            # the real per-file duration comes from the worker or (turbo) the Phase-S measurement.
            FILE_DURATION=$(cat "$PARTDB_DIR/${i}.dur" 2>/dev/null); FILE_DURATION=${FILE_DURATION:-0.000}
            # Worker memory forensics (".mem" = "<peak_rss_kb> <min_avail_kb>").
            FILE_PEAKRSS_KB=$(awk '{print $1}' "$PARTDB_DIR/${i}.mem" 2>/dev/null)
            FILE_MINAVAIL_KB=$(awk '{print $2}' "$PARTDB_DIR/${i}.mem" 2>/dev/null)
        else
            FILE_DURATION=$(awk -v a="$FILE_END" -v b="$FILE_START" 'BEGIN { printf "%.3f", a - b }')
        fi

        # Memory forensics as a log event (lands in the text log AND in JSON events[]
        # — without having to touch the typed JSON sidecar schema).
        if [ -n "$FILE_PEAKRSS_KB" ]; then
            emit_log "MEM $BASENAME: peak_rss=$(_kb_mb "$FILE_PEAKRSS_KB")MB sys_avail_min=$(_kb_mb "${FILE_MINAVAIL_KB:-0}")MB dur=${FILE_DURATION}s"
        fi

        # Collect the per-file record for the text log + JSON sidecar.
        FL_NAME+=("$BASENAME");        FL_SIZE+=("$FILE_SIZE")
        FL_ENC+=("$FILE_ENC");         FL_STATUS+=("$FILE_STATUS")
        FL_DUR+=("$FILE_DURATION");    FL_COMPLETED+=("$(iso_now)")
        FL_ERR_CAT+=("$FILE_ERR_CAT"); FL_ERR_RC+=("$FILE_ERR_RC"); FL_ERR_HINT+=("$FILE_ERR_HINT")
        FL_PEAKRSS+=("$FILE_PEAKRSS_KB"); FL_MINAVAIL+=("$FILE_MINAVAIL_KB")

        # Stop immediately if fail-fast mode is enabled (logs are written).
        if $FILE_FAILED && $FAIL_FAST; then
            fail_fast_stop "File: $BASENAME"
        fi

        echo ""
    done

    # Finish P1: determine object counts + load per-file objects.
    P1_OBJ=$(count_table_sum "${P1_OBJECT_TABLES[@]}")
    P1_DDR=$(pp_num "SELECT COUNT(*) FROM DDR_Calculations")
    phase_finish "$(group_de "$P1_OBJ") Objekte (+$(group_de "$P1_DDR") DDR-Chunks)" \
        "{\"objects_extracted\":$P1_OBJ,\"ddr_calc_chunks\":$P1_DDR}"
    load_per_file_objects

    # Clean up the part-DB/sidecar working directory (file-parallel OR turbo).
    # FM_T3_KEEP (T-3 probe) holds the artifacts back (otherwise deleted globally here).
    $P1_PREPROCESSED && [ -z "${FM_T3_KEEP:-}" ] && rm -rf "$PARTDB_DIR"

    # ── Short-Circuit: nichts geändert → P2–P6 + Sync überspringen ──────────────
    # (gesetzt von run_turbo_pipeline: 0 pending-Chunks + Kataloge bereits 'ok').
    # Der gesamte Katalog-Rebuild- + Sync-Block läuft NUR, wenn etwas zu tun ist; der
    # Abschlussreport (BATCH_END/emit_done, weiter unten) läuft in BEIDEN Fällen. Der
    # Block-Körper bleibt bewusst auf seiner bisherigen Einrückung (minimaler Diff).
    if ! $TURBO_NO_CHANGES; then
    # 6. Phase 2 (Resolve) — reference resolution (table-only, ONCE after all
    # imports). Rebuilds XMLStep/Layout/Calc refs, MBS/GetSub, PluginUsages from the
    # P1 tables. Must run BEFORE the universal catalogs.
    phase_progress resolve 0 "Resolving references (Phase 2)..."
    if ! $QUIET_MODE; then
        echo "========================================="
        echo "Resolving references (Phase 2)..."
        echo "========================================="
    fi
    phase_begin P2 Resolve
    run_phase2 "Phase 2 Reference Resolution"; rc=$?
    P2_REF=$(count_table_sum XMLCalcReferences XMLStepReferences XMLLayoutReferences PluginFunctionUsages MBS_SubnameMap GetSubparameterMap)
    phase_finish "$(group_de "$P2_REF") Referenzen" "{\"references_resolved\":$P2_REF}"
    [ "$rc" = 2 ] && fail_fast_stop "Phase 2 Reference Resolution"
    echo ""

    # 7. Phase 3 (Details) — variable parser. P3/P4 are now two separate DuckDB
    # invocations (individually measurable). The 03→04 order remains mandatory.
    # CWD = PROJECT_ROOT (relative CSV paths in convert_xml_03_details.sql).
    phase_progress details 0 "Building variable analysis (Phase 3)..."
    if ! $QUIET_MODE; then
        echo "========================================="
        echo "Building variable analysis (Phase 3)..."
        echo "========================================="
    fi
    phase_begin P3 Details
    run_pipeline_step "Phase 3 Details (Variablen)" "$PROJECT_ROOT/sql/convert-xml/convert_xml_03_details.sql"; rc=$?
    P3_USAGES=$(pp_num "SELECT COUNT(*) FROM VariableUsages")
    P3_VARS=$(pp_num "SELECT COUNT(*) FROM VariablesCatalog")
    phase_finish "$(group_de "$P3_USAGES") Verwend. · $(group_de "$P3_VARS") Var." \
        "{\"variable_usages\":$P3_USAGES,\"variables_distinct\":$P3_VARS}"
    [ "$rc" = 2 ] && fail_fast_stop "Phase 3 Details"
    echo ""

    # Phase 4 (Catalog) — ObjectCatalog + ObjectLinks.
    phase_progress catalog 0 "Building universal catalogs (Phase 4)..."
    if ! $QUIET_MODE; then
        echo "========================================="
        echo "Building universal catalogs (Phase 4)..."
        echo "========================================="
    fi
    phase_begin P4 Catalog
    run_pipeline_step "Phase 4 Catalog (Objekte+Links)" "$PROJECT_ROOT/sql/convert-xml/convert_xml_04_catalog.sql"; rc=$?
    P4_OBJ=$(pp_num "SELECT COUNT(*) FROM ObjectCatalog")
    P4_LINKS=$(pp_num "SELECT COUNT(*) FROM ObjectLinks")
    phase_finish "$(group_de "$P4_OBJ") Objekte · $(group_de "$P4_LINKS") Links" \
        "{\"objects_registered\":$P4_OBJ,\"links\":$P4_LINKS}"
    [ "$rc" = 2 ] && fail_fast_stop "Phase 4 Catalog"
    echo ""

    # 7a. Phase 5 (Homes) — ObjectHomes + TableOccurrenceResolution (Cross-File).
    phase_progress homes 0 "Building resolution tables (Phase 5)..."
    if ! $QUIET_MODE; then
        echo "========================================="
        echo "Building resolution tables (Phase 5)..."
        echo "========================================="
    fi
    phase_begin P5 Homes
    run_pipeline_step "Phase 5 Homes (Cross-File)" "$PROJECT_ROOT/sql/convert-xml/convert_xml_05_homes.sql"; rc=$?
    P5_HOMES=$(pp_num "SELECT COUNT(*) FROM ObjectHomes")
    P5_TO=$(pp_num "SELECT COUNT(*) FROM TableOccurrenceResolution")
    phase_finish "$(group_de "$P5_HOMES") Heimaten · $(group_de "$P5_TO") TO" \
        "{\"object_homes\":$P5_HOMES,\"to_resolutions\":$P5_TO}"
    [ "$rc" = 2 ] && fail_fast_stop "Phase 5 Homes"
    echo ""

    # 7aa. Phase 6 (Validate) — post-processor (stage 3): plausibility/
    # consistency checks against the finished DB. Non-fatal — findings feed into
    # the final report (finalize_run). Runs BEFORE the sync.
    if ! $QUIET_MODE; then
        echo "========================================="
        echo "Running post-processor checks (Phase 6)..."
        echo "========================================="
    fi
    phase_begin P6 Validate
    phase_progress validate 0 "Running checks (Phase 6)..."
    postprocess_db
    phase_finish "$CHECKS_RUN Checks · $POSTCHECK_WARN Warnungen" \
        "{\"checks_run\":$CHECKS_RUN,\"warnings\":$POSTCHECK_WARN}"
    if ! $QUIET_MODE; then echo ""; fi

    # Kataloge vollständig (P2–P6) für den aktuellen Manifest-Stand gebaut → Marker
    # auf 'ok' (Gate für den nächsten „nichts geändert"-Short-Circuit). Turbo-Konzept
    # (Manifest existiert nur dort) → auf den Turbo-Pfad beschränkt.
    $TURBO_MODE && _catalogs_state_set ok

    # 7b. Sync to rest-api/db/ (production mode, only when there are no errors).
    # The post-processor checks fill validate 0..70; the sync/reload tail fills 70..100.
    phase_progress validate 70 "Checks complete"
    if ! $TEST_MODE && [ ${#FAILED_FILES[@]} -eq 0 ]; then
        if ! $QUIET_MODE; then
            echo "========================================="
            echo "Syncing database to rest-api/..."
            echo "========================================="
        fi
        sync_to_rest_api
        if ! $QUIET_MODE; then echo ""; fi
    fi
    fi   # ── Ende Short-Circuit-Block (! $TURBO_NO_CHANGES): P2–P6 + Sync ──

    # 8. End timer for entire batch + run end time
    BATCH_END=$(date +%s.%N)
    RUN_ENDED_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
    RUN_ENDED_ISO=$(iso_now)
    # awk instead of bc (see FILE_DURATION above). BATCH_MINUTES truncated via int() —
    # matches the old bc behavior (scale=0 for integer division).
    BATCH_DURATION=$(awk -v a="$BATCH_END" -v b="$BATCH_START" 'BEGIN { printf "%.3f", a - b }')

    # Calculate minutes and seconds
    BATCH_MINUTES=$(awk -v d="$BATCH_DURATION" 'BEGIN { printf "%d", int(d / 60) }')
    BATCH_SECONDS=$(awk -v d="$BATCH_DURATION" -v m="$BATCH_MINUTES" 'BEGIN { printf "%.3f", d - (m * 60) }')

    # 8. Final report
    echo "========================================="
    echo "Batch Import Complete"
    echo "========================================="
    echo "Total files: $TOTAL"
    echo "Successful: $SUCCESS_COUNT"
    [ "${UNCHANGED_COUNT:-0}" -gt 0 ] && echo "Unchanged (skipped): $UNCHANGED_COUNT"
    echo "Skipped: $SKIPPED_COUNT"
    echo "Failed: ${#FAILED_FILES[@]}"
    awk -v m="$BATCH_MINUTES" -v s="$BATCH_SECONDS" -v d="$BATCH_DURATION" \
        'BEGIN { printf "Total duration: %dm %.3fs (%.3f seconds)\n", m, s+0, d+0 }'

    if [ $SKIPPED_COUNT -gt 0 ]; then
        echo ""
        echo "Skipped files (unsupported format):"
        printf '  - %s\n' "${SKIPPED_FILES[@]}"
    fi

    if [ ${#FAILED_FILES[@]} -gt 0 ]; then
        echo ""
        echo "Failed files:"
        printf '  - %s\n' "${FAILED_FILES[@]}"
    fi

    # Conversion log v2: write the text log + JSON sidecar once.
    finalize_logs

    # Stage 4 — Error-Handling: show collected warnings + retry suggestions
    finalize_run

    # Inform user about log location
    echo ""
    echo "Log file:  $LOG_FILE"
    echo "JSON file: $JSON_FILE"
    [ "${FM_NO_CONSOLE_LOG:-}" != "1" ] && echo "Console:   $CONSOLE_LOG"

    # Inform user about error log if errors occurred
    if { [ ${#FAILED_FILES[@]} -gt 0 ] || [ -s "$ERROR_LOG_FILE" ]; } && [ -f "$ERROR_LOG_FILE" ]; then
        echo "Error details: $ERROR_LOG_FILE"
    fi

    # Exit with appropriate code. Validity decision: FAILED files → invalid
    # (exit 1). Post-check `warn` findings do NOT change the exit code
    # (the result stays 0 = valid-with-warning).
    if [ ${#FAILED_FILES[@]} -gt 0 ]; then
        emit_progress validate 100 "Done with errors"
        emit_done false "Failed files: ${#FAILED_FILES[@]}, Post-Check warnings: $POSTCHECK_WARN"
        exit 1
    fi

    emit_progress validate 100 "Done"
    if [ "$POSTCHECK_WARN" -gt 0 ]; then
        emit_done true "Successful: $SUCCESS_COUNT, Skipped: $SKIPPED_COUNT, Warnings: $POSTCHECK_WARN (gültig-mit-Warnung)"
    else
        emit_done true "Successful: $SUCCESS_COUNT, Skipped: $SKIPPED_COUNT"
    fi
    exit 0

elif [[ "$MODE" == "single" ]]; then
    # ========================================================================
    # SINGLE FILE MODE: Process one XML file
    # ========================================================================
    # Conversion log v2: the single-file run also writes a text log + JSON sidecar
    # (files[] of length 1, only the phases actually executed — P3/P4 are batch-wide
    # and do not run here).
    mkdir -p "$LOG_DIR"
    collect_environment
    collect_duckdb_settings
    build_run_meta
    TOTAL=1; SUCCESS_COUNT=0; SKIPPED_COUNT=0
    declare -a FAILED_FILES=(); declare -a SKIPPED_FILES=(); declare -a FAILED_FILES_INFO=()
    BATCH_START=$(date +%s.%N)
    RUN_STARTED_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
    RUN_STARTED_ISO=$(iso_now)

    BASENAME="$FILENAME"
    FILE_SIZE=$(stat -c%s "$XML_DIR/$FILENAME" 2>/dev/null || stat -f%z "$XML_DIR/$FILENAME" 2>/dev/null || echo "")

    # Disk preflight (classic single-file path; turbo single files go through their
    # own per-round guard).
    $TURBO_MODE || preflight_disk_or_abort "Single-Preflight (Phase 1)"

    # Phase 1 (Extract) — capture output (derive encoding/status) but keep it visible.
    phase_begin P1 Extract
    FILE_START=$(date +%s.%N)
    SINGLE_OUT=$(process_single_file "$FILENAME" 2>&1); SINGLE_RC=$?
    printf '%s\n' "$SINGLE_OUT"
    FILE_END=$(date +%s.%N)
    FILE_DURATION=$(awk -v a="$FILE_END" -v b="$FILE_START" 'BEGIN { printf "%.3f", a - b }')
    FILE_ENC=$(printf '%s\n' "$SINGLE_OUT" | grep -oE 'enc=[^)]*' | head -1 | cut -d= -f2)

    FILE_ERR_CAT=""; FILE_ERR_RC=""; FILE_ERR_HINT=""
    if [ "$SINGLE_RC" -eq 0 ]; then
        SUCCESS_COUNT=1; FILE_STATUS="success"
        echo "SUCCESS: Database created successfully from $FILENAME"
    elif [ "$SINGLE_RC" -eq 4 ]; then
        SKIPPED_COUNT=1; SKIPPED_FILES+=("$BASENAME"); FILE_STATUS="skipped"
    else
        FAILED_FILES+=("$BASENAME"); FILE_STATUS="failed"
        classify_error "$SINGLE_RC" "$SINGLE_OUT"
        FAILED_FILES_INFO+=("$BASENAME|$ERR_CATEGORY|$ERR_RETRY_HINT")
        FILE_ERR_CAT="$ERR_CATEGORY"; FILE_ERR_RC="$SINGLE_RC"; FILE_ERR_HINT="$ERR_RETRY_HINT"
        if [ -n "$SINGLE_OUT" ]; then
            {
                echo "================================================================================"
                echo "ERROR: $BASENAME"
                echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
                echo "================================================================================"
                echo "$SINGLE_OUT"; echo ""
            } >> "$ERROR_LOG_FILE"
        fi
    fi

    FL_NAME+=("$BASENAME");        FL_SIZE+=("$FILE_SIZE")
    FL_ENC+=("$FILE_ENC");         FL_STATUS+=("$FILE_STATUS")
    FL_DUR+=("$FILE_DURATION");    FL_COMPLETED+=("$(iso_now)")
    FL_ERR_CAT+=("$FILE_ERR_CAT"); FL_ERR_RC+=("$FILE_ERR_RC"); FL_ERR_HINT+=("$FILE_ERR_HINT")
    FL_PEAKRSS+=("");              FL_MINAVAIL+=("")   # single-file path: no worker sampler

    # P1 object counts for EXACTLY this file (the DB may already contain other files).
    load_per_file_objects
    P1_OBJ=$(lookup_file_objects "${BASENAME}"); [ -z "$P1_OBJ" ] && P1_OBJ=0
    P1_DDR=$(pp_num "SELECT COUNT(*) FROM DDR_Calculations WHERE File_Name = '${BASENAME%.xml}'")
    phase_finish "$(group_de "$P1_OBJ") Objekte (+$(group_de "$P1_DDR") DDR-Chunks)" \
        "{\"objects_extracted\":$P1_OBJ,\"ddr_calc_chunks\":$P1_DDR}"

    if [ "$SINGLE_RC" -eq 0 ]; then
        # Phase 2 (Resolve) — table-only, rebuilds all File_Names (no read_xml).
        echo ""
        echo "Resolving references (Phase 2)..."
        phase_begin P2 Resolve
        run_phase2 "Phase 2 Reference Resolution" >/dev/null 2>&1 \
            && echo "✓ Phase 2 references resolved" || echo "✗ WARNING: Phase 2 reference resolution failed"
        P2_REF=$(count_table_sum XMLCalcReferences XMLStepReferences XMLLayoutReferences PluginFunctionUsages MBS_SubnameMap GetSubparameterMap)
        phase_finish "$(group_de "$P2_REF") Referenzen" "{\"references_resolved\":$P2_REF}"

        # Phase 5 (Homes) — rebuild resolutions in single mode too.
        # Depends on ObjectCatalog; in single mode ObjectCatalog is NOT updated —
        # for a full data state use --batch
        # (note: P3/P4 do not run here).
        echo ""
        echo "Building resolution tables (Phase 5)..."
        phase_begin P5 Homes
        run_pipeline_step "Phase 5 Homes" "$PROJECT_ROOT/sql/convert-xml/convert_xml_05_homes.sql" >/dev/null 2>&1 \
            && echo "✓ Resolution tables built" || echo "✗ WARNING: Resolution tables failed (run --batch first?)"
        P5_HOMES=$(pp_num "SELECT COUNT(*) FROM ObjectHomes")
        P5_TO=$(pp_num "SELECT COUNT(*) FROM TableOccurrenceResolution")
        phase_finish "$(group_de "$P5_HOMES") Heimaten · $(group_de "$P5_TO") TO" \
            "{\"object_homes\":$P5_HOMES,\"to_resolutions\":$P5_TO}"

        # Phase 6 (Validate) — post-processor: consistency checks (Calc_UUID guard C1).
        echo ""
        phase_begin P6 Validate
        postprocess_db
        phase_finish "$CHECKS_RUN Checks · $POSTCHECK_WARN Warnungen" \
            "{\"checks_run\":$CHECKS_RUN,\"warnings\":$POSTCHECK_WARN}"

        # Sync hook also in single-file mode (production mode).
        if ! $TEST_MODE; then
            if ! $QUIET_MODE; then
                echo ""
                echo "Syncing database to rest-api/..."
            fi
            sync_to_rest_api
        fi
    fi

    BATCH_END=$(date +%s.%N)
    RUN_ENDED_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
    RUN_ENDED_ISO=$(iso_now)
    BATCH_DURATION=$(awk -v a="$BATCH_END" -v b="$BATCH_START" 'BEGIN { printf "%.3f", a - b }')

    finalize_logs
    finalize_run
    echo ""
    echo "Log file:  $LOG_FILE"
    echo "JSON file: $JSON_FILE"
    [ "${FM_NO_CONSOLE_LOG:-}" != "1" ] && echo "Console:   $CONSOLE_LOG"
    [ -s "$ERROR_LOG_FILE" ] && echo "Error details: $ERROR_LOG_FILE"

    if [ "$SINGLE_RC" -eq 0 ]; then
        if [ "$POSTCHECK_WARN" -gt 0 ]; then
            emit_done true "Single-file import successful, Warnings: $POSTCHECK_WARN"
        else
            emit_done true "Single-file import successful"
        fi
        exit 0
    else
        emit_done false "Single-file import failed (exit $SINGLE_RC)"
        exit $SINGLE_RC
    fi
fi
