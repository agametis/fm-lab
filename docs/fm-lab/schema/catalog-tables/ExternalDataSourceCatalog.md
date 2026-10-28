# ExternalDataSourceCatalog

Part of the [FM-Lab schema](../Schema.md) · Data model · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML ExternalDataSourceCatalog](../../xml/catalogs/XML%20ExternalDataSourceCatalog.md)

The external data sources of each file — the entries of *Manage External Data Sources* with their type and path list. Table occurrences and external value lists reference these entries via `data_source` links.

## Columns

| Column | Type |
|---|---|
| `DS_ID` | `BIGINT` |
| `DS_Name` | `VARCHAR` |
| `DS_Type` | `VARCHAR` |
| `Path` | `VARCHAR` |
| `DS_UUID` | `VARCHAR` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the object's `<UUID>` element: timestamp as text (local time of the editing client, no time zone), user name, account (empty → `NULL`) and change counter. [ObjectChangeMeta](ObjectChangeMeta.md) collects them across all object types with a typed timestamp.

**See also:** [TableOccurrenceCatalog](TableOccurrenceCatalog.md) · [OptionsForValueLists](OptionsForValueLists.md)
