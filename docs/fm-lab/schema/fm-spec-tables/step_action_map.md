# step_action_map

Part of the [FM-Lab schema](../Schema.md) · Action layer · `reference/fm_spec.duckdb` (fm-spec language reference)

The mapping between ActionScript actions and native script steps, including the parameter mapping, aliases, semantic notes and per-row evidence/verification markers.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `action_name` | `VARCHAR` |
| `action_aliases` | `VARCHAR` |
| `param_map` | `VARCHAR` |
| `support` | `VARCHAR` |
| `dev_state` | `VARCHAR` |
| `semantics_note` | `VARCHAR` |
| `fmide_version` | `VARCHAR` |
| `evidence` | `VARCHAR` |
| `verified_version` | `VARCHAR` |

**See also:** [action_catalog](action_catalog.md) · [script_steps](script_steps.md)
