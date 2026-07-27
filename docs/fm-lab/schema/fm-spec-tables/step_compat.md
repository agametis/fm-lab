# step_compat

Part of the [FM-Lab schema](../Schema.md) · Emission layer · `reference/fm_spec.duckdb` (fm-spec language reference)

The platform compatibility matrix of every script step: whether it runs in Pro, on Server, in Go, WebDirect, Cloud, via the Data API and via Custom Web Publishing, plus origin and deprecation versions.

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

**See also:** [script_steps](script_steps.md)
