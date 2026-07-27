# Solutions API

Manage the solution bundles of a workspace: list, create, update, rename, delete, activate, and pool diagnostics. A *solution* is one imported FileMaker application (a bundle of XML sources, catalog database and state).

**Authorization:** when the environment variable `ADMIN_RELOAD_TOKEN` is set, all mutating endpoints require a matching `X-Admin-Token` header (`401 UNAUTHORIZED` otherwise). Without the variable, access is open (local development default). `GET /api/solutions` never requires the token.

**Activate vs `X-Solution`:** activating changes the **server default** for every caller that sends no header; the per-request `X-Solution` header (see [Solution scoping (X-Solution)](../REST%20API%20Conventions.md#solution-scoping-x-solution)) is an independent, non-persistent override and is never affected by activation.

---

## GET /api/solutions

List all solution bundles (manifest scan, no databases are opened).

**Response `data`:** `{ "solutions": [ … ] }` with each solution's manifest (id, display name, description, technical metadata).

## POST /api/solutions

Create an empty solution bundle (directory skeleton + manifest).

**Request body:** `{ "id": "my-solution", "display_name": "My Solution", "description": "…" }`

Returns `201` with `data.solution` (the new manifest). Errors: `400 INVALID_SOLUTION_ID`, `409 SOLUTION_EXISTS`.

## PATCH /api/solutions/:id

Update the user-owned description block of a solution manifest: `display_name`, `description`, `maintainer`, `url`, `notes`. The technical/metrics blocks written by the import pipeline are never touched.

Errors: `400 INVALID_DISPLAY_NAME` (empty display name), `404 SOLUTION_NOT_FOUND`.

## DELETE /api/solutions/:id

Delete the entire bundle **including its XML sources**. The solution's database pool entry and annotation sidecar are closed first, so other clients that had it in context receive a clean `404` on their next request.

Errors: `404 SOLUTION_NOT_FOUND`; `409 SOLUTION_ACTIVE` / `SOLUTION_DEFAULT` / `SOLUTION_LOCKED` — the active/default solution cannot be deleted, nor one with a running import.

## POST /api/admin/solution/activate

Set the workspace's default ("active") solution: rewrites the pointer file and workspace symlinks, then reloads the API onto the new solution.

**Request body:** `{ "id": "my-solution" }`

**Response `data`:** `{ "status": "activated" | "unchanged", "active": "…", "switched_at": "…", "tables": …, "path": "…" }`

Errors: `400 INVALID_SOLUTION_ID`, `404 SOLUTION_NOT_FOUND`.

## POST /api/admin/solution/rename

Rename a bundle (its folder name / id). The manifest UUID preserves the solution's identity — this is a filesystem move, which is why it is a dedicated endpoint rather than a PATCH field. Pool entry and annotation sidecar are closed before the move; if the renamed solution was active, the pointer follows it.

**Request body:** `{ "from": "old-id", "to": "new-id" }`

Errors: `400 INVALID_SOLUTION_ID`, `404 SOLUTION_NOT_FOUND`, `409 SOLUTION_EXISTS` / `SOLUTION_LOCKED`.

## POST /api/admin/reload

Invalidate one solution's database pool entry and re-open it from disk. The XML import pipeline calls this after syncing a fresh catalog copy; manual use is rarely needed.

**Request body (optional):** `{ "solution": "<id>" }` — defaults to the active solution. Other solutions' pool entries keep serving uninterrupted.

**Response `data`:** `{ "status": "…", "solution": "…", "tables": …, "path": "…", "timestamp": "…" }`

## GET /api/admin/pool

Diagnostics for the per-solution database connection pool (which solutions are open, age, in-flight queries). Token-protected.

**Response `data`:** `{ "pool": { … } }`

---

See also: [XML Import API](XML%20Import%20API.md) (fills a solution with data), [System API](System%20API.md) (`/info` reports the context solution).
