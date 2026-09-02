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
| `variable_target_marker` | `BOOLEAN` |
| `evidence` | `VARCHAR` |
| `verified_version` | `VARCHAR` |
| `saxml_example` | `VARCHAR` |

## Notes

- 206 of 207 steps are verified against real FileMaker output; `evidence` and `verified_version` mark the exception.
- The main `snippet_template` is a **single-instance exemplar**: for steps with a variable number of item elements (sort levels, find requests, …) it shows one item; the repetition itself — container, item template, notation label — lives in [step_repeat_groups](step_repeat_groups.md).
- `variable_target_marker` (since 1.17.0): `true` for the steps whose snippet carries an empty `<Text/>` step-level marker exactly when a target-typed slot holds a *variable* instead of a field reference (9 steps: 131, 213–215, 218–222). The marker is structural, not an option — emitters inject it at its `element_order` position, decompilers consume it only when a variable target is present. Invariant: marker ⇒ `Text` in `element_order` and `target_slot_kind='field_or_var'`.
- Elements whose existence depends on another option's value (device modes, provider forms) are declared in [step_option_element_bindings](step_option_element_bindings.md); hulls that survive the pruning of unconfigured content in [step_skeleton_elements](step_skeleton_elements.md).

**See also:** [script_steps](script_steps.md) · [step_constraints](step_constraints.md) · [step_options](step_options.md) · [step_repeat_groups](step_repeat_groups.md) · [step_skeleton_elements](step_skeleton_elements.md) · [step_option_element_bindings](step_option_element_bindings.md)
