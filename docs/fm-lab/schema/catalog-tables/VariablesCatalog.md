# VariablesCatalog

Part of the [FM-Lab schema](../Schema.md) · Calculations & variables · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** derived from [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md) chunks, [XML StepsForScripts](../../xml/catalogs/XML%20StepsForScripts.md) and [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md) merge variables

Aggregated overview of every script variable, one row per distinct variable per scope anchor: set/read counts, the scripts and files it appears in, and a reliability marker for the extraction source. Variables are synthetic objects — FileMaker has no variable catalog of its own, so this table is derived from DDR chunks, Set Variable steps, merge variables and plugin calls.

## Columns

| Column | Type |
|---|---|
| `Variable_Name` | `VARCHAR` |
| `Variable_Scope` | `VARCHAR` |
| `Scope_Anchor` | `VARCHAR` |
| `Display_Name` | `VARCHAR` |
| `Normalized_Name` | `VARCHAR` |
| `Script_UUID` | `VARCHAR` |
| `Set_Count` | `BIGINT` |
| `Read_Count` | `BIGINT` |
| `Script_Count` | `BIGINT` |
| `File_Count` | `BIGINT` |
| `Files` | `VARCHAR[]` |
| `First_Seen_Context` | `VARCHAR` |
| `Has_Spaces` | `BOOLEAN` |
| `Source_Reliability` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- `Variable_Scope`: `local` (`$`), `global` (`$$`), `superglobal` (`$$$`, MBS Plugin), `let_local` (Let-bound).
- The scope anchor is the script for local variables, the file for global variables, `__global` for superglobals; the variable's `Object_UUID` in [ObjectCatalog](../object-catalog/ObjectCatalog.md) is derived from scope + anchor + name.
- `Source_Reliability` grades the evidence: `ddr`, `mbs`, `merge`, `regex`.

**See also:** [VariableUsages](VariableUsages.md) · [ObjectCatalog](../object-catalog/ObjectCatalog.md)
