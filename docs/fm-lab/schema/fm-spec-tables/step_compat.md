# step_compat

Part of the [FM-Lab schema](../Schema.md) · Emission layer · `reference/fm_spec.duckdb` (fm-spec language reference)

The platform compatibility matrix of every script step: whether it runs in Pro, on Server, in Go, WebDirect, Cloud, via the Data API and via Custom Web Publishing, plus origin and deprecation versions.

**The source is tri-state, the columns are not.** Claris documents each cell as *Yes*, *No* or *Partial*, and the BOOLEAN columns lose the third value: `true` = Yes, `false` = No, and **`NULL` = Partial — conditionally supported, see the step's notes on its Claris help page**. `NULL` never means "undocumented" and never means "compatible"; only a step missing from the table entirely would mean Claris states nothing. Consumers must preserve this distinction — reporting a Partial step as unsupported (or as fully supported) is exactly the misreading this note exists to prevent.

This table covers **script steps only**. Claris publishes no compatibility table for calculation functions; their platform relationship is curated as *affinity* in [function_platform_affinity](function_platform_affinity.md).

**Runtime axis, not OS axis.** The seven columns name FileMaker *runtimes* — they say nothing about operating systems. That the "Pro" environment splits into macOS and Windows (where *Perform AppleScript* and *Send DDE Execute* behave in opposite ways) is the subject of the separate OS layer: [step_os_affinity](step_os_affinity.md) carries the curated per-OS statements, and [runtime_os_matrix](runtime_os_matrix.md) is the only sanctioned bridge between the two axes.

## Columns

| Column | Type |
|---|---|
| `step_id` | `INTEGER` |
| `originated_in_version` | `VARCHAR` |
| `deprecated_in` | `VARCHAR` |
| `pro` | `BOOLEAN` |
| `server` | `BOOLEAN` |
| `go` | `BOOLEAN` |
| `webdirect` | `BOOLEAN` |
| `cloud` | `BOOLEAN` |
| `dataapi` | `BOOLEAN` |
| `cwp` | `BOOLEAN` |

**See also:** [script_steps](script_steps.md) · [function_platform_affinity](function_platform_affinity.md) · [step_os_affinity](step_os_affinity.md) · [runtime_os_matrix](runtime_os_matrix.md)
