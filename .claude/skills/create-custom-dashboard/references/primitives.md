# Primitive & action reference

Verified against `apps/web/src/dashboard/primitives/registry.ts`,
`apps/web/src/dashboard/actions.ts`, `apps/web/src/dashboard/actionState.ts` and
`rest-api/src/services/dashboard-schemas.js` (2026-07-17). When a prop is not
listed here, check the primitive's source file instead of guessing.

## Layout node shape

```json
{
  "type": "<Primitive>",
  "id": "<stable_node_id>",
  "props": { ... },
  "data": { "dataset": "<dataset_id>" },
  "visibleWhen": { "dataset": "<id>", "field": "<col>", "equals": <value> },
  "children": [ ... ]
}
```

- **`id` is mandatory on every node this skill generates** (`^[a-zA-Z0-9_-]+$`).
  Convention: `<card>_<primitive>` (`summary_kpistrip`, `url_details_table`). IDs
  anchor the locale overrides (see `references/localization.md`) and survive
  layout restructuring — the legacy positional paths do not.
- `data.dataset` binds a dataset. Children inherit the container's dataset; a
  child may bind its own. `KPIStrip`, `DefinitionList`, `FilterChips`, `Select`
  and `Slider` read the **first row** of their bound dataset.
- `visibleWhen` (optional, any node): show the node only when the first row of
  `dataset` satisfies `equals` / `notEquals` / `truthy` on `field`.

## Container primitives

| Primitive | Props (defaults) |
|---|---|
| `Grid` | `columns` (12), `gap` (16) — always the root |
| `Card` | `span` (12), `title`, `subtitle`, `variant` (`"hero"` = gradient, purely cosmetic) |
| `Stack` | `gap` (12), `align` (`stretch`), `span` |
| `Row` | `gap` (12), `align` (`center`), `span` |
| `Spacer` | `size` |

Span values: `12` full, `6` half, `4` third, `8`+`4` two-thirds + third.

**Card title convention:** the dashboard title box comes from `manifest.title` —
the first card carries **no** `title` (no `"Overview"` filler either). Only
follow-up cards get a title, and only a genuine section label.

## Value primitives (single row)

| Primitive | Props |
|---|---|
| `KPI` | `label`, `field`, `format`, `onClick` (ActionSpec) |
| `KPIStrip` | `items[]` of `{ label, field, format?, onClick? }` |
| `DefinitionList` | `items[]` same shape, rendered as "Label / value" rows (settings-style panels) |

**Clickable KPIs** (the filter-hero pattern): give an item `onClick` with an
`openDashboard` self-navigation whose `args.params` set a filter param. The tile
renders as a button and gets an **active state** automatically when the URL params
match `args.params` (see §Active state below).

## Collection primitives (many rows)

### `List`
```json
{ "type": "List", "props": {
  "rowTemplate": {
    "primary":   "{{name}}",
    "secondary": "{{file}} · {{step_count}} steps",
    "tertiary":  "…", "quaternary": "…",
    "badge":     "{{ref_count}}",
    "badgeOptions": { "hideZero": true, "filterable": true, "filterLabel": "used", "onClick": { … } },
    "onClick":   { "action": "openObject", "args": { "uuid": "{{uuid}}", "type": "Script", "file": "{{file}}" } },
    "inlineControl": "docsInstall"
  },
  "searchable": "auto", "searchAutoThreshold": 3, "searchPlaceholder": "Search …",
  "empty": { "message": "No entries found." }
}}
```
`badgeOptions.filterable` adds a toggle that hides zero-badge rows (only rendered
when both used and unused rows exist).

### `Table`
```json
{ "type": "Table", "props": {
  "rowKey": "<unique column>",
  "density": "comfortable | compact",
  "sortable": true,
  "searchable": "auto", "searchAutoThreshold": 3, "searchPlaceholder": "Search …",
  "columns": [
    { "field": "name",  "label": "Name" },
    { "field": "count", "label": "Count", "align": "right", "format": "number" }
  ],
  "chipFilter": { "field": "<col>", "allLabel": "All",
                  "groups": [ { "label": "If / Else If", "values": ["If", "Else If"] } ] },
  "onRowClick": { "action": "openObject",
                  "args": { "uuid": "{{uuid}}", "type": "{{type}}", "file": "{{file}}" } },
  "empty": { "message": "…" }, "alwaysShowCount": true
}}
```
`chipFilter` renders value chips (with counts) above the table and filters
**client-side** — i.e. only within the already-loaded, LIMIT-capped rows. For
true-total filtering use `FilterChips` (server-side) instead; decision rule in
`references/patterns.md`.

### `AutoTable`
Columns derived automatically from the dataset (columns prefixed `_` are always
hidden). Props: `exclude[]`, `sortable` (default **true**), `searchable` (default
**true**), `paginate` / `pageSize`, `maxHeight` ("70vh"), `density`,
`clickAction` + `clickArgs` ("k=v&k2=v2" with token substitution) or `metaDataset`.
Use for generic/exploratory outputs; prefer `Table` when you control the columns.

### `TileGrid`
```json
{ "type": "TileGrid", "props": {
  "tile": { "title": "{{name}}", "subtitle": "{{description}}", "icon": "{{icon}}",
            "badge": "{{count}}", "onClick": { "action": "openDashboard", "args": { "id": "{{id}}" } } },
  "minTileWidth": 220, "viewToggle": true,
  "searchable": "auto", "searchAutoThreshold": 3
}}
```

**Search rule (all three):** `searchable` accepts `true` / `false` / `"auto"`;
`"auto"` shows the field above `searchAutoThreshold` rows (frontend default 10).
This skill always emits `"searchable": "auto", "searchAutoThreshold": 3` on
List/Table/TileGrid — documented exception: fixed Top-N rankings with N ≤ 5.

## Filter primitives (server-side, URL param → `getvariable`)

These write their choice into a URL search param; the dashboard forwards **all**
URL params to every dataset, where the SQL reads them via `getvariable('<param>')`.
Because the query re-runs, counts are true totals (not LIMIT-capped).

| Primitive | Props | Use for |
|---|---|---|
| `FilterChips` | `param` (required), `default`, `options[]` of `{ value, label, countField? }`; bind a summary dataset — `countField` reads its first row | 2–5 named lenses (all / without X / only X) with true-total counts |
| `Select` | `param` (required), `default`, `valueField` ("value"), `labelField` ("label"), `label`; options come from the bound dataset's rows | many options / data-driven option lists (e.g. classification sets, file pickers) |
| `Slider` | `param` (required), `label`, `min` (0), `max` or `maxField` (from bound dataset), `step` (1), `default`, `valueSuffix` | numeric thresholds |

All three keep the URL canonical: at the default value the param is removed.

**Sticky params.** By default a filter param is click-scoped: an `openDashboard`
self-navigation replaces the whole query string, so any param the click args do
not carry is dropped. Two ways to keep a *mode/lens* param alive across clicks:

- **Declare it sticky in the manifest** (preferred): `{ "name": "api_set",
  "type": "string", "required": false, "sticky": true, … }`. The frontend
  preserves manifest-sticky params on self-navigation automatically (new args
  still win over the preserved value). Reference: `modularization/external_apis`
  (`file`, `api_set`, `comment`).
- **Carry it in the click args** (works everywhere, also cross-dashboard):
  `"params": { "host": "{{host}}", "comment": "{{comment}}" }`.

A legacy base set (`api_set`, `file`, `comment`) is always sticky for backward
compatibility (`STICKY_DASHBOARD_PARAMS` in `apps/web/src/dashboard/actions.ts`).
Truly click-scoped filters (the thing a KPI tile or drilldown row *sets*) must
NOT be declared sticky — otherwise they can never be reset by a click that
omits them.

## Content primitives

| Primitive | Props |
|---|---|
| `Markdown` | `content`, `span` — notes/help blocks |
| `NavButton` | `label`, `subtitle`, `showCount` (row count of the bound dataset), `onClick` |
| `Empty` | `message` |

(Registry primitives not listed here — `DocsInstallErrorBezel`, `XmlConvert*`,
`SemanticNamesStatus`, `XmlImportIntegrity` — are system-internal; do not use
them in custom bundles.)

## Click actions (whitelist)

Token substitution against the clicked row runs before dispatch. `args` may also
be given as `argsString: "k=v&k2=v2"` (values URL-decoded; useful when the SQL
emits ready-made arg strings).

| Action | Args | Effect |
|---|---|---|
| `openObject` | `uuid` (required), `type`, `file`, plus extra keys or nested `params` | Object detail view. **Always pass `file`** (duplicate-UUID disambiguation). Precision anchors: `params: { "step": "{{step_uuid}}" }` scrolls to a script step, `"sq": "{{term}}"` pre-fills the detail search, `"tab"`, `"ref"`, `"types"` (layout object-type filter, e.g. `"Container,Web Viewer"`) |
| `openFile` | `file` | File detail view `/file/<name>` |
| `openDashboard` | `id`, `params?` (nested or flat) | Another dashboard — or **the same dashboard as filter mechanism** (see below) |
| `applyFilter` | `q?`, `type?`, `file?`, `mode?`, `subtype?`, `label?`, `category?`, `sort?` | Home search view with pre-set filters |
| `navigate` | `path` (app-internal, leading `/`) | Generic SPA navigation |
| `openDocsEntry` | `set`, `category`, `fn`, `lang?` | Docs full-text view |
| `runQuery` | `query`, `params?` | Custom template via the `_generic` bundle |
| `openUrl` | `url` (`https://` external w/ confirmation, or `/api/…` same-tab) | External link |
| `copyToClipboard` | `value` | Copy |

### The self-navigation filter idiom

KPI tiles and aggregate-table rows filter the dashboard by navigating to
**itself** with a param:

```json
"onClick": { "action": "openDashboard",
             "args": { "id": "<this_dashboard_id>", "params": { "pattern": "todo" } } }
```

The URL param reaches every dataset as `getvariable('pattern')`. A "Total/All"
tile resets by sending the empty value `""`.

### Active state

A clickable KPI (or row) is highlighted as *active* when every key in
`args.params` (after token substitution) matches the current URL params. The
empty string `""` (and the literal `"Alle"`) count as reset values — they are
"active" when the param is absent. Only `args.params` participates; `uuid`,
`type` etc. are ignored. This is why filter params belong in nested `params`,
not flat args.

## Token substitution & formats

`{{field}}` → field value of the current row. Filters:
`{{ field | upper }}`, `{{ field | lower }}`, `{{ field | number:2 }}`,
`{{ field | date:relative }}`, `{{ field | date:iso }}`,
`{{ field | truncate:60 }}`, `{{ field | default:N/A }}`.

`format` values for KPI items / table columns:

| Format | Behaviour |
|---|---|
| `number` | locale-formatted number |
| `count` | like `number` but renders `0` as empty (pivot noise reduction) |
| `badge` | pill; canonical English values are auto-translated (`dashboard:cellValues`) |
| `filesize` | B / KB / MB / GB |
| `date:relative` | "5 days ago" (falls back to absolute beyond a week) |
| `date:iso` | ISO timestamp |
| `date` (any other `date:*`) | locale date string |

(There is **no** `boolean` or `date:short` format — emit canonical strings and
use `badge`, or format in SQL.)

## Manifest schema constraints (Joi — violations = bundle silently invisible)

- `id` matches `^[a-zA-Z0-9_-]+$` **and** equals the bundle directory's basename.
- `title` required, non-empty.
- `params[].type` ∈ `string | number | boolean` (never `integer`/`int`/`float`/`bool`).
- `params[].sticky` (boolean, default false): survives `openDashboard`
  self-navigation — for mode/lens params only, never for click-scoped filters
  (see §Filter primitives).
- `datasets[].source` matches `^(bundle|custom|report|builtin):.+$`.
- `datasets[].params` (optional object) = per-dataset default param values.
- Every `data.dataset` name used in `layout.json` must exist in
  `manifest.datasets[].id` — the loader does NOT catch this (empty card at runtime).
- `permissions`: `{ "read_only": true, "allow_navigation": true }`.

Dataset sources: `bundle:data/<name>.sql` (preferred, self-contained) ·
`custom:<template>` (sql-custom resolver chain) · `report:<template>`
(`rest-api/templates/sql/`) · `builtin:<name>` (server builtins:
`list_dashboards`, `list_custom_queries`, `files`, `query_meta`, …).

Icons (`manifest.icon`, Lucide names): `database`, `code`, `layout-list`,
`git-fork`, `table-2`, `search`, `variable`, `function-square`, `tag`,
`alert-triangle`, `link`, `box`, `layers`, `filter`, `globe` — default `database`.
