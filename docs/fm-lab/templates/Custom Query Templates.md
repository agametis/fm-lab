# Custom Query Templates

**Directory:** `rest-api/templates/sql-custom/` · **Config:** `TEMPLATE_CUSTOM_DIR` ·
**Served by:** [/api/query](../rest-api/endpoints/Query%20and%20Report%20API.md) · **Surface:** the *Custom Queries* dashboard

Custom query templates are the extension point for your own named analyses. Drop
a `.sql` file here and it becomes callable by name **and** appears as a card in
the Custom Queries dashboard — no code change, no redeploy. Part of the
[SQL Templates](SQL%20Templates.md) family.

## What ships here

The installation seeds a set of examples you can copy from — rankings
(`top_scripts`, `top_tables`, …), complexity and layout-quality reports, and
more; see the files in `rest-api/templates/sql-custom/` for the current list.

## The richer header

Unlike the built-ins, custom templates carry presentation metadata so the
dashboard can render and wire up a tile without extra code:

```sql
-- @template_type: object
-- @title: Top scripts
-- @description: Scripts with the most steps.
-- @icon: script
-- @category: Top
-- @display: table
-- @params: limit (optional, default 100), file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}&type=Script
-- @chip_filter: trigger_event
-- @chip_param: event
-- @output_format: uuid, name, type, file, step_count
-- @author: fm-lab core
-- @version: 1.0

SELECT ...
```

`@click_action` + `@click_args` turn each result row into a navigation target
(here: open the script object). `{{uuid}}` is filled from the row.

`@chip_filter` + `@chip_param` add a **chip bar** above the result table:
`@chip_filter` names the result column whose values become the chips,
`@chip_param` the query parameter a selected chip sets — so a chip filters
**server-side** through a re-query, not by hiding client rows. The chip counts
can come from the dedicated result columns `_chip_facets` (a JSON
`{value: count}` map over the *full* population) and `_row_total` (the row
count before the LIMIT) — see the column conventions in [Dashboard Datasets](Dashboard%20Datasets.md).

`@row_action` + `@row_action_args` (optional) declare a **second** click target
with the same grammar: the table then renders a small arrow button at the end
of each row that navigates independently of the row click. `@row_action_label`
sets the button's tooltip (plain English, like `@title`); without it a generic
localized label is used.

**For the tests layer.** Four more header keys make a custom query usable as a
member of an [Analysis Test](../Wiki/Analysis%20Tests.md) set: `@scope` (which scopes the
query supports — solution, file, object, object-list, cluster), `@object_types`
and `@output_types` (what it targets and returns), and `@default_result` (the
default metric a test run reports). The keys are inert for the dashboard card;
the tests engine reads them.

## Creating one

1. Add `rest-api/templates/sql-custom/<name>.sql` with a header and DuckDB SQL.
2. Parameterise with `:name`, `$1`, or `getvariable('name')`
   (see [Parameters](SQL%20Templates.md#parameters)).
3. Save — templates **hot-reload**, so no admin reload is needed. The file is
   now reachable as `/api/query?template=<name>` and shows up in Custom Queries.

```bash
curl "http://localhost:3003/api/query?template=top_scripts&params=%7B%22limit%22%3A20%7D"
```

## Override behaviour

On a name collision a custom template **wins** over a built-in of the same name.
That makes `sql-custom/` the right place to tune a core query for your
installation — copy the built-in, adjust it here, keep the same name.

## See also

- [SQL Templates](SQL%20Templates.md) — overview, metadata header, parameters
- [Built-in Query Templates](Built-in%20Query%20Templates.md) — the templates you can override
- [Detail View Templates](Detail%20View%20Templates.md) — internal UI-hook templates (not listed publicly)
- [Dashboard Datasets](Dashboard%20Datasets.md) — for full multi-tile dashboards instead of a single query
