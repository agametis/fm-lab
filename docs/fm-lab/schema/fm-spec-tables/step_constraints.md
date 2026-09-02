# step_constraints

Part of the [FM-Lab schema](../Schema.md) · Emission layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Structural rules a valid snippet must satisfy beyond per-option typing — e.g. steps that must appear as balanced pairs or only inside a certain block. Each constraint carries its kind, a detail description and evidence.

Since schema 1.14.4 the table doubles as a **bug registry**: documented FileMaker serialization defects (clipboard drops, version skew, save-time corruption) are recorded as constraint rows with their own kinds. Registry entries are a *warning class, never a validity rule* — the affected steps are valid; the risk lies in FileMaker's own serialization, so consumers surface them as notes/warnings, never as errors.

## Constraint kinds

Structural (validity rules):

- `requires_pair` — step is only valid as part of a balanced pair
- `requires_parent` — step is only valid inside a certain block
- `save_invalid_bare` / `save_invalid_nesting` — FileMaker rejects the construct on save
- `silent_failure_pattern` — construct saves but fails silently at runtime

Bug registry (warning class, since 1.14.4):

- `clipboard_loss` — FileMaker drops a slot on copy; an empty slot in pasted XML does not prove it was never set
- `version_skew` — serialization differs between FileMaker versions
- `save_corruption` — FileMaker corrupts the construct on save
- `serialization_unstable` — values shown are display-only, the block is opaque
- `localized_build_defect` — defect only in specific localized builds

Registry evidence is `external-report`, or `paired` where the defect has been reproduced and measured (step 221).

Since schema 1.17.0 the kind vocabulary itself is registered in [constraint_kinds](constraint_kinds.md), which also carries the consumer-facing lead text of the bug-registry kinds.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `constraint_kind` | `VARCHAR` |
| `detail` | `VARCHAR` |
| `evidence` | `VARCHAR` |
| `verified_version` | `VARCHAR` |

`detail` is a payload column and carries the finding, the consumer doctrine and neutral version facts only; curation provenance lives in a source-side `notes` column that — like every curation column — is stripped from the consumer build (since schema 1.16.1, enforced by a build-time payload-hygiene guard).

**See also:** [constraint_kinds](constraint_kinds.md) · [step_xml_map](step_xml_map.md) · [step_options](step_options.md)
