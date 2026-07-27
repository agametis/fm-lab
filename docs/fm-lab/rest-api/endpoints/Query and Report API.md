# Query and Report API

Execute prepared SQL templates against the catalog: `/query` for tabular analysis SQL, `/report` for report templates that default to rendered HTML. Both exist as GET (parameters in the query string) and POST (JSON body) variants; `/query/list` and `/report/list` enumerate the installed templates.

Templates are `.sql` files shipped with the installation (`rest-api/templates/queries/` and `templates/reports/`). Arbitrary SQL is **not** accepted — only named templates with parameters.

---

## GET/POST /api/query

| Field | Type | Default | Description |
|---|---|---|---|
| `template` | string | — | **Required.** Template name without `.sql` |
| `params` | object \| JSON string | — | Template parameters (JSON string in GET, object in POST) |
| `format` | enum | `json` | See [REST API Output Formats](../REST%20API%20Output%20Formats.md) |
| `theme` | enum | — | `default` · `dark` · `forest` · `neutral` — mermaid formats only |
| `direction` | enum | — | `TD` · `LR` · `BT` · `RL` — mermaid graph direction |
| `title` | string | — | Diagram/report title (max 200 chars) |
| `meta` / `debug` | boolean | `false` | `debug` returns the executed SQL |

Additional unknown parameters are passed through as template variables.

```bash
# GET with JSON-encoded params
curl "http://localhost:3003/api/query?template=unused_scripts&params=%7B%22file%22%3A%22Contacts%22%7D"

# POST
curl -X POST http://localhost:3003/api/query \
  -H "Content-Type: application/json" \
  -d '{"template": "unused_scripts", "params": {"file": "Contacts"}, "format": "markdown"}'
```

**Response (json):** the standard envelope with `data` as an array of result rows. Errors: `404 TEMPLATE_NOT_FOUND`, `500 TEMPLATE_ERROR` (template failed during execution), `409 SCHEMA_DRIFT` (catalog older than the template expects — re-import the XML).

## GET/POST /api/report

Identical interface to `/query`, but `format` defaults to **`html`** — report templates are designed to render as styled documents. Use `format=json` to get the underlying rows.

## GET /api/query/list · GET /api/report/list

Enumerate the installed templates with their metadata (name, description, expected parameters). Useful for discovering what an installation provides before calling `/query` or `/report`.

---

## Template parameter notes

- Parameters are substituted by a named-placeholder preprocessor — numbers belong in the JSON unquoted, strings quoted.
- Templates are locale-independent by convention (they match on IDs such as `Step_ID`, never on localized display names).

See also: [REST API Output Formats](../REST%20API%20Output%20Formats.md) (mermaid rendering of graph-shaped query results), [REST API Conventions](../REST%20API%20Conventions.md).
