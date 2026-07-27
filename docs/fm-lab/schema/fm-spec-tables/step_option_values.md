# step_option_values

Part of the [FM-Lab schema](../Schema.md) · Canonical core · `reference/fm_spec.duckdb` (fm-spec language reference)

The allowed values of enumerated step options: one row per step × option × value with the exact XML value and its English display text.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `option_key` | `VARCHAR` |
| `xml_value` | `VARCHAR` |
| `display_text_en` | `VARCHAR` |
| `evidence` | `VARCHAR` |

**See also:** [step_options](step_options.md)
