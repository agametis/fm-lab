# ValueListCatalog

Part of the [FM-Lab schema](../Schema.md) · Value lists · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML ValueListCatalog](../../xml/catalogs/XML%20ValueListCatalog.md)

All value lists with their source type (custom values, field-based, or a wrapper for a value list in another file). The per-source details live in [OptionsForValueLists](OptionsForValueLists.md).

## Columns

| Column | Type |
|---|---|
| `VL_ID` | `BIGINT` |
| `VL_Name` | `VARCHAR` |
| `Source_Type` | `VARCHAR` |
| `VL_UUID` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

**See also:** [OptionsForValueLists](OptionsForValueLists.md)
