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

The two shipped system bundles are **home** (`dashboards/home/data/` — project
summary, object counts, files overview) and **file** (`dashboards/file/data/` —
per-file info, triggers, start layout, accounts). Custom and plugin dashboards
live under `dashboards-custom/<id>/data/` (e.g. static-code-analysis,
modularization, script_todos).

## The manifest wires datasets to tiles

Each entry in `datasets[]` names a source. Two source kinds:

```json
"datasets": [
  { "id": "project_summary", "source": "bundle:data/project_summary.sql" },
  { "id": "cluster_count",   "source": "builtin:cluster_count" },
  { "id": "nav_dashboards",  "source": "builtin:list_dashboards",
    "params": { "excludeTags": ["home", "nav", "internal", "system"] } }
]
```

- **`bundle:data/<file>.sql`** — a dataset SQL file inside this bundle.
- **`builtin:<name>`** — reuse a shared built-in dataset (with optional `params`).

Bundle-level `params[]` (e.g. an optional `file` filter) flow into the datasets
as named parameters.

## Parameters — the `:param` caveat

Dashboard datasets typically use the **named** `:param` style. The interpolator
replaces every bare `:word` that has **no** matching parameter with `NULL`.
A stray colon — a `::CAST`, a `localhost:3003`, a `time:value` literal — can be
misread as a parameter and nulled out. Keep colons deliberate.

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
