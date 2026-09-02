# constraint_kinds

Part of the [FM-Lab schema](../Schema.md) · Emission layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Registry of the [step_constraints](step_constraints.md) kind vocabulary (since schema 1.17.0). One row per `constraint_kind` in use — a build guard keeps the registry complete — with an optional `consumer_note`: the epistemic lead text a consumer appends when surfacing a constraint of that kind on the decompile side.

## Columns

| Column | Type |
|---|---|
| `constraint_kind` | `VARCHAR` |
| `consumer_note` | `VARCHAR` |

## Notes

- Only the bug-registry kinds carry a `consumer_note`: `clipboard_loss` ("an empty slot here does not prove it was never set") and `serialization_unstable` ("values shown are display-only, the block is opaque"). Structural kinds have `NULL` — they are validity rules, not epistemic warnings.
- 10 rows, mirroring the kind vocabulary documented in [step_constraints](step_constraints.md).
- The consumer build ships **without** the curation `notes` column — prose rationale stays in the fm-spec working copy.

**See also:** [step_constraints](step_constraints.md)
