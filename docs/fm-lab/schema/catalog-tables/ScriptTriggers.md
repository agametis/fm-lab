# ScriptTriggers

Part of the [FM-Lab schema](../Schema.md) · Scripts & script steps · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md) (layout & object triggers) · [XML Metadata](../../xml/catalogs/XML%20Metadata.md) (file-level triggers)

All script triggers of the solution: file-level triggers (OnFirstWindowOpen, OnLastWindowClose, …), layout triggers and layout-object triggers. Each row names the trigger event (`Trigger_Action`), the owning object (`Owner_UUID`/`Owner_Type` — Layout, LayoutObject or File) and the script it fires.

## Columns

| Column | Type |
|---|---|
| `Trigger_ID` | `BIGINT` |
| `Trigger_Action` | `VARCHAR` |
| `Trigger_BrowseMode` | `VARCHAR` |
| `Script_ID` | `BIGINT` |
| `Script_Name` | `VARCHAR` |
| `Script_UUID` | `VARCHAR` |
| `Owner_UUID` | `VARCHAR` |
| `Owner_Type` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- In the object graph a trigger produces two links: `trigger_script` (trigger → script) and the structural back-link `trigger_owner` (trigger → its owner, with the trigger type as subrole).

**See also:** [ScriptCatalog](ScriptCatalog.md) · [Layouts](Layouts.md) · [LayoutObjects](LayoutObjects.md)
