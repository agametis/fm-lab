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
| `Trigger_XML` | `VARCHAR` |
| `Trigger_FindMode` | `VARCHAR` |
| `Trigger_PreviewMode` | `VARCHAR` |
| `Trigger_ScriptParameter_FieldName` | `VARCHAR` |
| `Trigger_Parameter_Text` | `VARCHAR` |

## Notes

- In the object graph a trigger produces up to **four** kinds of links: the granular `trigger_script` (trigger → script — **never counts for where-used**), the structural back-link `trigger_owner` (trigger → its owner, with the event as subrole), the owner's counting mirror `triggers_script · <event>` (owner → script — the single where-used truth), and, for OnWindowTransaction, candidate edges `reads_field · transaction_parameter_field` derived from the parameter field name.
- `Trigger_XML` keeps the raw trigger fragment, populated **only** for `Owner_Type` Layout/File (object-level triggers live in [LayoutObjects.Object_XML](LayoutObjects.md)). It feeds the resolve pass that harvests the trigger *parameter* calculations, so objects referenced only in a layout- or file-trigger parameter show up in where-used.
- The mode flags (`Trigger_BrowseMode`, `Trigger_FindMode`, `Trigger_PreviewMode`) are raw passthrough: SaXML writes only the **activated** modes, so `NULL` means "mode off", never "unknown".
- `Trigger_ScriptParameter_FieldName` is the OnWindowTransaction attribute naming the field whose content FileMaker includes in the JSON script parameter — a late-bound name reference without table qualification, resolved into name-candidate edges only.
- `Trigger_Parameter_Text` is the structural plaintext of the trigger's parameter calculation (all three owner levels). It fills `Formula_Text` of the matching `script_trigger_parameter` instances in [CalculationsCatalog](CalculationsCatalog.md) and provides them even for files without DDR-Info.

**See also:** [ScriptCatalog](ScriptCatalog.md) · [Layouts](Layouts.md) · [LayoutObjects](LayoutObjects.md)
