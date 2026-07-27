# Codegen API

Three stateless compute endpoints under `/api/codegen/*` wrap the fmgen pipeline (canonical script textform ⇄ paste-ready `fmxmlsnippet` XML). They never write to the catalog — results are returned to the caller. The FM-Lab VS Code extension uses these endpoints for its lint/compile/paste-import features.

All three accept a JSON body (`Content-Type: application/json`) and return the standard envelope (see [REST API Conventions](../REST%20API%20Conventions.md)). The [reference database](Reference%20Database%20API.md) (`fm_spec.duckdb`) must be installed; otherwise every call fails with `503 CODEGEN_NOT_AVAILABLE`.

**Solution scoping:** the `X-Solution` header selects which solution catalog is used for reference resolution (see [Solution scoping (X-Solution)](../REST%20API%20Conventions.md#solution-scoping-x-solution)). `lint` never touches the catalog; `compile` requires it; `decompile` uses it only for optional enrichment.

**In-band vs HTTP errors:** a draft with error-severity findings, a failed validation gate, or an unresolvable reference is a *normal result* (`200` with `ok: false` and populated diagnostics) — HTTP errors are reserved for invalid requests and environment failures:

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing/oversized body fields |
| `CODEGEN_NOT_AVAILABLE` | 503 | fmgen pipeline or reference database not installed |
| `CODEGEN_TIMEOUT` | 504 | Subprocess exceeded the time limit (default 30 s) |
| `CODEGEN_ERROR` | 500 | Environment/execution failure (e.g. catalog DB missing) |

---

## POST /api/codegen/lint

Fast parse + lint of a script draft for editor diagnostics. Reference database only — no catalog access.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Script draft in fmgen canonical text notation (max 500 000 chars) |

**Response `data`**

```json
{
  "ok": true,
  "lint": [],
  "steps": [ { "line": 3, "stepId": 89, "canonicalName": "Set Variable", "enabled": true } ],
  "normalization": { "…": "…" }
}
```

`lint[]` carries the diagnostics (empty when clean); `steps[]` lists each parsed step with its line, resolved step ID and canonical name.

## POST /api/codegen/compile

Full pipeline: parse → resolve references against the solution catalog → emit `fmxmlsnippet` XML → validation gate.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Script draft in canonical text notation (max 500 000 chars) |
| `file` | string | yes | Target FileMaker file in the catalog — reference resolution is scoped to this file |

**Response `data`**

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` when the pipeline finished clean and produced a snippet |
| `exitCode` | integer | Raw pipeline exit code (`0` clean, `2` error-severity findings) |
| `lint` | array | Lint findings from the parse phase |
| `resolution` | object \| null | Machine-readable resolution report: how each referenced object name mapped to a real catalog ID |
| `gate` | object \| null | Validation-gate verdict |
| `snippet` | string \| null | The generated `fmxmlsnippet` XML, paste-ready for FileMaker |
| `log` | string[] | Human-readable phase summary |

Example:

```bash
curl -X POST http://localhost:3003/api/codegen/compile \
  -H "Content-Type: application/json" \
  -d '{"text": "Set Variable [ $count ; 0 ]\nExit Script [ ]", "file": "Contacts"}'
```

## POST /api/codegen/decompile

Reverse direction: convert `fmxmlsnippet` XML (e.g. clipboard content copied from FileMaker's script editor) into the canonical text form.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `xml` | string | yes | The `fmxmlsnippet` XML (max 2 000 000 chars) |
| `file` | string | no | Optional catalog file — used only to enrich layout references with their table occurrence |

**Response `data`**

On success: `ok`, `text` (canonical textform), `steps[]`, `lossy` (count of elements that could not be represented losslessly). On decompile problems: `{ "ok": false, "errors": […], "text": null }` — still HTTP 200.

Decompilation is table-driven from the reference database and works for localized exports: display names are informational, step IDs are authoritative, and calculations are canonicalized to English function names.

---

See also: [Reference Database API](Reference%20Database%20API.md) (grammar data behind the emitter), [REST API Conventions](../REST%20API%20Conventions.md).
