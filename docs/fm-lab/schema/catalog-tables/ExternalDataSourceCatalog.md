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
| `File_Name` | `VARCHAR` |

**See also:** [TableOccurrenceCatalog](TableOccurrenceCatalog.md) · [OptionsForValueLists](OptionsForValueLists.md)
