# script_step_name_lookup

Part of the [FM-Lab schema](../Schema.md) · Language layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Reverse lookup from any step name in any locale (including aliases and historical names) to the canonical `step_id`. This is what lets a developer write or read script text in their own language while the system resolves to stable IDs.

## Columns

| Column | Type |
|---|---|
| `lookup_name` | `VARCHAR` |
| `step_id` | `INTEGER` |
| `match_source` | `VARCHAR` |
| `is_primary` | `INTEGER` |

## Notes

- `match_source` records where the name form comes from; `is_primary` marks the preferred display form.

**See also:** [script_steps](script_steps.md) · [script_steps_lang](script_steps_lang.md)
