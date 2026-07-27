# script_steps_lang

Part of the [FM-Lab schema](../Schema.md) · Language layer · `reference/fm_spec.duckdb` (fm-spec language reference)

The localized projection of every script step in 11 locales: display name, description, parameter summary and the official Claris documentation URL per language. Names are display data only — identity always stays with `step_id`.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `language` | `VARCHAR` |
| `display_name` | `VARCHAR` |
| `description` | `VARCHAR` |
| `parameter` | `VARCHAR` |
| `url` | `VARCHAR` |

**See also:** [script_steps](script_steps.md) · [script_step_name_lookup](script_step_name_lookup.md)
