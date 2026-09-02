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

**Response `data`** is a **flat row list**; the column set depends on `direction`. The default `direction=all` gives every row a `direction` field (`child` / `parent`) plus neutral identity columns, while `direction=child` / `parent` return the directed `Target_*` / `Source_*` column names instead:

```json
[
  { "direction": "parent", "uuid": "…", "Object_Type": "LayoutObject", "Object_Name": "Button @ (8,598)",
    "File_Name": "Contacts", "Link_Role": "triggers_script",
    "Subrole_Class": "button_action", "Subrole_Detail": "button_action", "Is_Cross_File": false,
    "Container_UUID": "…", "Container_Type": "Layout", "Container_Name": "Order Entry", "Container_File": "Contacts",
    "Trigger_UUID": null, "navigable": true, "Call_Count": 1 },
  { "direction": "child", "uuid": "…", "Object_Type": "Field", "Object_Name": "Order_Total",
    "File_Name": "Contacts", "Link_Role": "sets_field",
    "Subrole_Class": null, "Subrole_Detail": null, "Is_Cross_File": false,
    "Container_UUID": null, "Container_Type": null, "Container_Name": null, "Container_File": null,
    "Trigger_UUID": null, "navigable": true, "Call_Count": 1 }
]
```

Link roles (`calls_script`, `sets_field`, `displays_field`, …) describe *how* an object is referenced. `link_type=operational` (the default) covers actual usage; `structural` adds containment/organizational links. Pseudo aggregate types (`ScriptStepType`, `BuiltinFunction`, …) are supported through a dedicated resolver.

**Slot classes (`Subrole_Class` / `Subrole_Detail`, additive).** Where the underlying edge carries a subrole (the calc slot the reference lives in), each row also reports:

- `Subrole_Class` — the slot class, normalized onto the calc_kind vocabulary of the calculation catalog: `hide`, `conditional_format`, `tooltip`, `button_action`, `portal_filter`, `web_viewer_url`, `placeholder`, `popover_title`, `script_trigger_parameter`, `auto_enter`, `validation`, `on_server` (Perform Script on Server), `mbs_runscript`, `menu_install`. `Condition_N` collapses into `conditional_format`; unknown subroles pass through raw (never swallowed). Positional script-slot indices (and `XML`/`XSL`) are suppressed to `null`, so script rows keep their aggregated form — a script that reads a field in N steps stays **one** row with `Call_Count` = N.
- `Subrole_Detail` — the raw value(s) behind the class: for `direction=all` the aggregated distinct raw subroles of the row (e.g. `Condition_1, Condition_2`), in the ungrouped `child`/`parent` branches the single raw value. `null` whenever `Subrole_Class` is `null` (direction=all).
- `Subrole_Event` — additive on rows of class `script_trigger_parameter`: the `ScriptTrigger_<id>` slot(s) resolved to canonical trigger event names via the curated reference database (fm_spec ≥ 1.18.0), e.g. `OnObjectValidate`; aggregated rows yield a distinct list in `Subrole_Detail` order. Complete-or-absent contract: the field is omitted when the reference database is not attached, predates 1.18.0, or any slot of the list cannot be resolved — clients degrade to the class label.

This distinguishes e.g. a field that *hides* 52 layout objects (`reads_field` + `hide`) from one that *colors* 16 (`reads_field` + `conditional_format`). Structural rows benefit too: `has_calculation` children report their calc_kind, `trigger_owner` the event name, `parent_layout` the part type — passed through raw.

**Trigger vs. button action on `triggers_script`.** The `triggers_script` edge (owner → Script; the owner is a layout object, a layout or the file) carries a subrole: the canonical trigger event (e.g. `OnObjectSave`, raw source passthrough), or `button_action` for Button/GroupedButton/PopoverButton actions. On the script's reference list the aggregate decomposes into named event rows plus separate `button_action` rows, each filterable via the role chips. The attribution is reconstructed per (owner, script) group as a multiset, not per individual edge; catalogs whose mirrors carry no subrole render unfiltered until re-imported.

**Trigger mirror consolidation (caller direction).** A trigger is stored twice in the link graph: as the granular `trigger_script` edge of its ScriptTrigger sub-node and as the `triggers_script · <event>` mirror edge of its owner — a deliberate two-layer model in which **only the owner mirror counts for where-used** (the granular `trigger_script` edge never does). To keep caller lists free of that duplication, the references endpoint suppresses the granular row whenever its mirror is visible in the list. Display layer only — `ObjectLinks` and the graph are untouched. Consolidated mirror rows carry `Trigger_UUID`: the address of the ScriptTrigger sub-node, so clients can still jump to the trigger's detail view (`null` on `button_action` rows and every other role).

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

**ScriptTrigger origins.** A synthetic script-trigger sub-node (`trig_<slot>_…`) is referenced by nothing inside its layout, so the standard lookup would always come back empty for the "open container with `?ref=`" navigation. When the origin is a ScriptTrigger whose owner is a LayoutObject inside the destination layout, the owner object is therefore returned as the match (role `trigger_owner`) — the canvas highlights the object carrying the trigger. Layout- and file-level triggers are deliberately excluded and keep their empty match list (the layout's properties panel highlights those trigger rows directly via the trig-UUID).

---

See also: [Graph API](Graph%20API.md) (visual/graph traversal of the same links), [Objects API](Objects%20API.md).
