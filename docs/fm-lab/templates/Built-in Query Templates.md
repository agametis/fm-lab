# Built-in Query Templates

**Directory:** `rest-api/templates/sql/` · **Config:** `TEMPLATE_DIR` ·
**Served by:** [/api/query](../rest-api/endpoints/Query%20and%20Report%20API.md)

The built-in query templates are the backbone shipped with every FM-Lab
installation. They power the object detail views, the counts on the home
dashboard, the graph explorer and the reference lookups. Part of the
[SQL Templates](SQL%20Templates.md) family.

## What lives here

Roughly four groups of templates:

- **`object_details_*`** — one template per object type (`object_details_field`,
  `object_details_script`, `object_details_layout`, `object_details_relationship`,
  `object_details_customfunction`, …). These feed the [Objects API](../rest-api/endpoints/Objects%20API.md) detail
  view. The `Layout` variant is special — it generates an SVG wireframe.
- **`*_tokens`** — token-rendered variants (e.g.
  `object_details_calculation_tokens`) used by the editor-style `tokens` output
  format for calculations and script steps.
- **`graph_*`** — the graph/topology queries behind the [Graph API](../rest-api/endpoints/Graph%20API.md) and the
  graph explorer (`graph_overview_*`, `graph_subgraph`, `graph_depth_profile`,
  `graph_search`, …).
- **counts & references** — `object_count_by_type`, `back_references`, and other
  cross-cutting lookups.

## How they are called

By name through `/api/query`:

```bash
curl "http://localhost:3003/api/query?template=object_count_by_type"
```

Parameters use the DuckDB variable style, so a template stays "all rows" when a
filter is omitted:

```sql
WHERE getvariable('file_name') IS NULL
   OR File_Name = getvariable('file_name')
```

## Conventions

- **Ship as-is.** These are core templates — treat them as read-only. To change
  behaviour for your installation, add an overriding template of the same name
  in [sql-custom/](Custom%20Query%20Templates.md) rather than editing these.
- **Locale-independent identity.** Templates key on stable IDs (`Step_ID`,
  `Object_Type`), never on localised `Step_Name` literals, so they behave the
  same regardless of the solution's UI language.
- **Resolved edges, not raw XML.** Dependency questions read `ObjectLinks`; the
  `*_XML` columns are a last resort only.

## See also

- [SQL Templates](SQL%20Templates.md) — the overview and the shared metadata/parameter rules
- [Custom Query Templates](Custom%20Query%20Templates.md) — add or override templates
- [Query and Report API](../rest-api/endpoints/Query%20and%20Report%20API.md) · [Objects API](../rest-api/endpoints/Objects%20API.md) · [Graph API](../rest-api/endpoints/Graph%20API.md)
