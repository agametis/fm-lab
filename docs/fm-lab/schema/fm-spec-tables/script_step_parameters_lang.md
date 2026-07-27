# script_step_parameters_lang

Part of the [FM-Lab schema](../Schema.md) · Language layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Localized names and descriptions of the individual script-step parameters/options, one row per step × parameter × language — the prose that documentation lookups show for each option.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `language` | `VARCHAR` |
| `param_index` | `INTEGER` |
| `name` | `VARCHAR` |
| `description` | `VARCHAR` |

**See also:** [script_steps_lang](script_steps_lang.md) · [step_options](step_options.md)
