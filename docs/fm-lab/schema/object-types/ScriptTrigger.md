# ScriptTrigger

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

A **script trigger** binds an event to a [script](Script.md): when the event fires on its owner, FileMaker runs the script. Triggers exist on three levels — **file-level** (OnFirstWindowOpen, OnLastWindowClose, …), **layout-level** (OnRecordLoad, OnLayoutEnter, …) and **object-level** (attached to a single layout object). The trigger itself stores the event type, the mode flags controlling *when* it is armed (Browse/Find/Preview), and the target script — optionally with a script parameter calculation.

ScriptTrigger is an **exported** type: each `<ScriptTrigger>` element becomes one row in [ScriptTriggers](../catalog-tables/ScriptTriggers.md) and one [ObjectCatalog](../object-catalog/ObjectCatalog.md) entry. The XML has no trigger catalog of its own — layout and object triggers live inside the [LayoutCatalog branch](../../xml/catalogs/XML%20LayoutCatalog.md), file-level triggers inside the [Metadata branch](../../xml/catalogs/XML%20Metadata.md); the owner is derived from the enclosing element at import.

> **TBD:** no dedicated detail view in the frontend yet — the generic detail template (`object_details_generic.sql`) is used.

## Properties

The table below lists the property surface of the `<ScriptTrigger>` element and where each property lands in the catalog. Properties marked **not extracted** are visible in the raw XML only.

| Property (XML) | In catalog | Notes |
|---|---|---|
| `@id` | `Trigger_ID` | Numeric FileMaker ID — unique per file only, join with `File_Name` |
| `@action` | `Trigger_Action` | The event type, see [Enumerations](#enumerations) |
| `@browseMode` | `Trigger_BrowseMode` | Trigger armed in Browse mode |
| `@findMode` | — | Trigger armed in Find mode — **not extracted** |
| `@previewMode` | — | Trigger armed in Preview mode (observed in the test corpus) — **not extracted** |
| `<ScriptReference>` `@id` / `@name` / `@UUID` | `Script_ID` / `Script_Name` / `Script_UUID` | The target script → `trigger_script` link |
| `<ScriptReference>/<Calculation>` | — | Optional script parameter calculation (DDR chunk reference) — **not extracted** into a dedicated column |
| enclosing element (position in the export) | `Owner_UUID`, `Owner_Type` | Derived owner: `File`, `Layout` or `LayoutObject` → `trigger_owner` link |

## Object hierarchy

A trigger hangs between its owner and its target, and both directions are modeled as links:

- **`trigger_owner`** (containment) points at the owner — a [File](File.md), [Layout](Layout.md) or [LayoutObject](LayoutObject.md) — with the **event type as `Link_Subrole`** (e.g. `OnRecordLoad`). This is how "which triggers does this layout have" is answered from the graph.
- **`trigger_script`** (usage) points at the [Script](Script.md) the trigger fires — the only edge that makes the script count as *used*.

In the frontend, triggers surface on their owners: the references view of a layout or file lists its triggers via the `trigger_owner` back-link.

## References

Full role definitions: [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

### Outgoing links (ScriptTrigger as source)

| Link_Role | Target | Kind | Description |
|---|---|---|---|
| `trigger_script` | [Script](Script.md) | usage | The script the trigger fires |
| `trigger_owner` | [Layout](Layout.md) / [LayoutObject](LayoutObject.md) / [File](File.md) | containment | The owner the trigger hangs on (subrole = event type) |

### Incoming links (ScriptTrigger as target)

No link role targets ScriptTrigger — the trigger is always the source of its two edges.

## Enumerations

`Trigger_Action` values observed in the ooe-fm test corpus, by owner level *(corpus)*:

| Owner level | Events |
|---|---|
| File | `OnFirstWindowOpen`, `OnLastWindowClose`, `OnWindowOpen`, `OnWindowClose`, `OnWindowTransaction`, `OnFileAVPlayerChange` |
| Layout | `OnRecordLoad`, `OnRecordCommit`, `OnRecordRevert`, `OnLayoutEnter`, `OnLayoutExit`, `OnLayoutKeystroke`, `OnLayoutSizeChange`, `OnModeEnter`, `OnModeExit`, `OnViewChange`, `OnGestureTap`, `OnExternalCommandReceived` |

The corpus contains no object-level trigger; FileMaker's documented object trigger events (`OnObjectEnter`, `OnObjectKeystroke`, `OnObjectModify`, `OnObjectValidate`, `OnObjectSave`, `OnObjectExit`, `OnPanelSwitch`, `OnObjectAVPlayerChange`) follow the same `action` attribute and land with `Owner_Type = 'LayoutObject'`.

## Schema & tooling

- **XML schema:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md) — `<ScriptTriggers>` blocks on layouts and layout objects · [XML Metadata](../../xml/catalogs/XML%20Metadata.md) — file-level `<ScriptTriggers>` block
- **DB schema:** [ScriptTriggers](../catalog-tables/ScriptTriggers.md)
- **Detail view template:** none yet — `/api/get-details` uses the generic fallback `object_details_generic.sql` (served via the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md))
- **Frontend:** object list at `http://localhost:5173/?type=ScriptTrigger`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [Script](Script.md) · [Layout](Layout.md) · [LayoutObject](LayoutObject.md) · [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md)
