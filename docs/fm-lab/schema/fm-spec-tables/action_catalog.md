# action_catalog

Part of the [FM-Lab schema](../Schema.md) · Action layer · `reference/fm_spec.duckdb` (fm-spec language reference)

The fmIDE ActionScript vocabulary: every action with its classification, grouping, accepted literals, observed parameter keys, plugin requirements (MBS/Hiatus) and support state — the target language for text-form script authoring via fmIDE.

## Columns

| Column | Type |
|---|---|
| `action_name` | `VARCHAR` |
| `action_key` | `VARCHAR` |
| `classification` | `VARCHAR` |
| `step_id` | `INTEGER` |
| `alias_of` | `VARCHAR` |
| `accepted_literals` | `VARCHAR` |
| `action_group` | `VARCHAR` |
| `subgroup` | `VARCHAR` |
| `support` | `VARCHAR` |
| `dev_state` | `VARCHAR` |
| `param_keys_observed` | `VARCHAR` |
| `requires_mbs` | `BOOLEAN` |
| `requires_hiatus` | `BOOLEAN` |
| `is_disabled` | `BOOLEAN` |
| `fmide_version` | `VARCHAR` |
| `evidence` | `VARCHAR` |

**See also:** [step_action_map](step_action_map.md)
