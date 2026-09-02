# StepsForScripts

Part of the [FM-Lab schema](../Schema.md) · Scripts & script steps · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML StepsForScripts](../../xml/catalogs/XML%20StepsForScripts.md)

Every script step of every script, one row per step, ordered by `Step_Index`. `Step_ID` is the numeric, locale-independent step type (identical to `script_steps.step_id` in fm-spec), while `Step_Name` is the localized display name written by the exporting client. Frequently used parameters are extracted into dedicated columns; the raw parameter XML remains available as a last resort.

## Columns

| Column | Type |
|---|---|
| `Script_ID` | `BIGINT` |
| `Script_Name` | `VARCHAR` |
| `Script_UUID` | `VARCHAR` |
| `Step_Index` | `BIGINT` |
| `Step_ID` | `BIGINT` |
| `Step_Name` | `VARCHAR` |
| `Is_Enabled` | `BOOLEAN` |
| `Step_UUID` | `VARCHAR` |
| `DDR_Hash` | `VARCHAR` |
| `DDR_UUID` | `VARCHAR` |
| `Parameters_XML` | `VARCHAR` |
| `Step_XML` | `VARCHAR` |
| `Parameter_Type` | `VARCHAR` |
| `Variable_Name` | `VARCHAR` |
| `Calculation_Text` | `VARCHAR` |
| `Boolean_Type` | `VARCHAR` |
| `Boolean_Value` | `VARCHAR` |
| `File_Name` | `VARCHAR` |
| `Inserted_Text` | `VARCHAR` |
| `Comment_Text` | `VARCHAR` |
| `Opens_Window` | `BOOLEAN` |

## Notes

- Always filter or group by `Step_ID`, never by `Step_Name` — SaXML writes step names in the UI language of the exporting client.
- Extracted parameter columns: `Variable_Name` (Set Variable), `Calculation_Text` (the step's main calc expression), `Inserted_Text`, `Comment_Text`, `Boolean_Type`/`Boolean_Value` (on/off style options).
- `Opens_Window` (schema 1.16.0) is a derived flag: `TRUE` for every New Window step, and for Go to Related Record when a `<WindowReference>` option is present — the base signal for window-lifecycle analyses.
- `Step_XML`/`Parameters_XML` hold the raw fragment; object references inside them are already resolved into [ObjectLinks](../object-catalog/ObjectLinks.md) — query the edge, not the XML.
- `DDR_UUID` joins to [DDR_ScriptSteps](DDR_ScriptSteps.md) for the human-readable step text.
- Script steps carry no per-instance ID in the export, so a healed duplicate step's replacement UUID is keyed by `(script identity, Step_Index)` — stable across re-imports only as long as the script is not restructured. See [UUID Healing and Duplicate Census](../UUID%20Healing%20and%20Duplicate%20Census.md).

**See also:** [ScriptCatalog](ScriptCatalog.md) · [DDR_ScriptSteps](DDR_ScriptSteps.md) · [ObjectLinks](../object-catalog/ObjectLinks.md)
