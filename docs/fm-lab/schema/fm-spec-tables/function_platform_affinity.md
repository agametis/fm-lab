# function_platform_affinity

Part of the [FM-Lab schema](../Schema.md) · Emission layer · `reference/fm_spec.duckdb` (fm-spec language reference)

Curated platform binding of calculation functions (since fm-spec schema 1.12.0). Claris publishes **no** compatibility table for functions — only for script steps ([step_compat](step_compat.md)) — so this table deliberately carries a different semantic: **affinity** ("returns meaningful results only on this platform"), never compatibility ("does not run on this platform"). Every entry names its provenance: derived from a Claris category, from explicit Claris help prose, or curated by hand — the `note` column quotes the evidence.

The seed set covers FileMaker Go (iOS): the five "Mobile functions" category members (GetAVPlayerAttribute, GetSensor, Location, LocationValues, RangeBeacons) plus `Get(NetworkType)` and `Get(TriggerExternalEvent)`, whose help texts explicitly begin "In FileMaker Go, returns …". All current entries are `dedicated` — callable everywhere, degrading outside iOS; no function is `exclusive`.

Consumers: the platform-binding analysis (which scripts are *built for* a platform) and the platform badge on the function pages of the fm-spec schema viewer in the web frontend.

**Runtime axis, not OS axis.** `platform` names FileMaker *runtimes* ([step_compat](step_compat.md) vocabulary). Operating-system statements — "supported only on iOS, iPadOS, and macOS", per-OS path formats, the detection functions of the guard idiom — live in the separate [function_os_affinity](function_os_affinity.md) table, whose `os` column uses a deliberately disjoint vocabulary; [runtime_os_matrix](runtime_os_matrix.md) is the only sanctioned bridge between the axes.

## Columns

| Column | Type | Notes |
|---|---|---|
| `function_id` | `INTEGER` | FK → [functions](functions.md) |
| `platform` | `TEXT` | [step_compat](step_compat.md) vocabulary: `pro`, `server`, `go`, `webdirect`, `cloud`, `dataapi`, `cwp` |
| `affinity` | `TEXT` | `exclusive` (works only there) or `dedicated` (callable everywhere, meaningful only there) |
| `provenance` | `TEXT` | `claris-category`, `claris-prose` or `curated` |
| `note` | `TEXT` | The evidence (category or help-prose quote) |

Primary key: `(function_id, platform)`.

**See also:** [functions](functions.md) · [step_compat](step_compat.md) · [function_os_affinity](function_os_affinity.md) · [runtime_os_matrix](runtime_os_matrix.md)
