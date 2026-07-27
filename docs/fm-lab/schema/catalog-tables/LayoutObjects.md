# LayoutObjects

Part of the [FM-Lab schema](../Schema.md) · Layouts · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md)

Every object on every layout — all 22 object types, from edit boxes and buttons to portals, tab controls and web viewers — with the real container hierarchy: `Parent_Object_ID` and `Nesting_Level` reproduce the nesting of tab panels, slide panels, groups and popovers (nesting depth 5 occurs in practice). Position (`Bounds_*`), stacking order (`Z_Order`) and the frequently needed formula texts (hide condition, tooltip, button label, trigger parameter) are extracted into columns.

## Columns

| Column | Type |
|---|---|
| `Layout_ID` | `BIGINT` |
| `Part_Type` | `VARCHAR` |
| `Object_ID` | `BIGINT` |
| `Object_Type` | `VARCHAR` |
| `Object_Name` | `VARCHAR` |
| `Object_Kind` | `INTEGER` |
| `Object_Hash` | `VARCHAR` |
| `Object_UUID` | `VARCHAR` |
| `Bounds_Top` | `INTEGER` |
| `Bounds_Left` | `INTEGER` |
| `Bounds_Bottom` | `INTEGER` |
| `Bounds_Right` | `INTEGER` |
| `Parent_Object_ID` | `BIGINT` |
| `Nesting_Level` | `INTEGER` |
| `Z_Order` | `INTEGER` |
| `Hide_Calculation_Text` | `VARCHAR` |
| `Tooltip_Calculation_Text` | `VARCHAR` |
| `Label_Calculation_Text` | `VARCHAR` |
| `ScriptTrigger_Parameter_Text` | `VARCHAR` |
| `Text_Content` | `VARCHAR` |
| `Object_XML` | `VARCHAR` |
| `File_Name` | `VARCHAR` |

## Notes

- `Object_Type` is canonicalized to English type names at import (the raw attribute is localized) — the full subtype list is enumerated in [Object Types](../object-catalog/Object%20Types.md).
- `Object_ID` is unique only within a layout; `Object_UUID` is the global key.
- `Object_XML` holds the complete raw definition for anything not extracted; field/script/value-list references are already resolved into [ObjectLinks](../object-catalog/ObjectLinks.md) (`displays_field`, `triggers_script`, `uses_valuelist`, `portal_context`, …), including references of button-embedded single steps.

**See also:** [Layouts](Layouts.md) · [LayoutParts](LayoutParts.md) · [ObjectLinks](../object-catalog/ObjectLinks.md)
