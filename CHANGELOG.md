# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

---

## [Unreleased]

*(Upcoming changes go here)*

---

## [0.8.3] — 2026-06-23

The object graph becomes explorable and self-organizing: an interactive Graph Explorer in the browser, and automatic community detection that segments the solution into named modules.

- **Graph Explorer** — interactive, browser-based exploration of the whole object graph (new `/graph` route)
  - Pick any object as the focus and reach outward by **depth**, **direction** (uses / used-by / both); narrow by object type, link role, and built-in functions
  - **Inspect panel** with node metadata and neighbor list, plus one-click *set as focus* / *expand one hop* / *collapse hub* / *open in details*
  - Cytoscape `fcose` layout, hub highlighting, hover dimming, **PNG export**, deep-linkable view state (`?focus=&depth=&dir=&mode=`)
  - New REST graph API (`GET /api/graph/subgraph` · `/neighbors` · `/search`) and a **`graphify` plugin** that exports the graph as JSON to `output/`
- **Community detection** — the graph segments itself into modules and names them
  - New `ObjectClusters` / `CommunityNames` tables; a deterministic **Louvain** baseline (seeded) with an optional **Leiden** engine, run as a standalone batch after `convert-xml`
  - **Color lens** in the Graph Explorer toggles node coloring between object type and community, with a community legend
  - New **`fm-graph-cluster` skill** — sweeps candidate resolutions and scores them (modularity Q + distribution guardrails), names communities semantically, writes an analysis report to `output/`, and syncs the named partition to the Graph Explorer
  - **Cleaned logical-graph views** in convert-xml Phase 5 (`LogicalLinks`, `ClusterEdges`) — sub-objects hoisted to their container, multi-edges deduped, built-in primitives separated out. The hub/degree analysis now runs on the *same* edge set as the clustering
- **FileMaker 26 Custom Functions fix** (schema 1.4.1) — FileMaker 26 (SaXML v2.3.0.0) moved each Custom Function's formula out of the separate `<CalcsForCustomFunctions>` section into an embedded `<Calculation>`. The parser now extracts **structure-tolerantly from both locations** and merges them

---

## [0.8.2] — 2026-06-18

fmIDE plugin and XML import refinements.

- **fmIDE plugin** — settings and lifecycle reworked
  - New option to **show the plugin buttons only when it is actually installed in the solution** — keeps the UI clean for files that don't use fmIDE
  - **File scan with version detection** — recognizes the installed fmIDE version per file
  - **Startup behavior changed to manual activation** — the plugin no longer auto-activates; the user enables it explicitly
- **Browser-driven XML import** — the `xml_convert` sub-dashboard offers more intuitive behavior and new options
  - **Turbo mode** (default) — the import uses the full power of multithreading and chunk dispatching to speed up conversion
  - **Incremental toggle** (default on) — the import re-parses only files that actually changed, streamed as live SSE progress; on a real solution a no-op re-import drops to a handful of seconds

---

## [0.8.1] — 2026-06-17

Relationships with multiple join predicates and sort fields become fully resolvable — in the catalog and in the graph view.

- **Multi-predicate joins** — `RelationshipCatalog` is now **per predicate** (new `Predicate_Index` column); a multi-field relationship emits one `left_field` / `right_field` link pair per predicate instead of collapsing to a single pair (schema 1.2.0)
- **Sort fields as real dependencies** — the "sort records" field of a relationship side is parsed and linked (`sort_field`, `Link_Subrole = left`/`right`), so it shows up in the field's where-used analysis (schema 1.3.0)
- **Relationship detail view** — graphical relationship detail in the web frontend, with references sorting; bugfix for join-predicate field rendering
- **XML schema docs** extended to cover the multi-predicate structure
- **Dashboard KPIs for the object graph** — Home dashboard gains object-count and link-count KPIs (`ObjectCatalog` / `ObjectLinks`), plus a locales bugfix

---

## [0.8.0] — 2026-06-16

The XML import, rebuilt as a streaming, incremental, memory-aware pipeline — large multi-file solutions import faster, within a bounded memory budget, and a re-import only touches what actually changed. Every optimization is identity-checked to produce byte-identical catalogs, so none of it changes analysis results.

- **Katana-Engine** — XML is folded, refined and forged into fine-grained fragments, enabling massive catalogs to be processed with minimal memory usage and maximum parallelism.
- **Six-phase pipeline** — the conversion is split into Extract → Resolve → Details → Catalog → Homes → Validate. Only phase 1 reads the XML; every later phase works purely on the DuckDB tables. This keeps the parse load and memory peak low and makes each phase independently testable
- **Streaming split for large files** (`--split`) — each file's extract phase is chunked at top-level branch boundaries (the heavy script-steps and DDR branches get their own chunks), drastically lowering peak DOM memory — bit-identical to the unsplit run
- **Turbo mode** (`--turbo`) — chunk-granular parallel dispatch: every chunk across every file flows through a worker pool (heaviest-first) and is consolidated in two stages, for substantially shorter wall-clock on multi-core machines
- **Incremental import** (`--incremental`) — a persistent manifest fingerprints every file (mtime/size → sha256 + version gate); unchanged files are skipped entirely and their catalog rows are preserved. Re-importing after editing a single file goes from minutes to seconds
- **Automatic memory backoff** (`--auto`) — a chunk that runs out of memory is automatically re-split into smaller pieces and retried, so an import completes on memory-constrained machines without manual tuning
- **Memory-aware parallelism** — the `--jobs` default is now derived from actually-available memory and is container/cgroup-aware (not just host RAM), preventing the batch OOM that a fixed worker count could trigger
- **Validation phase** — a dedicated final phase produces plausibility/consistency check views, surfacing structural anomalies right after a conversion
- **Linux-friendly** — CLI-tool calls now fall back gracefully across GNU and BSD flag variants, so the import runs on Linux as well as macOS

---

## [0.7.7] — 2026-06-12

Graph completeness: script-trigger owners and popover panels become first-class, queryable nodes — closing the last reachability gaps in the object graph.

- **Script-trigger owner back-links** (`trigger_owner`) — every trigger is now reachable *from* its owner, not just from the script it calls
  - New structural link `ScriptTrigger → Layout / LayoutObject / File`, with `Link_Subrole` carrying the trigger type (e.g. `OnObjectSave`, `OnLayoutEnter`) — "which triggers hang on layout/object/file X?" is now a direct graph query
  - New **`File` object type** in `ObjectCatalog` (owner anchor for file-level triggers `OnFirstWindowOpen`, `OnLastWindowClose`, …; UUID = `FMSaveAsXML/@UUID`) — the file itself becomes a registered object
  - NULL-safe owner guard: unresolvable owners are skipped, never producing orphaned links
- **PopoverPanel objects** now emitted by the LayoutObject parser — closes a coverage gap where panels were entirely absent from `LayoutObjects` / `ObjectCatalog`
  - A PopoverPanel hangs under `<PopoverButton>`, not `<ObjectList>` — the parser now descends into it, capturing its UUID, calculated title (with field references), and child objects
  - Resolves previously-unresolvable trigger owners (`OnObjectEnter/Exit/Keystroke` on popover panels) — prerequisite for full `trigger_owner` coverage
  - Panels surface in detail view, search, and where-used like any other layout object
- **Object-reference parser bugfixes** — refinements to read/write field-reference coverage in `create_universal_catalogs.sql`

---

## [0.7.6] — 2026-06-12

Custom Record Privileges as a first-class analysis surface: calculation-based record, field, and object privileges parsed into the catalog, wired into the object graph, and rendered as interactive tokens in the frontend.

- **Three new privilege-detail tables** for solutions using Custom Record Privileges (the `<Records>`/`<Layouts>`/… `Custom="True"` mechanism, where the summary attributes no longer reflect real access)
  - **`PrivilegeSetRecordAccess`** — table level: one row per privilege set × table × operation (View/Edit/Create/Delete); access mode, calculation text/DDR-hash, evaluation context
  - **`PrivilegeSetFieldAccess`** — field level: per-field access mode for tables with `Fields access="Custom"`
  - **`PrivilegeSetObjectAccess`** — Layouts/ValueLists/Scripts: per-object access mode, layout record-access, class create flag
- **Graph integration** — closes the where-used gap for objects referenced *only* inside a Custom Record Privilege calc, which previously appeared unused
  - `PrivilegeSet → Field (reads_field)`, `→ Variable (reads_variable)`, `→ CustomFunction (calls_customfunction)`, `→ PluginFunction (calls_pluginfunction)` — `Link_Subrole = <Operation>:<Table>`; variable reads bidirectionally traversable
  - Scoped **restriction links** `restricts_field` / `restricts_object` (`Link_Subrole` = access mode) for actual restrictions only — a restriction is *not* a usage, so it never pollutes where-used/dead-code analysis; folders/separators excluded
  - `VariableUsages` extended with `Context_Type='record_access_calc'`
- **Record-access calc rendering in the frontend** — the calculation behind a privilege is now visible and explorable
  - New **`PrivilegeSetViewer`** / **`PrivilegeSetDetail`** components with typed, clickable token rendering (variable/field/TO/function colored and linked), `useCalcTokens` hook, and `object_details_privilegeset.sql`
  - `detail` i18n namespace extended (en + de)

---

## [0.7.5] — 2026-06-11

XML conversion moves into the web frontend: import the catalog by button press, with live progress and a persistent log — no terminal required.

- **New `xml_convert` sub-dashboard** — drives and monitors the XML→DuckDB import from the browser
  - Per-file import status table: ✅ imported & current · ✴️ imported but a newer file exists · ➡️ not yet imported
  - **Convert button** with a live progress bar and a persistent live log, streamed as **SSE** (analogous to the docs installer)
  - Status line: "n of m files processed" during the run; timestamp, duration, and success/error count on completion
- **Home dashboard empty-state guidance** — when the DB holds no imported files: KPI dashes instead of zeros, a hint text, a listing of the `xml/` directory, and a convert button (disabled when the directory is empty)
- **REST-API import layer**: `xml.controller` / `xml.routes` / `xml-convert.js` — `POST /api/xml/convert` streamed as SSE; shares the `.fmlab/xml_convert.lock` with the CLI so they can't run in parallel (web → `409 Conflict`, CLI → exit code 7)
- **New frontend primitives**: `XmlConvertControl`, `XmlConvertLog`, `XmlEmptyStateCard`, `useXmlConvertCurrentFile`; `convert_fm_xml.sh` extended for frontend invocation
- **Docset installer progress bar** in the frontend (`DocsetInstallControl`) with shared `tools/install_modes.sh` logic — same live-progress treatment as the XML import
- Bugfixes: Umlaut handling in the import log, log update + highlighting in the dashboard table

---

## [0.7.4] — 2026-05-21

Home dashboard restructured around navigation, and a deep, first-class integration of doc sets (Claris Help, MBS, DuckDB, fmIDE) into the catalog and dashboard layer.

- **Home dashboard restructured** — focused on orientation and entry rather than on data dumps
  - Layout fully reworked: tighter navigation tiles for dashboards, custom queries, and doc sets; greeting / project summary block; cleaner KPI rhythm
  - Top-N analyses (`top_scripts`, `top_tables`, `top_layouts`, `top_custom_functions`) moved out of the bundle and into `sql-custom/` — now reusable from any dashboard or the custom-queries surface; new `top_mbs_functions.sql` added
  - Health metrics extracted into a dedicated **`health_hints` custom dashboard** (`dashboards-custom/health_hints/`) — collects `health_indicators`, `variable_hotspots`, `cross_file_links`, `find_undocumented_fields`, `find_unused_fields`, `find_unused_scripts`, `list_global_variables`
  - Home locales refreshed across all 11 languages to match the new structure
  - `dashboard.service` extended with navigation/sub-dashboard resolution; `actions.ts` and the `List` primitive support the new navigation patterns
- **Deep doc-set integration** — doc sets become navigable catalog citizens, not just files on disk
  - **New architecture**: every doc set declares itself through a manifest with metadata, categories, entries, references, and update info
  - **REST-API doc layer**: `docs.controller` / `docs.routes` with endpoints for overview, doc-set home, categories, individual entries, references, and assets; supporting services `docs-manifest`, `docs-content`, `docs-references`, `docs-source`, `docs-install`, `system-reload`
  - **Pluggable doc adapters** (`plugin-docs/adapters/`): `claris-duckdb` (Claris Help reference DB), `dash-sqlite` (legacy Dash docsets), `markdown-fs` (file-tree markdown sets) — uniform interface for arbitrary doc sources
  - **Internal links and assets** resolve correctly across the adapter layer, so links inside doc entries route through the API instead of breaking
  - **Doc dashboards** as the navigation surface: `docs/` (entry), `docs_overview/` (all installed sets), `docset_home/`, `docset_category/`, `docset_detail/` — all bundled, themed, and localized
  - **Frontend doc components**: `DocsEntryView` with dedicated styling and `DocsBreadcrumb` — render entries with internal-link rewriting, asset proxying, and back-navigation
  - **Doc installers redesigned** for the new manifest+index model: `install-claris-docs`, `install-duckdb-docs`, `install-fmide-docs`, `install-mbs-docs` — each installer now generates the manifest, builds/updates the index, and registers the doc set; shared logic in `tools/install_modes.sh` and `tools/register_docs.py`
  - **Install button** for each available doc-set within the frontend
  - i18n: new dashboard / nav strings (en + de) for the doc surface
- **New custom dashboard `script_comment_density/`** — code-quality metric surfacing scripts with low (or absent) comment coverage; KPI block plus findings list, localized in all 11 languages
- **`create-custom-dashboard` skill** updated with refined conventions and guidance for the new dashboard layout (navigation tiles, locales, sub-dashboards)

---

## [0.7.3] — 2026-05-20

ScriptStep full-text search, two new diagnostic custom dashboards, and plugin-layer internationalization.

- **ScriptStep full-text search** — drill from any object into the script steps that reference it
  - New `ScriptStepDetail` component with dedicated styling: renders an individual script step with full token interactivity, surrounding context, and back-navigation to the parent script
  - New SQL template `object_details_scriptstep_tokens.sql` powers the tokenized step view
  - `object.controller` / `object.service` extended with ScriptStep-aware lookup, search, and listing endpoints (OpenAPI spec updated, generated TS types regenerated)
  - `ScriptViewer`, `HierarchyTree`, `ObjectListItem`, and the dashboard `Table` primitive refined to support the new step-level navigation and highlight model
- **Two new diagnostic custom dashboards** under `templates/dashboards-custom/`
  - **`credentials_in_scripts/`** — surfaces scripts that embed credentials / secrets in literal form: KPI block plus findings list with source script and context; localized in all 11 languages
  - **`if_else_asymmetry/`** — detects asymmetric If / Else If / End If blocks (likely script-logic bugs) with KPI overview and per-block findings; localized in all 11 languages
- **Plugin-layer i18n**
  - New `plugin-i18n.service` in the REST-API: resolves plugin manifest and UI labels against the active language with English fallback — mirrors the dashboard i18n architecture
  - `plugins.controller` and `plugins.routes` accept and forward the language parameter
  - **fmIDE plugin** localized: `plugin.json` slimmed down to non-translatable metadata, with per-language `locales/<lang>.json` files for all 11 languages
  - Frontend `PluginCard`, `LayoutTypeFilter`, and `SettingsView` migrated to `t()` calls; `detail.json` translation namespace extended in every language
- **Documentation**: refinements and clarifications about the composability and extensibility of the underlying architecture

---

## [0.7.2] — 2026-05-19

Internationalization across the whole stack: 11 languages in the web client, localized dashboards, English as the new primary language for the codebase, CLAUDE.md, and all skills.

- **Web client i18n** (`apps/web/src/i18n/`) — react-i18next-based translation infrastructure
  - **11 languages**: English (default), German, Spanish, French, Italian, Japanese, Korean, Dutch, Portuguese, Swedish, Chinese (Simplified)
  - 6 translation namespaces per language: `common`, `dashboard`, `detail`, `errors`, `nav`, `types`
  - New `LanguageSelector` component and `useApiLang` hook for synchronising UI language with API requests
  - Practically every frontend component migrated to `t()` calls — Breadcrumbs, DetailView, FieldDetail/Viewer, ObjectDetail, ScriptDetail/Viewer, SearchOptions, FolderTree, HierarchyTree, DependencyGraph, RelationshipGraph, LayoutCanvas, ReferencesFilter, SettingsView, ErrorMessage, LoadingSpinner, ThemeToggle, plugins, and more
- **Localized dashboards** — translations live alongside the dashboards
  - Each dashboard bundle now carries a `locales/<lang>.json` file (10 non-English locales) — applies to `home`, `_generic`, `custom_queries`, `dashboards`, `external_apis`, `external_apis_skandix`, `script_todos`
  - New `dashboard-i18n.service` in the REST-API resolves manifest, layout, and dataset labels against the active language with English fallback
  - Dashboard primitives translate cell content through the new `_cellTranslate` helper, with extended formatters in `_format.ts`
- **REST-API language plumbing**
  - `rest-api/src/config/languages.js` and shared `packages/shared/src/languages.ts` — single source of truth for the supported language set
  - New `system.controller` / `system.routes` with a `GET /api/system/languages` endpoint
  - `dashboard.controller` and routes accept and forward the requested language
- **Codebase primary language switched to English**
  - `claude.md` fully rewritten in English
  - All skill `SKILL.md` files translated to English
  - **Multi-language trigger phrases** added to every skill (English + 10 other locales) — skills now fire reliably regardless of the user's working language
  - **XML schema docs** (`docs/agents/xml-schema.md`, `xml-schema-extended.md`) translated to English
- **Inline help in the frontend** — help text inside `DetailView`, `ObjectDetail`, `ScriptDetail`, `ScriptViewer`, and `TypeDetail` rewritten in English; `object_references_script.sql` adjusted accordingly
- **Custom dashboards moved to their own directory**
  - `external_apis`, `external_apis_skandix`, `script_todos` relocated from `templates/dashboards/` to `templates/dashboards-custom/` — clean separation between core and user-authored bundles
  - SQL templates reorganized: home-dashboard analyses moved into `dashboards/home/queries/`, layout-specific SQL into `dashboards/home/layout/`
  - Home dashboard gained navigation tiles for sub-templates
  - `create-custom-dashboard` skill updated for the new target directory and structure
- **Tooling**: `tools/claude-language-hint.mjs` — emits a localized hint so Claude Code picks up the user's preferred language automatically; `.fmlab/user.local.example.json` extended with language preference example
- Bugfix: list scroll-position reset in `useInfiniteSearch` after filter/query change

---

## [0.7.1] — 2026-05-17

Dashboard polish, first batch of example custom dashboards, and refinements to the Script detail view.

- **Example custom dashboards** as reference implementations and immediately useful views on top of the catalog:
  - `dashboards/` — meta dashboard listing all available dashboards
  - `external_apis/` — analyzes outbound API usage in the solution: aggregated API families, individual external sources, URL-level details, and a summary card; built around the existing variable/calculation tracking
  - `script_todos/` — surfaces scripts marked as TODO / WIP with KPI block and grouped script list
- **Dashboard primitives upgraded** for interactive use:
  - Per-primitive **row search and filter** via the new `_useRowSearch` hook — applied to `List`, `Table`, `TileGrid`, and `KPIStrip`
  - **Action state** (`actionState.ts`): primitives can carry navigation/filter state across user interactions
  - Dashboard results are interactive: click navigation to the objects detail view for further code exploration
- **Script detail view** — optimizations and bugfixes:
  - New `highlightContext` provider for shared highlight state between viewer, search, and reference panels

---

## [0.7.0] — 2026-05-16

Dashboards as a first-class extension surface: bundled, declarative, data-driven views — with a Home dashboard as the new entry point and a generic renderer for every custom SQL query.

- **Dashboard bundles** as a new top-level concept: each dashboard lives in its own folder under `rest-api/templates/dashboards/<id>/` with a `manifest.json` (id, title, datasets, params, permissions), a declarative `layout.json` (primitive tree), bundled SQL datasets in `data/`, and optional static assets — fully self-contained and shippable
- **Home dashboard** as the new entry point: project summary, object-count KPIs, files overview, top-N scripts / tables / layouts / custom functions, variable hotspots, health indicators, and navigation tiles for further dashboards and custom queries
- **Custom-Queries dashboard**: navigation overview of every `sql-custom` template, grouped and searchable
- **Generic `_generic` dashboard**: any `sql-custom` template can be rendered as a full-page result view without writing a dedicated dashboard — auto-table with sortable columns, type-aware filters, virtual scrolling, scroll-reset on filter change, and full viewport-height usage
- **14 layout primitives** in the frontend (`apps/web/src/dashboard/primitives/`): `Card`, `Grid`, `Row`, `Stack`, `Spacer`, `KPI`, `KPIStrip`, `List`, `Table`, `AutoTable`, `TileGrid`, `NavButton`, `MarkdownBlock`, `Empty` — composable via the layout tree, with token substitution (`{{row.field}}`) for repeating contexts
- **Dashboard backend**: new `dashboard.controller` / `dashboard.service` / `dashboard-schemas` / routes; bundle discovery, manifest validation, dataset resolution from three sources (`bundle:` SQL files, `builtin:` server-provided datasets, `custom:` sql-custom templates), and parameter-bound query execution
- **Built-in datasets**: `list_dashboards`, `list_custom_queries`, `query_meta` — drive navigation and metadata views without per-bundle SQL
- New **`create-custom-dashboard`** skill: guides the user through dashboard creation interactively — clarifies the desired content, drafts SQL queries, shows sample results, suggests a presentation form, and generates the complete bundle directory
- New `sql-custom` templates: `find_undocumented_fields.sql`, `find_unused_scripts.sql`, `list_global_variables.sql`; existing templates (`cross_file_links.sql`, `find_unused_fields.sql`, `script_complexity_stats.sql`) refined for dashboard use
- **`VariablesCatalog` fix**: corrected read-count inflation caused by double-counting variable references from LayoutObject formula hashes — counts now match actual usage across scripts, calculations, and layouts
- **Pseudo object types** (MBS-Components, MBS-Functions): optimizations and fixes for filters and navigation
- **Scripts detail view**: optimizations and fixes
- **Frontend polish**: `SubPageHeader` component for consistent sub-page chrome, `PseudoTokenView` improvements, scroll-reset on filter change in result lists, and full viewport-height layouts across detail views
- Bugfix: CORS handling for plugin settings endpoint

---

Documentation for FM-Lab

## [0.6.10] — 2026-05-15

- **Documentation** — first round of project-level documentation under `docs/fm-lab/` of the public repo. The initial set covers the conceptual layer of fm-lab:
  - `Documentation.md` — top-level index and table of contents
  - `Wiki/Introduction.md` — what fm-lab is and the problem it solves
  - `Wiki/Vision.md` — long-term goal and direction
  - `Wiki/How it works.md` — end-to-end walkthrough from XML ingestion to agentic workflows (with diagrams)
  - `Wiki/Architecture.md` — system architecture and component boundaries (with diagram)
  - `Wiki/Workflow.md` — typical developer workflows on top of fm-lab (with diagrams)
  - `Wiki/Features.md` — feature inventory grouped by capability
  - `Wiki/Components.md` — directory-by-directory tour of the codebase

---

## [0.6.9] — 2026-05-13

Reference-DB distribution via `install-claris-docs` and consolidation of the function-reference skills.

- **`install-claris-docs`** now copies the REST-API reference index DB (`fm_reference.duckdb`) into `docs/claris-help/` — slug-based lookups for functions and ScriptSteps
- **`filemaker-function-reference`** skill rewritten: uses the local DuckDB reference index (373 functions, 206 ScriptSteps, 19 + 13 categories with localized names, signatures, parameters, URL slugs) instead of the legacy SQLite docset; supports multi-language lookups and falls back to the online Claris Help when a slug is missing locally
- **`install-filemaker-docs`** skill marked **deprecated** — replaced by `install-claris-docs` (current Claris Online Help, 11 languages, integrated index DB); kept for backwards compatibility but no longer used by any downstream skill

---

## [0.6.8] — 2026-05-13

Schema-drift detection and auto-healing for the XML import — survives breaking SQL template changes after a `git pull`.

- **Schema versioning** via `@SCHEMA_VERSION` marker in `sql/convert_xml.sql`, persisted in a new `SchemaInfo` table inside the DuckDB catalog
- **Auto-heal (default)** in batch mode: when the import detects schema drift against the existing DB, it automatically drops the DB and rebuilds from all XML files in `xml/`
- **`--force-rebuild`** flag: manual full rebuild, useful after arbitrary inconsistencies or recovery scenarios
- **`--no-auto-heal`** flag: drift only reported, no automatic rebuild (intended for CI and debugging)
- **Single-file mode**: aborts with exit code `6` on drift (auto-heal would discard other files in the catalog) and points the user to `convert-xml --batch --force-rebuild`
- DBs without a version marker are treated as outdated and trigger a rebuild
- Clear diagnostics replace the previous cryptic mid-run DuckDB errors when a `git pull` introduced template changes

---

## [0.6.7] — 2026-05-13

Central reference database, pseudo object types, token-based code rendering, cross-reference highlight, and full dark mode.

- **Central reference database** from `fm-spec`: localized Claris Help cache (English + German) served via a dedicated REST endpoint with language selector — ScriptStep and function reference info available inline in the frontend
- New **`install-claris-docs`** skill: crawls and installs Claris Help locally in one or multiple languages
- **MBS plugin help** served locally alongside Claris Help
- **Pseudo object types** in `ObjectCatalog`: `ScriptStep`, `Function`, `MBS-Component`, and `MBS-Function` registered as first-class catalog entries with type-specific detail templates — searchable and filterable like any other object
- **Token-based code rendering** across all formula contexts:
  - Scripts: token endpoint replaces plain step text — refs, hover popovers, code folding, code filter, inspections popover, viewer header
  - Custom Functions: dedicated `CustomFunctionViewer` with the same token model
  - Calculated / AutoEnter fields: rendered via `CalcTokenSpan` / `FieldViewer` with full token interactivity
- **Cross-reference highlight ("Ref-Mode")**: highlights every occurrence of a referenced object across script bodies, calculations, and reference panels; new back-references API drives navigation
- **Universal function links** in `convert_xml.sql`: built-in functions, plugin functions, and `Get(...)` sub-parameters registered as `ObjectLinks` in correct chunk order — enables exhaustive call-chain queries
- **Field references for every ScriptStep variant**: the parser now resolves field refs across all script-step shapes, not just the canonical ones — eliminates blind spots in dependency queries
- **Pseudo-token filter toolbar** in the references panel with type-aware filtering and search
- **Full dark mode**: `ThemeToggle`, persistent theme preference, themed layout-object and relationship-graph palettes, dark mode extended to Claris/MBS help panels

---

## [0.6.6] — 2026-05-09

Interactive layout view, layout object Z-order in the parser, and rich frontend navigation.

- **Interactive layout view**: new `LayoutCanvas` / `LayoutObjectShape` / `LayoutObjectTooltip` components — visual rendering of layout objects with hover tooltips, type filter (`LayoutTypeFilter`), free-text search, and cross-navigation to fields, scripts, and value lists
- **Layout object Z-order** in `convert_xml.sql`: parser now preserves the stacking order from the XML so the canvas renders objects respecting the original front-to-back hierarchy
- New SQL templates `display_layout_objects_data.sql` and `display_layout_parts_data.sql` powering the layout view; `display_layout_svg.sql` adapted to the new ordering
- **References filter & search** in the detail view: `ReferencesFilter` component to narrow down referenced/referencing objects by type and free-text query
- **Keyboard navigation**: cursor navigation through reference lists and a `useEscapeStack` hook for `ESC` → back navigation across nested views
- **URL-persistent page state**: `useUrlState` hook synchronizes active view, selection, filter, and search into URL parameters — deep-linkable and survives reload

---

## [0.6.5] — 2026-05-08

Relationship graph visualization, extended TableOccurrence schema, enriched script-reference tokens, and plugin documentation API.

- **Extended TableOccurrence data model**: parser now resolves the underlying `BaseTable` reference for every `TableOccurrence` and tracks the home file of each field (relevant for cross-file relationships) — surfaces in `convert_xml.sql` and propagates through `ObjectCatalog` / `ObjectLinks`
- **Schema additions** for graph-aware queries: TO rows carry their resolved base table, fields carry their home file, and relationships expose left/right TO + field metadata in the new graph SQL templates
- **Relationship graph view**: interactive visualization of `TableOccurrences`, fields, and relationships — TO boxes, join lines, automatic graph layout, search field with result selection, and cross-navigation / deep-linking between objects
- Dedicated REST API endpoints for the graph (`relationship_graph_tos.sql`, `relationship_graph_relationships.sql`, `relationship_graph_fields.sql`) with a `relationshipGraph` controller and route
- Web frontend components `RelationshipGraph` / `TOBox` / `JoinLine` and `useGraphSearch` / `useRelationshipGraph` hooks
- **Plugin function documentation API**: new `/plugin-docs` endpoint with HTML extractor and marker-based section parsing for inline help on plugin / MBS function calls
- MBS source service and `plugin-token-registry` for resolving and annotating plugin function references in the token formatter
- **Enriched token output** in `object_references_script.sql`: TableOccurrence info on field references, GTRR (Go to Related Record) target resolution, DDR-calculation token-refs, and additional reference metadata for script steps
- New `build_resolutions.sql` for cross-reference resolution preprocessing

---

## [0.6.4] — 2026-05-07

XML import preprocessor: preserves line breaks in calculation code and tolerates invalid XML control characters.

- Preprocessor integrated directly into `convert_fm_xml.sh`
- Line-break preservation via sentinel `U+2028`: bypasses the `webbed` extension's whitespace collapse (`CleanTextContent`) so original CR/LF in CDATA payloads (Custom Functions, Calculated Fields, AutoEnter calcs, Script steps, Layout-Object formulas) survives the parse — sentinel is replaced back to LF inside `convert_xml.sql`
- Stripping of XML 1.0 invalid C0 control characters (e.g. `Char(3)` embedded in FileMaker scripts) — adresses the `Invalid Input Error: contains invalid XML` abort
- Upstream issue draft prepared for the `duckdb_webbed` maintainer — feature request for option to preserve internal whitespace
- REST-API fix for DB close

---

## [0.6.3] — 2026-05-06

Extended object reference parser: complete coverage of read/write accesses across calculations and plugin calls.

- **Read accesses to fields** in addition to write accesses — full coverage of field references inside any calculation context
- **Layout-object calculations** parsed as references: conditional formatting, hide formula, tooltip, placeholder, and visibility expressions now produce `displays_field` / `reads_variable` / `triggers_script` links
- **CustomFunction call chains**: cross-references between calculations resolved via DDR chunks
- **Plugin function calls** (e.g. MBS Plugin) registered as object references in `ObjectCatalog` / `ObjectLinks`
- **Field → Layout** references for direct on-layout visibility analysis
- Improved layout-box label resolution

---

## [0.6.2] — 2026-05-03

Folder hierarchies as a first-class object type in the catalog.

- New `Folder` object type in `ObjectCatalog`; folders for Scripts, Layouts, and CustomFunctions are registered alongside their leaf objects
- Hierarchical parent/child relationships modeled in `ObjectLinks`
- Dedicated REST API endpoint for folder structures, including type-specific validator and controller
- Detail SQL template `object_details_folder.sql` for the folder view
- New `list_with_folders.sql` custom template
- Web frontend tree view (`FolderTree` / `TreeView` components): browseable folder hierarchy with collapsible nodes
- follow-up optimizations and bugfixes on the folder-based navigation

---

## [0.6.1] — 2026-04-29

Service release: Bugfixes and optimizations.

- Changed npm binding from old 'DuckDB native C++' to new 'DuckDB node-api' interface to prevent installation issues
- Optimizations in init.sh script (verbose mode for npm, Claude settings)
- Optimizations in convert_fm_xml.sh (printf Locale-Fix)
- Changed path references relative to project root
- More robust detection of path to DuckDB CLI and Node cli
- Optimizations in gitignore to prevent conflicts when updating repo from origin

---

## [0.6.0] — 2026-04-22

fmIDE Plugin System: extensible architecture for the REST API and web frontend.

- Plugin interface for registering custom API endpoints and frontend components
- `fmIDE` plugin: opens FileMaker objects directly from the browser via fmIDE
- Settings plugin for persistent per-user configuration
- Plugin code isolated from the main codebase into dedicated module directories
- `install-fmide-docs` skill for local fmIDE documentation
- Consolidated directory structure for `tools/` and `scripts/`

---

## [0.5.0] — 2026-04-17

Public release preparation, AI analysis skills, and dual-database architecture.

- **`fm-summarize`** / **`fm-analyze`** skills: AI-generated technical summaries and semantic analyses of FileMaker objects; `--short` mode for compact output
- **Dual-DB architecture**: master database (`db/fm_catalog.duckdb`) for write access; read-only copy (`rest-api/db/`) for the API server — eliminates file-lock conflicts during parallel import
- Atomic sync mechanism: after each import the copy is updated and the server is hot-reloaded via `POST /api/admin/reload` without a full restart
- Shell scripts `rest-api-start` / `rest-api-stop` / `rest-frontend-start` / `rest-frontend-stop`
- Publish script for preparing the public release
- Project renamed to **fm-lab**

---

## [0.4.0] — 2026-03-27

XML import improvements: robust parsing, AutoEnter fields, and full variable tracking.

- Parser for `AutoEnter` fields: lookup details (source field, relationship TO), calculated auto-enter values, and constant defaults
- Robust JSON parser for special character escaping, integrated directly into SQL (no external Python step)
- Parser for `Calculation_Text` extracted from CDATA sections
- Automatic skipping of outdated SaXML v2.0 format (FileMaker 18.x) with a warning
- **`VariableUsages` / `VariablesCatalog`**: full variable parser detecting local, global, and MBS superglobal variables from script steps, DDR chunks, auto-enter formulas, and layout merge variables
- `install-ooe-fm` and `install-fm-xml-export-exploder` skills for reference data setup
- `duckdb-skills:duckdb-docs` skill for in-terminal DuckDB documentation lookup

---

## [0.3.0] — 2026-02-12

Browser-based web frontend for interactive exploration of the FileMaker analysis.

- Search across all object types with filters by file and type, sorting, and grouping
- Infinite / virtual scrolling for large result sets (chunk-based), search-as-you-type
- Detail view for all object types with 5-tab sub-navigation
- Graph view for object relationships (Mermaid-based)
- Layout SVG preview: visual representation of layout object structures
- REST API `/api/get-details` endpoint with type-specific SQL templates for all object types
- Vite-based dev server; shared `packages/shared` library between frontend and API (npm workspaces monorepo)
- OpenAPI specification as single source of truth; TypeScript types auto-generated

---

## [0.2.0] — 2026-01-26

Multi-file support, universal object catalogs, and REST API.

- **Multi-file support**: all tables extended with a `File_Name` column; multiple XML files importable into one shared database
- **`ObjectCatalog`**: central registry for all 25+ object types across all imported files
- **`ObjectLinks`**: 31 implemented link types (operational dependencies + structural container hierarchies), including cross-file links
- **`FilesCatalog`**: metadata for all imported FileMaker files
- **DDR-Info support** (FileMaker 21+): optional `DDR_ScriptSteps` and `DDR_Calculations` tables; `DDR_Hash` as a JOIN key to calculated fields and custom functions
- REST API (Express.js): `/api/search`, `/api/search/count`, `/api/count`, `/api/info`, `/api/query`
- SQL template system with `getvariable('param')` interpolation; separate folders for report and custom templates
- Case-insensitive search and parameter handling
- `filemaker-script-erzeugen` skill: creates FileMaker scripts in `fmxmlsnippet` format with automatic backup management
- `install-mbs-docs` / `install-filemaker-docs` skills for local documentation setup
- Batch import with fail-fast flag, timing output, and extended error logging

---

## [0.1.0] — 2026-01-13

Initial release: XML conversion pipeline, core database structure, and first AI skills.

- Conversion script `convert_xml.sql` covering all major FileMaker object types: base tables, fields, scripts, script steps, layouts, layout objects (22 types, 4 nesting levels), value lists, accounts, relationships, and more — 30 tables total
- `XMLMetadata` table with FileMaker version and DDR-Info status
- Sample queries (`sql/sample_queries.sql`) as an entry point for ad-hoc analysis
- **`convert-xml`** skill: converts one or all XML files (`--batch`) and manages the import lifecycle
- **`mbs-function-reference`** skill: looks up MBS Plugin functions in a local documentation database
- **`skill-creator`** skill: guided workflow for creating new Claude Code skills

---

<!-- Link references — activate once the first tag exists in this repository:
[Unreleased]: https://github.com/marcelmore/fm-lab/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/marcelmore/fm-lab/releases/tag/v0.6.0
-->
