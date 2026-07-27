# functions_lang

Part of the [FM-Lab schema](../Schema.md) · Language layer · `reference/fm_spec.duckdb` (fm-spec language reference)

The localized projection of every calculation function in 10 locales: display name, localized signature, description, purpose, notes, a worked example and the Claris documentation URL.

## Columns

| Column | Type |
|---|---|
| `function_id` | `INTEGER` |
| `language` | `VARCHAR` |
| `display_name` | `VARCHAR` |
| `signature` | `VARCHAR` |
| `description` | `VARCHAR` |
| `purpose` | `VARCHAR` |
| `notes` | `VARCHAR` |
| `example_1` | `VARCHAR` |
| `return_type_display` | `VARCHAR` |
| `url` | `VARCHAR` |

**See also:** [functions](functions.md) · [function_name_lookup](function_name_lookup.md)
