# function_parameters_lang

Part of the [FM-Lab schema](../Schema.md) · Language layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Localized names and descriptions of every function parameter, one row per function × position × language.

## Columns

| Column | Type |
|---|---|
| `function_id` | `INTEGER` |
| `position` | `INTEGER` |
| `language` | `VARCHAR` |
| `name` | `VARCHAR` |
| `description` | `VARCHAR` |

**See also:** [function_parameters](function_parameters.md) · [functions_lang](functions_lang.md)
