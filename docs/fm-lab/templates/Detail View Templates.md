# Detail View Templates

**Directory:** `rest-api/templates/sql-custom-details/` (searched recursively) ·
**Config:** `TEMPLATE_DETAILS_DIR` · **Served by:** [/api/query](../rest-api/endpoints/Query%20and%20Report%20API.md)

Detail view templates are **internal** SQL loaded by UI hooks and controllers —
the structured data behind a detail panel, not something a user browses. They
are resolved by name through `/api/query` like any template, but unlike
[Custom Query Templates](Custom%20Query%20Templates.md) they do **not** appear in the Custom Queries
dashboard. Part of the [SQL Templates](SQL%20Templates.md) family.

## What lives here

The directory is scanned **recursively**, so templates can be grouped in
subfolders by the view they serve. Currently, for example:

- `list_with_folders.sql` — a folder-aware object listing used across views.
- `layout/display_layout_objects_data.sql` — one JSON row per layout object with
  absolute coordinates, part assignment, nesting and colours; the web frontend
  draws the interactive wireframe from this.
- `layout/display_layout_parts_data.sql` — the layout's parts as bands.
- `layout/display_layout_triggers.sql` — script triggers attached to the layout.
- `layout/display_layout_meta.sql` — layout-level metadata (view options, …).

## How resolution works

When `/api/query` is asked for a template name it isn't found in
[sql-custom/](Custom%20Query%20Templates.md), the service falls back to a recursive
lookup here. So a UI hook simply calls:

```
/api/query?template=display_layout_objects_data&params={"layout_uuid":"…"}
```

and the controller renders the panel from the rows.

## When to add one here vs. sql-custom

- **`sql-custom-details/`** — the query backs a specific UI hook / detail panel
  and should *not* clutter the Custom Queries list. Group it in a subfolder by
  view.
- **[sql-custom/](Custom%20Query%20Templates.md)** — the query is a standalone
  analysis a user should discover and run.

## See also

- [SQL Templates](SQL%20Templates.md) — overview, metadata header, parameters
- [Custom Query Templates](Custom%20Query%20Templates.md) — the user-facing sibling tier
- [Objects API](../rest-api/endpoints/Objects%20API.md) — the layout detail / SVG special case
- [REST API Output Formats](../rest-api/REST%20API%20Output%20Formats.md) — the structured-data-for-client-drawing note
