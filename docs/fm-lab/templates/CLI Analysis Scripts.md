# CLI Analysis Scripts

**Directory:** `sql/*.sql` · **Run by:** the `duckdb` CLI — **not** the REST API

A library of ready-made queries for the terminal: quick cross-references,
exports and inventories that run directly against the catalog with the `duckdb`
command-line tool. The low-friction, hand-run counterpart to the REST-served
[built-in templates](Built-in%20Query%20Templates.md). Part of the [SQL Templates](SQL%20Templates.md)
family, but outside the `/api/query` path.

## What lives here

- **Inventories** — `list_all_scripts.sql`, `list_all_basetables.sql`,
  `list_all_fields_for_all_tables.sql`, `list_all_mbs_functions.sql`.
- **Where-used lookups** — `display_fields_on_layout.sql`,
  `display_scripts_for_field.sql`, `display_layouts_for_field.sql`,
  `display_calculations_for_field.sql`, `display_scripttext.sql`.
- **Statistics & reports** — `count_fields_per_basetable.sql`,
  `report_file_objects.sql`, `report_file_objects_topcount.sql`.
- **Exports & extraction** — `export_variables_csv.sql`,
  `extract_variables.sql` (+ `_simple` / `_detailed` variants).
- **Derived views** — `create_analysis_views.sql`,
  `create_variables_catalog.sql` build views the analysis layer relies on.
- **The cookbook** — `sample_queries.sql` (and `sample_queries_calcHash.sql`)
  collect canonical catalog queries to read and adapt.

## Running one

Against the catalog symlink (`db/fm_catalog.duckdb` → the active solution):

```bash
duckdb db/fm_catalog.duckdb -c ".read sql/list_all_scripts.sql"
```

These files are meant to be **read, adapted and piped** — a starting point for
ad-hoc analysis rather than a fixed API. When a query proves generally useful,
promote it into a [custom query template](Custom%20Query%20Templates.md) so the
frontend and other callers can reach it too.

## See also

- [SQL Templates](SQL%20Templates.md) — the overview of all template tiers
- [Built-in Query Templates](Built-in%20Query%20Templates.md) — the REST-served equivalents
- [Ingestion Pipeline (XML Import)](Ingestion%20Pipeline%20%28XML%20Import%29.md) — the SQL that builds the catalog these query
- [Folder structure](../Wiki/Folder%20structure.md) — the repository layout
