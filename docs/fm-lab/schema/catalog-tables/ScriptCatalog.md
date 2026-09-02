# ScriptCatalog

Part of the [FM-Lab schema](../Schema.md) · Scripts & script steps · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML ScriptCatalog](../../xml/catalogs/XML%20ScriptCatalog.md)

All scripts of the solution, including the folder tree of the Script Workspace: folders and separators are rows too, marked by `Folder_Type` and `Is_Separator`. Besides identity and ordering, the table carries modification metadata and the decoded script options.

## Columns

| Column | Type |
|---|---|
| `Script_ID` | `BIGINT` |
| `Script_Name` | `VARCHAR` |
| `Folder_Type` | `VARCHAR` |
| `Is_Separator` | `BOOLEAN` |
| `Script_UUID` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `Last_Modified_By` | `VARCHAR` |
| `Last_Modified_At` | `VARCHAR` |
| `Option_Bitmask` | `BIGINT` |
| `Is_Hidden` | `BOOLEAN` |
| `Full_Access` | `BOOLEAN` |
| `Sequence_ID` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `Full_Access` = the script runs with full access privileges; `Is_Hidden` = excluded from the Scripts menu.
- `Sequence_ID` preserves the display order of the Script Workspace.
- The steps of each script live in [StepsForScripts](StepsForScripts.md), joined via `Script_UUID`.

**See also:** [StepsForScripts](StepsForScripts.md) · [DDR_ScriptSteps](DDR_ScriptSteps.md) · [ScriptTriggers](ScriptTriggers.md)
