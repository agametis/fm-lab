# ThemeCatalog

Part of the [FM-Lab schema](../Schema.md) · Layouts · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML ThemeCatalog](../../xml/catalogs/XML%20ThemeCatalog.md)

The layout themes of each file, including the raw CSS rule set (`Theme_XML`). Layouts reference their theme via `uses_theme` links — the basis for "which themes are actually in use?" cleanup queries.

## Columns

| Column | Type |
|---|---|
| `Theme_ID` | `BIGINT` |
| `Theme_Name` | `VARCHAR` |
| `Theme_Display` | `VARCHAR` |
| `Theme_UUID` | `VARCHAR` |
| `Theme_XML` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

**See also:** [Layouts](Layouts.md)
