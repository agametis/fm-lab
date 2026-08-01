# CustomFunctionsCatalog

Part of the [FM-Lab schema](../Schema.md) · Custom functions · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML CustomFunctionsCatalog](../../xml/catalogs/XML%20CustomFunctionsCatalog.md)

All custom functions with their parameter name list and the DDR hash of their formula, including the folder tree of the Manage Custom Functions dialog: folders and separators are rows too, marked by `Folder_Type` and `Is_Separator`. The formula text itself lives in [CalcsForCustomFunctions](CalcsForCustomFunctions.md).

## Columns

| Column | Type |
|---|---|
| `CF_ID` | `BIGINT` |
| `CF_Name` | `VARCHAR` |
| `CF_Display` | `VARCHAR` |
| `CF_UUID` | `VARCHAR` |
| `Parameters` | `VARCHAR[]` |
| `DDR_Hash` | `VARCHAR` |
| `Folder_Type` | `VARCHAR` |
| `Is_Separator` | `BOOLEAN` |
| `Sequence_ID` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `DDR_Hash` joins to [DDR_Calculations](DDR_Calculations.md) for chunk-level dependency analysis (which fields, functions and variables the CF references).
- `Sequence_ID` preserves the display order of the Manage Custom Functions dialog; it is *not* `CF_ID`, which reflects creation order. The folder tree is a flat sequence (`Folder_Type = 'True'` opens a folder, `'Marker'` closes it), so reconstructing the nesting needs document order.
- Folder and separator rows are excluded from the `CustomFunction` entries in [ObjectCatalog](../object-catalog/ObjectCatalog.md) — the folders appear there as [Folder](../object-types/Folder.md) objects instead. Filter them out (`Folder_Type IS NULL AND NOT Is_Separator`) whenever you count or measure custom functions directly on this table: a folder row carries no `Parameters`, so it is otherwise indistinguishable from a parameterless function.

**See also:** [CalcsForCustomFunctions](CalcsForCustomFunctions.md) · [DDR_Calculations](DDR_Calculations.md)
