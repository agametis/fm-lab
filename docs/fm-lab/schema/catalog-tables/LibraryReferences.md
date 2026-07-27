# LibraryReferences

Part of the [FM-Lab schema](../Schema.md) · File level · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML LibraryCatalog](../../xml/catalogs/XML%20LibraryCatalog.md)

References to embedded libraries of each file — metadata only: the binary blobs themselves are discarded at import.

## Columns

| Column | Type |
|---|---|
| `Library_ID` | `BIGINT` |
| `Library_Key` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

**See also:** [FilesCatalog](../object-catalog/FilesCatalog.md)
