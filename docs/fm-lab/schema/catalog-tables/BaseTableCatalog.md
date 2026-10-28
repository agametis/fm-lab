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
| `BT_Comment` | `VARCHAR` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the object's `<UUID>` element: timestamp as text (local time of the editing client, no time zone), user name, account (empty → `NULL`) and change counter. [ObjectChangeMeta](ObjectChangeMeta.md) collects them across all object types with a typed timestamp.

**See also:** [FieldsForTables](FieldsForTables.md) · [TableOccurrenceCatalog](TableOccurrenceCatalog.md)
