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
come from the result column `_chip_facets` (a JSON `{value: count}` map over the
*whole* result before the search and the chip itself) and `_row_total` (the row
count of the current selection) — see the column conventions in
[Dashboard Datasets](Dashboard%20Datasets.md).

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

## Server paging, sorting and search

A query whose result can exceed one page pages, sorts and searches **on the
server**, so counts, sort order and search hits always cover the whole result
and not just the loaded rows. Four header keys declare it:

```sql
-- @page_param: page
-- @search_param: q
-- @sort_param: sort
-- @page_size: 500
-- @sort_columns: layout_name, overlap_px      (optional: restricts sortable columns)
```

The SQL ends in a fixed frame. The former last `SELECT` becomes the CTE
`result` (all output columns, all filters except search and chip, no `ORDER BY`,
no `LIMIT`); two marked blocks follow, shared verbatim by every paged query:

```sql
WITH … existing CTEs …,
result AS MATERIALIZED (
    SELECT … AS file_name, … AS layout_name, …   -- the output columns
    FROM …
),
-- >>> shared paging search block
haystack AS (…), searched AS (…)                 -- filters on the term in q
-- <<< shared paging search block
filtered AS (                                    -- only with a chip
    SELECT * FROM searched
    WHERE getvariable('relation') IS NULL OR relation = getvariable('relation')
),
-- >>> shared paging window block
pg AS (…)                                        -- page size, total, clamped page
-- <<< shared paging window block
SELECT f.*,
    (SELECT to_json(map_from_entries(list((relation, n) ORDER BY relation)))
       FROM (SELECT relation, count(*) AS n FROM result GROUP BY 1)) AS _chip_facets,
    pg._pg_total AS _row_total, pg._pg_page AS _page, pg._pg_size AS _page_size
FROM filtered f, pg
ORDER BY /*@sort*/ overlap_px DESC, file_name, layout_name, f
LIMIT (SELECT _pg_size FROM pg) OFFSET (SELECT (_pg_page - 1) * _pg_size FROM pg);
```

Copy the two blocks from any paged query in `sql-custom/` (for example
`layout_overlap_explorer.sql`) — a unit test keeps all copies identical; only
the fallback page size inside the window block differs and equals `@page_size`.

- **`MATERIALIZED` is required.** `result` is read for the count, the facets
  and the page; without the hint DuckDB recomputes it several times.
- **Default order.** The final `ORDER BY` keeps the query's previous order and
  ends with the whole row `f` as last tiebreak, so the order is total and no row
  appears twice or goes missing across pages.
- **Sorting.** `?sort=<column>&dir=asc|desc` sorts by any visible output column
  (or only those in `@sort_columns`). The backend replaces the marker
  `/*@sort*/` with the quoted column name — a name it has read from the query's
  own output columns, never text from the URL — plus `ASC` or `DESC`; text sorts
  case-insensitively, empty values come last. An unknown column leaves the
  default order. A hidden companion column `_sort_<column>` (a rank, or the raw
  number behind a formatted text) takes the column's place in the sort.
- **Page size.** A request may override it with `page_size` (API only; the page
  URL never passes it on), otherwise `@page_size` applies, otherwise 500. Every
  number is clamped to 1–10,000; `all` returns up to 10,000 rows without a pager.
- **Search.** The search block covers the same columns the table searches on
  the client: every visible column except `uuid`.
- **Chip counts** ignore the search: the facets count over `result`, while the
  hit count of a search shows in `_row_total`. The ordered map keeps the JSON
  text the same in every request (`json_group_object` does not fix the key
  order).

**Client and server mode.** As long as the whole result fits on one page and
neither a sort nor a search term sits in the URL, the table sorts and searches
the loaded rows locally — instantly, in natural order. A larger result, a sort
or a search term in the URL switches to the server; a local sort and search
move into the URL at that moment. The pager shows above and below the table; the
scroll position stays when paging.

**No silent cap.** A fixed `LIMIT` remains only for deliberate rankings (the
`top_*` queries). A unit test (`rest-api/tests/unit/paging-templates.test.js`)
fails for any query or dataset with a `LIMIT` of 100 or more, or a
parameterised one, that neither pages, nor names the cut-off in `_row_total`,
nor stands on its exception list with a reason.

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
