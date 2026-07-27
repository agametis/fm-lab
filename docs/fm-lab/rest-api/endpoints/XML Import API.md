# XML Import API

Endpoints under `/api/xml/*` drive the XML-to-catalog conversion pipeline for a solution: inspect the inbox, start/cancel conversions, and follow progress live via Server-Sent Events.

**Solution scoping (special in this group):** the target solution is resolved with this precedence: explicit `?solution=<id>` query parameter or `"solution"` body field → `X-Solution` header → server-default solution. Unknown ids yield `404 SOLUTION_NOT_FOUND`. Imports of *different* solutions may run in parallel; a second import of the *same* solution is rejected.

**Locking:** the per-solution lock file is shared with the CLI pipeline (`convert-xml`). Whichever side starts first wins; the other receives `409 ALREADY_RUNNING`. Stale locks (dead process) are ignored automatically.

---

## GET /api/xml/status

Inbox listing and run state for the context solution.

**Response `data`:** one entry per XML file in the solution's `xml/` folder with a `status` of `new` (never imported), `outdated` (changed since last import) or `current`; plus `running` (boolean) and, while a run is active, a flat `active_run` (`phase`, `pct`, `processed`, `total`) for lightweight polling.

## GET /api/xml/runs

All currently running imports **across all solutions** (union of API-started runs and live CLI locks). API runs carry phase/progress; CLI runs report `{ solution, started_at, source: "cli", pid }`.

## POST /api/xml/convert

Start a conversion job. Returns immediately with `202` — the run continues server-side, decoupled from the request; consume progress via the stream endpoint.

**Request body**

| Field | Type | Default | Description |
|---|---|---|---|
| `changedOnly` | boolean | `true` | Only convert new/changed files (manifest skip); `false` forces a full rebuild |
| `solution` | string | context | Target solution id |

**Response (202):** `{ "run_id": "…", "running": true, "changedOnly": true, "solution": "…" }`

Errors: `409 ALREADY_RUNNING` (this solution already converting — via API or CLI), `429 MAX_CONVERTS` (global concurrency cap reached; response lists the running imports), `404 SOLUTION_NOT_FOUND`.

## GET /api/xml/convert/stream

Server-Sent-Events subscription (`Content-Type: text/event-stream`) to the active run of the context solution (`?solution=<id>` optional). On subscribe, the buffered event history is replayed so late subscribers catch up; multiple concurrent subscribers are allowed. A `: heartbeat` comment is emitted every 15 s.

Each event is a `data: <JSON>` line with an `event` field:

| Event | Payload | Meaning |
|---|---|---|
| `start` | `ts`, `changedOnly`, `solution` | Run began |
| `progress` | phase, percentage | Coarse pipeline progress |
| `file_start` / `file` | `total`; `index`, `ok` | Per-file batch progress |
| `import_start` / `import_progress` / `import_done` | `processed`, `total` | Fine-grained import phase (chunk level) |
| `log` | `level`, `msg` | Log line (`error` level flagged) |
| `reload` | `ok`, … | Post-convert API reload result |
| `aborted` | `reason` | Converter stopped (`cancelled`, `oom`, `incomplete`) |
| `error` | `message` | Failure |
| `done` | `ok`, `exit_code` | Terminal event |
| `idle` | — | No active run and no history; the stream closes |

Closing the stream (navigating away) only stops delivery to that client — the run itself keeps going.

## POST /api/xml/convert/cancel

Abort the active run of the context solution — the only operation that actually terminates the converter process.

**Request body (optional):** `{ "solution": "<id>" }`

**Response `data`:** `{ "cancelled": true, "solution": "…" }`. Errors: `409 NOT_RUNNING`, `404 SOLUTION_NOT_FOUND`.

## GET /api/xml/last-run/log

Full recorded event stream of the last conversion of the context solution: `{ "run_id": "…", "events": [ … ] }` (or `run_id: null` when no run has happened yet).

## POST /api/xml/reveal

Open the context solution's `xml/` inbox in the host file manager (macOS `open` / Linux `xdg-open`). Errors: `409 REVEAL_UNSUPPORTED` when no host file manager is reachable (e.g. inside a container) — clients should then display the path for manual navigation.

---

See also: [Solutions API](Solutions%20API.md) (bundle lifecycle), [REST API Conventions](../REST%20API%20Conventions.md) (solution scoping, error envelope).
