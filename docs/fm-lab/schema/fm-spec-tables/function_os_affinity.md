# function_os_affinity

Part of the [FM-Lab schema](../Schema.md) · Platform/OS layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Curated **operating-system affinity** of calculation functions (since fm-spec schema 1.13.0) — the function half of the OS sub-axis, sibling of [step_os_affinity](step_os_affinity.md) and complement to the runtime-level [function_platform_affinity](function_platform_affinity.md). Same ground rules: curated and sparse, hand-verified with a documentation quote per row, **absence of a row means "Claris states nothing"**, and the OS vocabulary (`macos`, `windows`, `linux`, `ios` — `ios` is the *operating system* hosting both FileMaker Go and Claris iOS SDK apps) never mixes with runtime terms.

On top of the three classes shared with the step table (`exclusive`, `unsupported`, `variant`), functions have a fourth:

- **`exclusive`** — supported only on the listed OS. Examples: the Core ML trio *ComputeModel*, *GetModelAttributes*, *GetLiveText* → macOS + iOS; `Get(TouchKeyboardState)` and `Get(TriggerGestureInfo)` → Windows + iOS (the Go half of "FileMaker Go and Windows" resolves to the OS iOS).
- **`unsupported`** — source-true inverse statements, e.g. `Get(SystemAppearance)` and `Get(HighContrastState)`: "not supported and returns an empty string in FileMaker WebDirect when evaluated by a Linux host".
- **`variant`** — runs everywhere with OS-dependent results: the path-function family (per-OS path formats), window geometry (per-OS coordinate origins), modifier-key codes, printer-name structure. Documentation knowledge for the schema viewer; never a findings row.
- **`os_probe`** — the detection functions `Get(SystemPlatform)`, `Get(Device)`, `Get(SystemVersion)`, `Get(ApplicationArchitecture)`: they *return* the OS at runtime. For these rows `os` is `NULL` — a probe is the **guard idiom** developers wrap around OS-bound steps (`If [Get(SystemPlatform) = 1]` → *Perform AppleScript*), context evidence rather than a binding.

Because `os` is `NULL` on probe rows the table has no primary key; the build enforces uniqueness of `(function_id, os)` and the rule that a probe function never also carries binding rows.

Consumers: the OS-binding member `platform_os_functions` of the [platform-os-binding test set](../../Wiki/Analysis%20Tests.md#platform-tests) (including functions reached transitively through custom functions) and the OS badges on the function pages of the fm-spec schema viewer.

## Columns

| Column | Type | Notes |
|---|---|---|
| `function_id` | `INTEGER` | FK → [functions](functions.md) |
| `os` | `TEXT` | `macos`, `windows`, `linux`, `ios`; `NULL` only for `os_probe` rows |
| `affinity` | `TEXT` | `exclusive`, `unsupported`, `variant`, `os_probe` |
| `provenance` | `TEXT` | `claris-prose` (help-prose quote) |
| `note` | `TEXT NOT NULL` | The documentation quote / verification evidence |

**See also:** [step_os_affinity](step_os_affinity.md) · [runtime_os_matrix](runtime_os_matrix.md) · [function_platform_affinity](function_platform_affinity.md)
