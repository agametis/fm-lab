# Dashboard Datasets

**Directories:** `rest-api/templates/dashboards/` (system) ·
`rest-api/templates/dashboards-custom/` (custom / plugin) ·
**Config:** `DASHBOARDS_DIR`, `DASHBOARDS_CUSTOM_DIR`

A dashboard is a **bundle**: a folder with a manifest, a layout, localisations,
and a `data/` directory of SQL datasets — one `.sql` per tile. These datasets
are the SQL-template tier that feeds dashboards. Part of the [SQL Templates](SQL%20Templates.md)
family.

## Anatomy of a bundle

```
dashboards/home/
├── manifest.json     # id, version, title, datasets[], params[], permissions
├── layout.json       # the tiles and how they arrange
├── locales/          # per-language strings (de, fr, ja, …)
└── data/             # one .sql per dataset
    ├── project_summary.sql
    ├── object_counts.sql
    └── files_overview.sql
```

The shipped system bundles under `dashboards/` cover the app surfaces — among
them **home** (project summary, object counts, files overview), **file**
(per-file info, triggers, start layout, accounts), the dashboards/tests/docs
overview pages and the docset views. Custom and plugin dashboards live under
`dashboards-custom/<id>/data/` (e.g. static-code-analysis, modularization,
developer-workflow).

## The manifest wires datasets to tiles

Each entry in `datasets[]` names a source. Four source kinds:

```json
"datasets": [
  { "id": "project_summary", "source": "bundle:data/project_summary.sql" },
  { "id": "cluster_count",   "source": "builtin:cluster_count" },
  { "id": "nav_dashboards",  "source": "builtin:list_dashboards",
    "params": { "excludeTags": ["home", "nav", "internal", "system"] } }
]
```

- **`bundle:data/<file>.sql`** — a dataset SQL file inside this bundle.
- **`custom:<template>`** — reuse a [custom query template](Custom%20Query%20Templates.md) (`sql-custom/<template>.sql`) as a dataset.
- **`report:<template>`** — reuse a [built-in query template](Built-in%20Query%20Templates.md) (`sql/<template>.sql`).
- **`builtin:<name>`** — reuse a shared built-in dataset (with optional `params`).

A bundle can also ship its own drilldown templates in an optional `queries/`
folder; they resolve by name like any template (last stage of the template
lookup) and keep the dashboard self-contained.

Bundle-level `params[]` (e.g. an optional `file` filter) flow into the datasets
as named parameters.

## Parameters — the `:param` caveat

Dashboard datasets typically use the **named** `:param` style. The interpolator
replaces every bare `:word` that has **no** matching parameter with `NULL`.
A stray colon — a `::CAST`, a `localhost:3003`, a `time:value` literal — can be
misread as a parameter and nulled out. Keep colons deliberate.

## Column conventions

Result columns whose name starts with `_` are **technical**: the list/table
primitives neither display them nor include them in the client-side row search.
Use the prefix for plumbing columns like `_click_action` / `_click_args`
(navigation wiring) or validation metadata. Two of them carry chip-bar data:
`_chip_facets` (a JSON `{value: count}` map — the facet distribution over the
**full** population, not just the returned page) and `_row_total` (the row
count before the LIMIT), which let a chip bar show true counts on limited
results. Three names are reserved and stay un-prefixed by design: `uuid`,
`nav_uuid` and `row_key`. Docset-facing built-ins report entry counts as
`entries` / `entry_count` (the generic terms — a docset entry can be a
function, a script step or a page).

## Override behaviour

On an ID collision a **custom bundle wins** over a system bundle of the same id
— the override pattern for local extensions.

## Creating a dashboard

Use the **create-custom-dashboard** skill: it clarifies the goal, drafts and
confirms the SQL, recommends an interactive pattern, and scaffolds the full
bundle under `dashboards-custom/<id>/` (manifest, layout, `data/*.sql`, locales).

## See also

- [SQL Templates](SQL%20Templates.md) — overview, metadata header, parameters
- [Custom Query Templates](Custom%20Query%20Templates.md) — a single named query instead of a full dashboard
- [Query and Report API](../rest-api/endpoints/Query%20and%20Report%20API.md) — how datasets ultimately execute
