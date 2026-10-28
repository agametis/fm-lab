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
them **home** (project summary, object counts, files overview, recently
changed objects), **file** (per-file info, change stamps, triggers, start
layout, accounts), **changes** (the [recent changes](../schema/catalog-tables/ObjectChangeMeta.md#recent-changes-dashboard)
with work sessions and mass events), the dashboards/tests/docs overview pages
and the docset views. Custom and plugin dashboards live under
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

A server-paged dataset (see [Paging, sorting and search](#paging-sorting-and-search)) declares its page
size and URL parameters on its `datasets[]` entry:

```json
{ "id": "findings", "source": "bundle:data/findings.sql", "pageSize": 500 },
{ "id": "drivers",  "source": "bundle:data/drivers.sql",  "pageSize": 100,
  "pageParam": "drivers_page", "searchParam": "drivers_q", "sortParam": "drivers_sort" }
```

- **`pageSize`** — rows per page (1–10,000, or `"all"`); without it 500.
- **`pageParam`**, **`searchParam`**, **`sortParam`** — the URL parameters of
  the table (default `page`, `q`, `sort`; the direction travels in `dir`, or
  `<sortParam>_dir` for any other name). The backend maps them onto the SQL
  variables `page` and `q`, so the SQL always reads the same names.
- **`sortColumns`** (optional) — restricts which output columns are sortable.

## Parameters — the `:param` caveat

Dashboard datasets typically use the **named** `:param` style. The interpolator
replaces every `:` followed by a word character (letter, digit, underscore) with
the matching parameter or, without one, with `NULL` — in string literals and
comments too. Every `$n` is replaced the same way, as a positional parameter.
A stray colon is misread as a parameter and nulled out:

- the second colon of a `::` cast → write `CAST(x AS VARCHAR)`;
- the `:3` of a list slice `[1:3]` → write `list_slice(list, 1, 3)`;
- `localhost:3003`, `'%H:00'` or a `key:value` literal → split the string
  (`'%H' || ':' || '00'`).

Keep colons and dollar signs deliberate.

## Column conventions

Result columns whose name starts with `_` are **technical**: the list/table
primitives neither display them nor include them in the client-side row search.
Use the prefix for plumbing columns like `_click_action` / `_click_args`
(navigation wiring) or validation metadata. Two of them carry chip-bar data:
`_chip_facets` (a JSON `{value: count}` map — the facet distribution over the
**whole** result before the search and the chip itself, not just the returned
page) and `_row_total` (the row count of the current selection), which let a
chip bar show true counts on paged results. A server-paged table reads two
more: `_page` (the page the SQL actually returns, after clamping to the last
page) and `_page_size` — see below. The helper columns of the paging frame
carry the prefix as well (`_ord_*`, `_pg_*`, `_row_seq`, `_sort_<column>`).
Three names are reserved
and stay un-prefixed by design: `uuid`,
`nav_uuid` and `row_key`. Docset-facing built-ins report entry counts as
`entries` / `entry_count` (the generic terms — a docset entry can be a
function, a script step or a page).

## Paging, sorting and search

Every list that can return more than one page pages, sorts and searches **on
the server**; a fixed `LIMIT` remains only for deliberate rankings and short
group lists (see *No silent cap* in [Custom Query Templates](Custom%20Query%20Templates.md)).

**The SQL frame** is the one of the paged custom queries, with three bundle
specifics:

- The former last `SELECT` becomes `unkeyed AS MATERIALIZED`. Expressions of
  the previous order that are not output columns (`oc.File_Name`, a `CASE` on
  the severity) travel along as hidden columns `_ord_1 …`.
- `result AS MATERIALIZED` drops the `_ord_*` columns and numbers the rows:
  `row_number() OVER (ORDER BY u._ord_1, …, u) AS row_key` — the whole row `u`
  breaks the remaining ties, so every request assigns the same key and pages
  from separate requests fit together.
- The table search uses the block `shared paging table-search block`; besides
  `_` columns and `uuid` it skips `nav_uuid` and `row_key`, exactly like the
  client-side table search.

The frame ends in `ORDER BY /*@sort*/ row_key, f` plus `LIMIT`/`OFFSET` from
`pg`, and the fallback page size inside the window block equals the manifest
`pageSize`. Page 1 without parameters is the previous result, so Analysis Tests
and other callers without paging parameters see the same rows as before. The
bundle `static-code-analysis/unused_code/variable_set_never_read` is the
reference; `static-code-analysis/best_practices/relationship_with_sort` adds a
server chip.

**The table** (`Table` in `layout.json`) opts in with props:

| Prop | Effect |
|---|---|
| `pageParam`, `searchParam`, `sortParam` | the URL parameters, same names as in the manifest; a header click writes `sort`/`dir` and returns to page 1 |
| `clientMode: true` | while the whole result fits on one page and no sort or search term sits in the URL, sort and search stay local; set it only when the search parameter filters this dataset alone |
| `columns[].sortKey`, `columns[].sortable: false` | sort another output column for this header, or keep a header unclickable |
| `chipFilter: { field, param }` | server chips: a click writes `param`, the SQL filters in `filtered`, the counts come from `_chip_facets` |

The search field sends its term after a short pause, the pager shows above and
below the table, and paging keeps the scroll position. A `chipFilter` without
`param` would count and filter just the loaded page; on a paged table it is not
allowed.

**The surrounding layout:**

- The `Card` that binds the dataset sets `keepChildrenOnEmpty: true` — a search
  without hits must not remove the search field.
- `FilterChips` in the same card reset the page: `"resetParams": ["page"]`.
- Several paged tables on one dashboard carry their own parameter names
  (e.g. `drivers_page`, `drivers_q`, `drivers_sort`), in the layout and in the
  manifest; otherwise one search or page would drive all of them. A dashboard
  parameter that already means something else (e.g. a `sort` that selects a
  measure) needs a different sort parameter name as well.

A unit test (`rest-api/tests/unit/paging-templates.test.js`) checks the frame,
the shared blocks and these layout rules for every paged dataset.

**Changelog lists.** The datasets of the Changelog dashboards
(`dashboards/changelog/`) search in their shared filter block, because the term
filters the KPIs and charts of the dashboard as well. They therefore run
always on the server (no `clientMode`), page the rows of `result` through the
variant `shared paging changelog-window block`, keep `row_key` as the row's
identity (e.g. object UUID and file) and order the pages by a hidden
`_row_seq`.

**Multi-value filters.** A filter dropdown can allow several values. It writes
them comma-separated into one parameter (`type=Script,Layout`); the SQL splits
the list (`string_split`) and tests membership. No value chosen means no
filter. Filters reset the page when they change, so a new filter starts on
page 1. The bundle `changes` (`dashboards/changelog/changes/`) is the
reference.

## Chart datasets

The chart tiles (activity map, stacked time series, sparkline) only draw: the
dataset delivers every bucket, level and drill-down window ready-made.

- **One row per cell or bucket, empty ones included.** Generate the frame with
  `generate_series` and join the data onto it, so a gap stays visible as a gap.
- **Times as text.** Return bucket bounds and labels via `strftime`, not as
  `TIMESTAMP`: the API sends a timestamp as UTC, and the browser would shift a
  local client time by its own time zone. The drill-down window per cell
  (`from_at`, `to_at`) is text as well and goes straight into the click action.
- **Lists of structs as a column** carry small detail sets, e.g. the top three
  types of a cell for the tooltip: `[{key: 'Script', n: 12}, …]`. The API
  converts `BIGINT` to a JSON number only in top-level columns — cast counts
  inside a list or struct to `INTEGER`, otherwise the response fails to
  serialize. Cut the list with `list_slice`, not `[1:3]` (see the `:param`
  caveat).

The datasets `activity_map.sql` and `activity_series.sql` of the bundle
`changes` are the reference.

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
