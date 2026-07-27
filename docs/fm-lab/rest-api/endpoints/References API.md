# References API

Dependency lookups over the resolved link graph (`ObjectLinks`): what an object uses and where it is used (`/references`), and which objects inside an open container reference a given origin (`/back-references`).

Both endpoints are clone-aware — see [Clone disambiguation](../REST%20API%20Conventions.md#clone-disambiguation-file-ambiguous_uuid).

---

## GET /api/references

Inbound and outbound references of one object.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `uuid` | string | — | **Required.** Object UUID |
| `file` | string | — | Clone scoping of the focus object |
| `direction` | enum | `all` | `all` · `parent` (who uses this object) · `child` (what this object uses) · `recursive` |
| `link_type` | enum | `operational` | `operational` · `structural` · `all` |
| `origin` | string | — | Origin object UUID (`?ref=` cross-reference); for pseudo aggregate types the reachable rows are flagged with `Origin_Hit` |
| `limit` | integer | `100` | |
| `format` / `meta` / `debug` | | | Standard ([REST API Output Formats](../REST%20API%20Output%20Formats.md)) |

**Response `data`**

```json
{
  "source": { "Object_UUID": "…", "Object_Type": "Script", "Object_Name": "Import Data", "File_Name": "Contacts" },
  "references": {
    "parent": [ { "Target_UUID": "…", "Target_Type": "Layout", "Target_Name": "Order Entry",
                  "Target_File": "Contacts", "Link_Role": "triggers_script", "Is_Cross_File": false } ],
    "child":  [ { "Target_UUID": "…", "Target_Type": "Field", "Target_Name": "Order_Total",
                  "Target_File": "Contacts", "Link_Role": "sets_field", "Is_Cross_File": false } ]
  }
}
```

Link roles (`calls_script`, `sets_field`, `displays_field`, …) describe *how* an object is referenced. `link_type=operational` (the default) covers actual usage; `structural` adds containment/organizational links. Pseudo aggregate types (`ScriptStepType`, `BuiltinFunction`, …) are supported through a dedicated resolver.

`format=mermaid` / `mermaid-raw` render the reference set as a diagram — see [mermaid](../REST%20API%20Output%20Formats.md#mermaid-mermaid-raw).

## GET /api/back-references

Given an open destination container (a Layout, Script or Custom Function) and an origin object, return every object *inside the destination* that references the origin. Frontends use this to pre-seed cross-reference highlights when navigating with `?ref=`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `destination` | string | — | **Required.** Container UUID (real or synthetic sub-object UUID) |
| `origin` | string | — | **Required.** Origin UUID **or** object name |
| `mode` | enum | `auto` | `uuid` · `name` · `auto` (UUID first, then name lookup) |
| `dest_file` / `origin_file` | string | — | Clone disambiguation per side |

**Response `data`:** `destination` and `origin` descriptors, `matches[]` (the referencing objects inside the container) and `match_strategy` (`uuid` · `name` · `name-fallback` · `unresolved`). An unresolvable origin is not an error: the response is `200` with `origin: null` and empty `matches`, so clients can show a "not found" state.

---

See also: [Graph API](Graph%20API.md) (visual/graph traversal of the same links), [Objects API](Objects%20API.md).
