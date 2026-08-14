# runtime_os_matrix

Part of the [FM-Lab schema](../Schema.md) · Platform/OS layer · `reference/fm_spec.duckdb` (fm-spec language reference)

The **host matrix** — which FileMaker runtime exists on which operating system (since fm-spec schema 1.13.0). FileMaker Pro runs on macOS and Windows, FileMaker Server on macOS, Windows and Ubuntu Linux, FileMaker Go only on iOS/iPadOS; the server-side runtimes (WebDirect, Data API, Custom Web Publishing, OData) inherit the Server host set. Each row carries its provenance: `claris-techspecs` for directly documented hosts, `claris-derived` for the server-side inheritance.

This small table (32 rows) is the **only sanctioned translator between the two platform axes**. The runtime axis ([step_compat](step_compat.md), [function_platform_affinity](function_platform_affinity.md)) and the OS axis ([step_os_affinity](step_os_affinity.md), [function_os_affinity](function_os_affinity.md), the plug-in map in [plugin-spec](../plugin-spec.md)) use deliberately disjoint vocabularies — an OS binding is never turned into a runtime statement, or vice versa, except through this matrix. Its two core applications:

- **Resolving `unsupported` rows.** "Dial Phone is not supported in macOS" resolves against the host OS of the step's runtimes — Pro (macOS, Windows) and Go (iOS) — yielding Windows + iOS. Resolving against "all four OS" would wrongly include Linux, where no runtime that carries the step exists.
- **The Server × OS cross-refinement.** A plug-in function whose vendor flags say *Server = Yes* but *Linux = No* runs under the FileMaker Server script engine — yet fails on Linux-based FileMaker Server, a standard deployment. The server compatibility member joins this matrix against the plug-in OS map to report such functions as conditionally server-compatible (`os_conditional` warnings) instead of silently passing them.

Two deliberate gaps: **Claris Cloud has no rows** — its host OS is not documented by a citable Claris source, and the matrix never guesses (the row set is the honesty boundary). And the WebDirect *client* OS (browsers, including Android) is outside the model entirely: client chrome is not a script-execution environment.

`fm_env` uses the [step_compat](step_compat.md) runtime vocabulary plus two additions: `odata` (server-side, no step_compat column exists) and `ios_sdk` (Claris iOS SDK apps — a runtime term from the plug-in domain; both it and FileMaker Go host on the OS `ios`, which is exactly the double role the split vocabularies keep apart).

## Columns

| Column | Type | Notes |
|---|---|---|
| `fm_env` | `TEXT` | `pro`, `server`, `go`, `webdirect`, `cloud`, `dataapi`, `cwp`, `odata`, `ios_sdk` (CHECK-constrained) |
| `os` | `TEXT` | `macos`, `windows`, `linux`, `ios` (CHECK-constrained) |
| `supported` | `BOOLEAN` | Runtime exists on this OS |
| `provenance` | `TEXT` | `claris-techspecs` or `claris-derived` |
| `note` | `TEXT NOT NULL` | Evidence / derivation |

Primary key: `(fm_env, os)`.

**See also:** [step_os_affinity](step_os_affinity.md) · [function_os_affinity](function_os_affinity.md) · [step_compat](step_compat.md) · [plugin-spec](../plugin-spec.md)
