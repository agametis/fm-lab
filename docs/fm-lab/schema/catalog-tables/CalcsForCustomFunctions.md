# CalcsForCustomFunctions

Part of the [FM-Lab schema](../Schema.md) · Custom functions · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML CalcsForCustomFunctions](../../xml/catalogs/XML%20CalcsForCustomFunctions.md)

The formula of every custom function: the plain calculation text plus the same formula tokenized into typed code chunks (`Code_Chunks` — text and reference tokens as a nested list), mirroring the DDR chunk model at the row level.

## Columns

| Column | Type |
|---|---|
| `CF_ID` | `BIGINT` |
| `CF_Name` | `VARCHAR` |
| `CF_UUID` | `VARCHAR` |
| `Calculation_Code` | `VARCHAR` |
| `Code_Chunks` | `STRUCT("type" VARCHAR, "content" VARCHAR)[]` |
| `DDR_Hash` | `VARCHAR` |
| `DDR_UUID` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

**See also:** [CustomFunctionsCatalog](CustomFunctionsCatalog.md) · [DDR_Calculations](DDR_Calculations.md)
