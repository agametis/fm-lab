# CustomFunctionsCatalog

Part of the [FM-Lab schema](../Schema.md) · Custom functions · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML CustomFunctionsCatalog](../../xml/catalogs/XML%20CustomFunctionsCatalog.md)

All custom functions with their parameter name list and the DDR hash of their formula. The formula text itself lives in [CalcsForCustomFunctions](CalcsForCustomFunctions.md).

## Columns

| Column | Type |
|---|---|
| `CF_ID` | `BIGINT` |
| `CF_Name` | `VARCHAR` |
| `CF_Display` | `VARCHAR` |
| `CF_UUID` | `VARCHAR` |
| `Parameters` | `VARCHAR[]` |
| `DDR_Hash` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- `DDR_Hash` joins to [DDR_Calculations](DDR_Calculations.md) for chunk-level dependency analysis (which fields, functions and variables the CF references).

**See also:** [CalcsForCustomFunctions](CalcsForCustomFunctions.md) · [DDR_Calculations](DDR_Calculations.md)
