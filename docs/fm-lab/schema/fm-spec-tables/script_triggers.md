# script_triggers

Part of the [FM-Lab schema](../Schema.md) · Canonical core · `reference/fm_spec.duckdb` (fm-spec language reference)

The canonical identity of all 26 FileMaker script-trigger events, each with its stable numeric `trigger_id` (the slot ID SaXML writes as `ScriptTrigger/@id`), its owner level, its English `event_name`, whether the trigger dialog accepts a script parameter, and the FileMaker version the event originated in.

The slot-ID ranges are level-bound: **object** level 1–8 (8 events), **layout** level 101–113 (12 events), **file** level 201–209 (6 events). These IDs are load-bearing beyond the reference: the solution catalog derives its synthetic ScriptTrigger UUIDs (`trig_<id>_<OwnerUUID>_<File>`) from them, and the [ScriptTrigger](../object-types/ScriptTrigger.md) sub-nodes and API trigger handling address events by the same IDs.

## Columns

| Column | Type |
|---|---|
| `trigger_id` | `INTEGER` |
| `level` | `VARCHAR` |
| `event_name` | `VARCHAR` |
| `parameter_capable` | `BOOLEAN` |
| `has_parameter_field_attr` | `BOOLEAN` |
| `since_version` | `VARCHAR` |
| `since_version_num` | `INTEGER` |

## Notes

- `level` is `object` / `layout` / `file` — the owner type the event can hang on.
- `parameter_capable` marks events whose dialog accepts a parameter calculation; `has_parameter_field_attr` marks the OnWindowTransaction special case that additionally carries a `scriptParameterFieldName` attribute.
- `since_version_num` is the numeric comparison key — version comparisons never run on the string.
- `ScriptTriggers.Trigger_ID` in the solution catalog joins directly against `trigger_id`.

**See also:** [script_triggers_lang](script_triggers_lang.md) · [ScriptTrigger](../object-types/ScriptTrigger.md) · [ScriptTriggers](../catalog-tables/ScriptTriggers.md)
