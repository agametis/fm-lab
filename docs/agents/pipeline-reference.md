# Pipeline Reference — XML → DuckDB Conversion

> Referenced from CLAUDE.md §3. Read this when working ON the converter
> (pipeline phases, graph views, DB sync) — not needed for plain analysis queries.

## Pipeline phases

The catalog is built by six numbered SQL phases (`sql/convert-xml/convert_xml_0N_<phase>.sql`),
orchestrated by the `convert-xml` skill. Only **Phase 1 reads the XML** — all later
phases work purely on the DuckDB tables (no `read_xml`), which keeps the parse load
and memory peak low. After the six catalog phases the full run adds two batch-wide,
table-only **post-phases** — analysis views (SCA) and **P7 community detection** — then
syncs the DB. All of them are volatile (rebuilt on every run), so the *core staging idea
is unchanged*: XML is touched once in P1, everything downstream is pure DuckDB.

| Phase | File | Reads | Produces |
|---|---|---|---|
| **P1 Extract** | `sql/convert-xml/convert_xml_01_extract.sql` | XML (`read_xml`) | Raw catalogs + raw-XML columns (`Step_XML`, `Object_XML`, `Parameters_XML`, …) |
| **P2 Resolve** | `sql/convert-xml/convert_xml_02_resolve.sql` | tables only | Reference tables (XMLStep/Layout/Calc-Refs, MBS/GetSub, PluginUsages) |
| **P3 Details** | `sql/convert-xml/convert_xml_03_details.sql` | tables only | Variable analysis (VariableUsages, VariablesCatalog) |
| **P4 Catalog** | `sql/convert-xml/convert_xml_04_catalog.sql` | tables only | ObjectCatalog + ObjectLinks |
| **P5 Homes** | `sql/convert-xml/convert_xml_05_homes.sql` | tables only | Cross-file resolution (ObjectHomes, TableOccurrenceResolution) + graph views (`LogicalLinks`, `ClusterEdges`) |
| **P6 Validate** | `sql/convert-xml/convert_xml_06_validate.sql` | tables only | Plausibility/consistency check views (`v_check_*`), queried by the post-processor |

P1 runs once per file; P2–P6 run once after all files are imported (batch-wide). The full
runtime order is then **P1…P6 → Analysis Views → P7 Clustering → DB sync** (see the two
post-phase sections below); P7 is skipped on incremental / single-file runs.

**Constraint:** P2 runs partitioned with read-only VIEWs over the master DB — no
ALTER/UPDATE on source tables in P2 (breaks all slices); derived columns belong in P3.

## Analysis views (static code analysis)

After P6, a separate **batch-wide, table-only** phase runs `sql/create_analysis_views.sql`
(hooked into the orchestrator analogous to P5/P6, in both the batch and single-file paths).
It builds the foundation for the PMD-inspired rule bundles and is rebuilt on **every**
convert-xml run (volatile, like the universal catalogs — never put it in P2). It produces:

- `step_metadata` — Step_ID → block/semantic markers: `is_control_flow`/`control_kind`/`loop_delta`/`if_delta`/`has_side_effects`/`is_find_mode`/`is_mutation`/`deprecated_in` — the single source of the control-flow deltas
- `v_script_block_tree` — MATERIALIZED: per-step Loop/If nesting depth, **PARTITION BY `(File_Name, Script_ID)`** — *not* `Script_UUID`, which is non-unique in 2 merge-artifact cases; If-depth clamped via `GREATEST(0,…)`, raw `if_running_depth` kept for the unbalanced-if rule

Consumed by the `static-code-analysis/` rule bundles in `rest-api/templates/dashboards-custom/`.

## Graph views (P5)

Read-only helpers over the universal catalogs:

- **`LogicalLinks`** — operational links, sub-objects hoisted to their container, containment scaffold + orphans removed, **local variables `$x` excluded**. Canonical definition mirrored in `rest-api/templates/sql/graph_logical_links.sql`.
- **`ClusterEdgesBase`** (= `LogicalLinks` minus `BuiltinFunction`) — **materialized**: the data lives in the TABLE `ClusterEdgesBaseMat`, rebuilt on every P5 run, with `ClusterEdgesBase` as a thin view over it (avoids the multi-evaluation OOM of the pure view chain in the READ_ONLY API)
- **`ClusterGodNodes`** — cross-cutting "god-nodes": neighbours span ≥8 files **and** ≤40 % in their own file (generic MBS-plugin utilities + global config/auth fields)
- **`ClusterEdges`** (= `ClusterEdgesBase` minus `ClusterGodNodes`) — **single source of truth** for the community-detection edge export (`tools/graph-export/graph_export_logical.sql`) and the `fm-graph-cluster` skill's logical-degree/hub analysis

The god-node filter sits **only** in `ClusterEdges` (clustering), not in `LogicalLinks`
(the Explorer/where-used still shows god-nodes).

**Local-variable filter:** local variables are keyed per-script (`Scope_Anchor`=script)
→ degree-1 pendants that only clutter the graph (≈34 % of cluster nodes) without bridging
modules, so they are dropped from `LogicalLinks`. Global (`$$`) / superglobal (`$$$`)
variables stay (real cross-script bridges). The semantic variable signal is unaffected —
`fm-analyze`/`fm-graph-cluster` read variable names from `VariableUsages`/`VariablesCatalog`
(per script), not from the graph.

## Phase 7 — Community detection (auto-clustering)

After the analysis views, a **batch-only** Phase 7 (`run_phase7_clustering`) runs
`tools/graph-export/cluster.sh` over `ClusterEdges` and writes the module partition
`ObjectClusters` + `CommunityNames` (**raw**: `Heuristic_Name` only, `Semantic_Name` NULL).
Engine `auto` → **Leiden** if `python3`+`igraph` import, else the Node **Louvain** baseline;
engine/resolution/seed come from `solutions/<id>/state/cluster.json` (the last
`fm-graph-cluster` sweep winner; pre-migration fallback `.fmlab/cluster.json`). It runs
inside the held per-solution `xml_convert.lock`, **before** the DB sync (so the copy gets
the fresh partition), and is **non-fatal** — a P7 error leaves the import successful and the
old partition untouched.

**Gating:** P7 runs only on a from-scratch build (`fresh_build`/`force_rebuild`/
`auto_heal_rebuild`) or when `ObjectClusters` is empty. Incremental imports — and the whole
single-file path — **skip it**: `cluster.sh` has no warm start, so re-partitioning on every
import would churn community boundaries in untouched files and mask the drift signal (the
Rebuild button / `fm-graph-cluster` heal on demand). `FM_SKIP_CLUSTER=1` skips P7 outright
(used by the converter quality test — clustering is irrelevant to catalog quality).

**Raw vs. semantic:** P7 only produces the raw partition + heuristic names. The resolution
sweep and semantic names (`CommunityNames.Semantic_Name`/`Semantic_Description`) are the
`fm-graph-cluster` skill's job. `convert-xml --force-rebuild` wipes the cluster layer; P7 then
rebuilds a *raw* partition on that same run, but re-run `fm-graph-cluster` afterwards for the
resolution sweep + semantic naming.

## `--split` (large files)

`convert-xml --batch --split` chunks each file's Phase 1 at top-level branch boundaries
(the heavy `StepsForScripts` and `DDR_INFO` branches are split into their own chunks) to
lower the peak DOM memory. P2–P6 are unaffected (table-only, batch-wide). The result is
bit-identical to the unsplit run.

## DB architecture (two files per solution)

The database lives as two separate instances **per solution** to avoid read/write
conflicts between `convert-xml`, the REST API and Claude Code analyses:

| File | Purpose | Writers | Readers |
|---|---|---|---|
| `solutions/<id>/db/fm_catalog.duckdb` (**master**) | Single source of truth | `convert-xml` (exclusively) | Claude Code CLI via the compat symlink `db/fm_catalog.duckdb` (fm-summarize, fm-analyze, ad-hoc queries) |
| `rest-api/db/solutions/<id>/fm_catalog.duckdb` (**copy**) | Read copy for the REST API server | Sync hook in `convert_fm_xml.sh` | REST API server (`READ_ONLY` mode) |

`db/fm_catalog.duckdb` is a symlink onto the **active** solution's master
(pointer file `.fmlab/active_solution.json`; switch via `tools/solution.sh use <id>`).
Readers use the symlink; writers always resolve the real bundle path.

**Sync mechanism:** after each successful `convert-xml --batch` (or single-file import in
production mode), the shell script copies the master DB atomically to
`rest-api/db/solutions/<id>/fm_catalog.duckdb` and then calls `POST /api/admin/reload`
with `{"solution": "<id>"}` — the server reloads only when that solution is the active
one (otherwise the fresh copy just waits for the next switch). The server closes
its DuckDB connection and reopens it — no restart required. If the server is not running,
that is not an error (the sync happens anyway; only the reload trigger is skipped).

**Conflict avoidance:** DuckDB holds a file lock on the opened DB. Because the server runs
in `READ_ONLY` mode against a *different* file, the master DB remains freely writable.
`convert-xml` and the Claude Code CLI can work in parallel with the running server.

## Manual run (advanced — the skill is preferred)

```bash
# Per file: Phase 1 (extract). Then once, batch-wide: Phases 2–6.
duckdb db/fm_catalog.duckdb < sql/convert-xml/convert_xml_01_extract.sql   # P1, per file (set fm_xml)
duckdb db/fm_catalog.duckdb < sql/convert-xml/convert_xml_02_resolve.sql   # P2
duckdb db/fm_catalog.duckdb < sql/convert-xml/convert_xml_03_details.sql   # P3
duckdb db/fm_catalog.duckdb < sql/convert-xml/convert_xml_04_catalog.sql   # P4
duckdb db/fm_catalog.duckdb < sql/convert-xml/convert_xml_05_homes.sql     # P5
duckdb db/fm_catalog.duckdb < sql/convert-xml/convert_xml_06_validate.sql  # P6
```

## Web frontend variant

Sub-dashboard `xml_convert`: same Bash script, spawned via `POST /api/xml/convert` and
streamed as SSE. The CLI and the web button share a **per-solution** lock file
(`solutions/<id>/state/xml_convert.lock`) so the same solution can't be imported in
parallel — the second caller gets `409 Conflict` (web) or aborts with exit code 7 (CLI).
Different solutions may convert independently.
