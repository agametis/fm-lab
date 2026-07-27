# BaseDirectoryCatalog

Part of the [FM-Lab schema](../Schema.md) · File level · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML BaseDirectoryCatalog](../../xml/catalogs/XML%20BaseDirectoryCatalog.md)

The base directories defined in each file — named path anchors (relative-to semantics included) that container fields and script steps can resolve external paths against.

## Columns

| Column | Type |
|---|---|
| `BD_Name` | `VARCHAR` |
| `BD_ID` | `BIGINT` |
| `BD_RelativeTo` | `VARCHAR` |
| `BD_UUID` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

**See also:** [FileOptionsCatalog](FileOptionsCatalog.md)
