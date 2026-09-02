# VariableUsages

Part of the [FM-Lab schema](../Schema.md) · Calculations & variables · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** derived from [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md) chunks, [XML StepsForScripts](../../xml/catalogs/XML%20StepsForScripts.md) and [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md) merge variables

Every individual usage of a variable with its full context: which script and step, which calculation, which layout object — and whether the variable was written (`set`) or read (`read`). This is the detail table behind [VariablesCatalog](VariablesCatalog.md) and behind the `sets_variable` / `reads_variable` / `displays_variable` graph links.

## Columns

| Column | Type |
|---|---|
| `Variable_Name` | `VARCHAR` |
| `Variable_Scope` | `VARCHAR` |
| `Usage_Type` | `VARCHAR` |
| `Context_Type` | `VARCHAR` |
| `Context_UUID` | `VARCHAR` |
| `Context_Name` | `VARCHAR` |
| `Script_Name` | `VARCHAR` |
| `Script_UUID` | `VARCHAR` |
| `Step_Index` | `BIGINT` |
| `Table_Name` | `VARCHAR` |
| `Field_Name` | `VARCHAR` |
| `Calc_Hash` | `VARCHAR` |
| `Source` | `VARCHAR` |
| `File_Name` | `VARCHAR` |
| `Scope_Anchor` | `VARCHAR` |

## Notes

- `Context_Type` values include `script_step`, `calculation`, `auto_enter_calc`, `custom_function`, `layout_object` and `record_access_calc` (a variable read inside a Custom Record Privilege calculation).
- `Source` records how the usage was detected (`set_variable_step`, `ddr_chunk`, `mbs_variable_call`, `merge_variable`, `regex_fallback`).

**See also:** [VariablesCatalog](VariablesCatalog.md) · [DDR_Calculations](DDR_Calculations.md)
