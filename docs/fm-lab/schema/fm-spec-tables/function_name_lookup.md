# function_name_lookup

Part of the [FM-Lab schema](../Schema.md) · Language layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Reverse lookup from any function name in any locale to the canonical `function_id`, including the chunk role the name plays in parsed calculations.

## Columns

| Column | Type |
|---|---|
| `lookup_name` | `VARCHAR` |
| `function_id` | `INTEGER` |
| `match_source` | `VARCHAR` |
| `chunk_role` | `VARCHAR` |
| `is_primary` | `INTEGER` |

**See also:** [functions](functions.md) · [functions_lang](functions_lang.md)
