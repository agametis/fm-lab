# BaseTableCatalog

Part of the [FM-Lab schema](../Schema.md) · Data model · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML BaseTableCatalog](../../xml/catalogs/XML%20BaseTableCatalog.md)

The base tables of the solution — the schema-level tables as defined under *Manage Database*, independent of how often they appear on the relationship graph. A deliberately small table: the interesting detail lives in [FieldsForTables](FieldsForTables.md) (the fields) and [TableOccurrenceCatalog](TableOccurrenceCatalog.md) (the graph occurrences).

## Columns

| Column | Type |
|---|---|
| `BT_ID` | `BIGINT` |
| `BT_Name` | `VARCHAR` |
| `BT_UUID` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

**See also:** [FieldsForTables](FieldsForTables.md) · [TableOccurrenceCatalog](TableOccurrenceCatalog.md)
