# function_parameters

Part of the [FM-Lab schema](../Schema.md) · Canonical core · `reference/fm_spec.duckdb` (fm-spec language reference)

The parameter positions of every calculation function: one row per function × position with the optional and variadic flags — the structural half of a function signature (the localized parameter names live in [function_parameters_lang](function_parameters_lang.md)).

## Columns

| Column | Type |
|---|---|
| `function_id` | `INTEGER` |
| `position` | `INTEGER` |
| `is_optional` | `INTEGER` |
| `is_variadic` | `INTEGER` |

**See also:** [functions](functions.md) · [function_parameters_lang](function_parameters_lang.md)
