# Results API

Endpoints under `/api/results/*` expose the **unified result layer**: one normative envelope for every result-capable unit — rule dashboards, custom queries and [Analysis Tests](../../Wiki/Analysis%20Tests.md) — regardless of how it was produced. Reads never compute anything; they serve the per-solution cache that solution-scope runs (dashboard chips, test runs, explicit triggers) write into. The cache is keyed by the catalog fingerprint, so a new import invalidates it implicitly.

Every envelope carries the two-axis state (`runStatus`: ran / failed — `resultState`: error / warning / neutral / ok), the unit's declared default value with its `unit` (consolidation sums are only ever built within one unit — finding counts never mix with other metrics), timing and provenance. Errors follow [Error responses](../REST%20API%20Conventions.md#error-responses).

## GET /api/results/summary

Flat envelope map from the cache — one entry per result-capable unit that has run, `pending` for the rest. Never computes.

| Parameter | Type | Description |
|---|---|---|
| `kinds` | csv | Restrict to unit kinds: `dashboard`, `query`, `test` |

## GET /api/results/aggregate

Folder-hierarchy consolidation — a pure fold over the cached envelopes: per node the state `counts`, the `worst` state, per-unit `sums` (e.g. `{ "findings": 30623, "scripts": 36 }` — kept separate by unit), and coverage (`covered` / `declared` / `total`).

| Parameter | Type | Description |
|---|---|---|
| `root` | string | Subtree root (folder path); empty = whole hierarchy |
| `kinds` | csv | As above |

## GET /api/results/registry

The declaration surface: every result-capable unit with its `ref` (`kind`, `id`), folder rubric, title, icon, severity, declared `unit` and source. This is the list the run trigger and the aggregate operate over; units without a result declaration appear with `unit: null` and stay chipless.

## POST /api/results/run

Explicit trigger. Body:

```json
{
  "targets": [
    { "kind": "dashboard", "id": "platform_compat_server" },
    { "kind": "folder", "path": "static-code-analysis/platform", "kinds": ["dashboard"] }
  ],
  "mode": "missing"
}
```

Targets are singles (`dashboard` / `query` by id — they run even without a registry entry; a missing declaration becomes a per-unit failure, not a `400`) or `folder` subtrees (expanded via the registry, optionally narrowed by `kinds`). `mode` is `missing` (default — run only units without a cached envelope) or `refresh` (re-run all resolved targets). Deduplicated targets above the cap of 500 are rejected with `400 VALIDATION_ERROR` — chunk per top-level folder. The response reports the executed envelopes plus how many targets were skipped because they were already cached, so idempotent re-triggers stay visible.
