# step_os_affinity

Part of the [FM-Lab schema](../Schema.md) · Platform/OS layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Curated **operating-system affinity** of script steps (since fm-spec schema 1.13.0) — the OS sub-axis of the platform model. Claris publishes no structured OS table (unlike the runtime matrix in [step_compat](step_compat.md)); the OS statements exist only as help prose. This table is therefore a **curated, sparse** set: every row is hand-verified and quotes its documentation evidence in `note`. **Absence of a row means "Claris states nothing" — never "runs on every OS".**

The OS vocabulary is strictly separated from the runtime vocabulary: `os` holds only `macos`, `windows`, `linux`, `ios`. Here **`ios` is the operating system** — it hosts two runtimes, FileMaker Go *and* Claris iOS SDK apps. Runtime terms (`go`, `ios_sdk`, `pro`, …) never appear in an OS column, and OS terms never appear in [step_compat](step_compat.md).

Three affinity classes:

- **`exclusive`** — the step works only on the listed OS (one row per OS). Examples: *Perform AppleScript* → macOS, *Send DDE Execute* → Windows, *Configure Machine Learning Model* → macOS + iOS (Apple Core ML). On every other OS the step is silently ignored or fails — invisible to the runtime matrix, which lists these steps as plain "Pro".
- **`unsupported`** — Claris explicitly names an OS the step does **not** work on ("The Dial Phone script step is not supported in macOS"). Stored **source-true inverse**; consumers resolve the effective OS set against the host OS of the step's runtimes via [runtime_os_matrix](runtime_os_matrix.md) — never against all four OS. Dial Phone (¬macOS) therefore resolves to Windows + iOS, *not* Linux (FileMaker Pro has no Linux build).
- **`variant`** — the step runs everywhere but behaves OS-dependently (per-OS plug-in file extensions, window-coordinate origins, …). Variant rows are documentation knowledge for the schema viewer, not bindings — with one exception: *Send Event* is a **dual-variant** (one step ID carrying two OS-exclusive option sets; a configuration made for macOS does nothing useful on Windows and vice versa) and is the only variant the analysis layer reports.

Consumers: the OS-binding member `platform_os_steps` of the [platform-os-binding test set](../../Wiki/Analysis%20Tests.md#platform-tests) and the OS badges on the step pages of the fm-spec schema viewer.

## Columns

| Column | Type | Notes |
|---|---|---|
| `step_id` | `INTEGER` | FK → [script_steps](script_steps.md) |
| `os` | `TEXT` | `macos`, `windows`, `linux`, `ios` (CHECK-constrained) |
| `affinity` | `TEXT` | `exclusive`, `unsupported`, `variant` |
| `provenance` | `TEXT` | `claris-prose` (help-prose quote) or `claris-name` (canonical name suffix, e.g. *Speak (macOS)*) |
| `note` | `TEXT NOT NULL` | The documentation quote / verification evidence |

Primary key: `(step_id, os)`.

**See also:** [function_os_affinity](function_os_affinity.md) · [runtime_os_matrix](runtime_os_matrix.md) · [step_compat](step_compat.md)
