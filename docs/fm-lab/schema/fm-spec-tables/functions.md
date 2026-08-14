# functions

Part of the [FM-Lab schema](../Schema.md) · Canonical core · `reference/fm_spec.duckdb` (fm-spec language reference)

The canonical identity of all 367 calculation functions: stable `function_id`, internal `opcode`, English `canonical_name`, return type, category and origin version, plus the flag marking `Get(…)` functions.

## Columns

| Column | Type |
|---|---|
| `function_id` | `INTEGER` |
| `opcode` | `VARCHAR` |
| `category_id` | `INTEGER` |
| `english_id` | `VARCHAR` |
| `canonical_name` | `VARCHAR` |
| `return_type` | `VARCHAR` |
| `origin_version` | `VARCHAR` |
| `is_get_function` | `INTEGER` |
| `url_slug` | `VARCHAR` |
| `source_version` | `VARCHAR` |
| `fetched_at` | `DATE` |

**See also:** [functions_lang](functions_lang.md) · [function_parameters](function_parameters.md) · [function_categories](function_categories.md) · [function_platform_affinity](function_platform_affinity.md)
