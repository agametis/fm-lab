# step_options

Part of the [FM-Lab schema](../Schema.md) · Canonical core · `reference/fm_spec.duckdb` (fm-spec language reference)

The option grammar of every script step: one row per step × option with the option key, its value type, whether it is required, where and how it is displayed (label, boolean true/false texts, inverted-label and omit-when-false rules) and the XML path it serializes to. This is what makes deterministic linting of generated steps possible — "is this option allowed here, and is its value legal?" is a table lookup.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `option_key` | `VARCHAR` |
| `option_type` | `VARCHAR` |
| `required` | `BOOLEAN` |
| `display_location` | `VARCHAR` |
| `display_label_en` | `VARCHAR` |
| `true_text` | `VARCHAR` |
| `false_text` | `VARCHAR` |
| `omit_when_false` | `BOOLEAN` |
| `inverted_label` | `BOOLEAN` |
| `xml_path` | `VARCHAR` |
| `sort_order` | `INTEGER` |
| `evidence` | `VARCHAR` |
| `verified_version` | `VARCHAR` |

## Notes

- Enumerated options list their allowed values in [step_option_values](step_option_values.md).
- `evidence` and `verified_version` mark each row as verified fact vs. documented assumption.

**See also:** [script_steps](script_steps.md) · [step_option_values](step_option_values.md) · [step_xml_map](step_xml_map.md)
