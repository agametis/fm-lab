# script_triggers_lang

Part of the [FM-Lab schema](../Schema.md) · Language layer · `reference/fm_spec.duckdb` (fm-spec language reference)

The localized display labels of the script-trigger events, exactly as FileMaker's trigger dialogs write them (`BeiObjektBetreten` for `OnObjectEnter` in German, and so on) — 11 languages per event. Served through `GET /api/reference/trigger-events` ([Reference Database API](../../rest-api/endpoints/Reference%20Database%20API.md)) and used to localize the trigger displays in the web frontend.

## Columns

| Column | Type |
|---|---|
| `trigger_id` | `INTEGER` |
| `language` | `VARCHAR` |
| `event_label` | `VARCHAR` |

## Notes

- The language column is named `language` — not `locale`, which some other `*_lang` tables use.
- `trigger_id` joins to [script_triggers](script_triggers.md); consumers fall back to the canonical `event_name` for languages without a row.

**See also:** [script_triggers](script_triggers.md) · [script_steps_lang](script_steps_lang.md)
