# step_xml_map

Part of the [FM-Lab schema](../Schema.md) · Emission layer · `reference/fm_spec.duckdb` (fm-spec language reference)

How each script step becomes XML: the `snippet_template` for fmxmlsnippet emission, the required `element_order`, the SaXML parameter types, the target-slot classification and a synthetic `saxml_example` per step. Code generation emits from these stored templates instead of letting a model string-build XML.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `snippet_template` | `VARCHAR` |
| `saxml_param_types` | `VARCHAR` |
| `element_order` | `VARCHAR` |
| `target_slot_kind` | `VARCHAR` |
| `evidence` | `VARCHAR` |
| `verified_version` | `VARCHAR` |
| `saxml_example` | `VARCHAR` |

## Notes

- 206 of 207 steps are verified against real FileMaker output; `evidence` and `verified_version` mark the exception.

**See also:** [script_steps](script_steps.md) · [step_constraints](step_constraints.md) · [step_options](step_options.md)
