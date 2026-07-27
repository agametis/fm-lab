# step_constraints

Part of the [FM-Lab schema](../Schema.md) · Emission layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Structural rules a valid snippet must satisfy beyond per-option typing — e.g. steps that must appear as balanced pairs or only inside a certain block. Each constraint carries its kind, a detail description and evidence.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `constraint_kind` | `VARCHAR` |
| `detail` | `VARCHAR` |
| `evidence` | `VARCHAR` |
| `verified_version` | `VARCHAR` |

**See also:** [step_xml_map](step_xml_map.md) · [step_options](step_options.md)
