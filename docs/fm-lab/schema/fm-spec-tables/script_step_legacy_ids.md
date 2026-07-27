# script_step_legacy_ids

Part of the [FM-Lab schema](../Schema.md) · Canonical core · `reference/fm_spec.duckdb` (fm-spec language reference)

Numeric step IDs that appear in real-world exports but are undocumented or legacy: each with a documentation status, an unknown-ID flag and a display fallback. Keeps consumers from treating an old or unknown ID as an error.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `doc_status` | `VARCHAR` |
| `is_unknown_id` | `BOOLEAN` |
| `display_name` | `VARCHAR` |
| `display_name_en` | `VARCHAR` |

**See also:** [script_steps](script_steps.md)
