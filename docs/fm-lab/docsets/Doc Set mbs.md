# Doc Set: mbs

The complete function reference of the **MBS FileMaker Plugin** (MonkeyBread Software) — at roughly 7,300 functions the largest plugin surface in the FileMaker ecosystem — as a local Dash docset with a prebuilt search index.

| | |
|---|---|
| **Status** | recommended — install on demand |
| **Original source** | [www.monkeybreadsoftware.com](https://www.monkeybreadsoftware.com) — official Dash docset (`/filemaker/Dash/MBS.zip`) |
| **Copyright / license** | © Christian Schmitz, MonkeyBread Software — proprietary vendor documentation, distributed by MBS as a Dash docset for offline use |
| **Storage directory** | `docs/mbs/` |
| **Source format** | Dash docset (zip archive) |
| **Installed format** | HTML pages (`Documents/`, ~8,250 files) + SQLite index (`docSet.dsidx`) + `.version` marker |
| **Scope** | 7,298 functions in 168 components |
| **Index DB** | ✓ `docs/mbs/docSet.dsidx` — Dash `searchIndex(name, type, path)` |
| **Rubrics** | ✓ 168 components (`type='Category'` in the index) |
| **Pseudo object types** | ✓ `PluginFunction`, `PluginComponent` (see [Object Types](../schema/object-catalog/Object%20Types.md)) |

## Description

The docset arrives ready-made from the vendor: one HTML page per function plus the Dash-standard SQLite index, where each `searchIndex` row maps a function name (`JSON.Parse`) or a component (`DynaPDF`) to its page. Lookups are exact index queries; thematic search walks a component's functions via the shared name prefix.

Like the Claris reference, MBS functions are cross-referenced with your solution: the ingestion pipeline creates a `PluginFunction` pseudo object for every MBS call found in scripts and calculations and groups them under `PluginComponent` entries — so the docs browser, where-used analysis and category filters all connect vendor documentation to your actual plugin usage.

## Component prefix and its exceptions

An MBS function's component is *normally* the name prefix before the first dot: `JSON.Parse` → component `JSON`. But the rule has exceptions — functions whose prefix is not their real component, and a handful of functions without any dot:

| Function | Prefix says | Actual component |
|---|---|---|
| `CGPSConverter.Convert` | CGPSConverter | Utility |
| `CLibrary.GetTag` | CLibrary | CFunction |
| `AddToErrorLog` | — (no dot) | Plugin |
| `CF` | — (no dot) | FM |

These mappings live in the companion table **`reference/mbs_component_exceptions.csv`** (columns `Funktionsname,Component`; ~1,020 rows). It is generated automatically after each install: a post-install script parses every documentation page and records a mapping wherever the page's declared component differs from the name prefix.

The CSV is consumed wherever functions are grouped into components:

- the **ingestion pipeline**, when building `PluginComponent` catalog entries and enriching `PluginFunction` objects during XML import,
- the **REST API**, for component/category enrichment on plugin-function aggregations,
- the CLI report `sql/list_all_mbs_functions_by_component.sql`.

If the CSV is absent (MBS docs not installed), the pipeline falls back to the plain prefix heuristic — imports still work, only the exception mappings are missed. Installing the MBS docs therefore improves catalog quality even if you never read a page.

The installer also derives the **plug-in platform map** from the mirror: `reference/plugin_spec.duckdb` records for every MBS function on which operating systems and under which runtimes it is available (verbatim vendor flags plus a curated interpretation layer — see [plugin-spec](../schema/plugin-spec.md)). This map powers the plug-in members of the [platform tests](../Wiki/Analysis%20Tests.md#platform-tests) and the platform badge on PluginFunction detail views; without the mirror those members simply report *skipped*.

## Installation

- **Skill** — `install-mbs-docs`; prompts before replacing an existing installation.
- **CLI** — `.claude/skills/install-mbs-docs/scripts/install_mbs_docs.sh` with `--check` and `--force`.
- **Web frontend** — the Docs pages install and update the set via `POST /api/docs/install/mbs` with live progress.

## Lookup and browsing

- **Skill** — `mbs-function-reference`: exact and fuzzy name lookup plus thematic search over the Dash index, reading the matched HTML page for details.
- **CLI** — query `docs/mbs/docSet.dsidx` (SQLite) directly, or open pages under `docs/mbs/Documents/`.
- **Web frontend** — the docs browser at `/docs/mbs` (search, components, function pages), with category pills linking into the plugin-function views of your solution.

## See also

- [Doc Sets](Doc%20Sets.md) — the doc-set overview
- [Object Types](../schema/object-catalog/Object%20Types.md) — pseudo object types in the object catalog
- [PluginFunctionUsages](../schema/catalog-tables/PluginFunctionUsages.md) — where plugin calls land in the catalog
