# ScriptTrigger

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

A **script trigger** binds an event to a [script](Script.md): when the event fires on its owner, FileMaker runs the script. Triggers exist on three levels — **file-level** (OnFirstWindowOpen, OnLastWindowClose, …), **layout-level** (OnRecordLoad, OnLayoutEnter, …) and **object-level** (attached to a single layout object). The trigger itself stores the event type, the mode flags controlling *when* it is armed (Browse/Find/Preview), and the target script — optionally with a script parameter calculation.

ScriptTrigger is an **exported** type: each `<ScriptTrigger>` element becomes one row in [ScriptTriggers](../catalog-tables/ScriptTriggers.md) and one [ObjectCatalog](../object-catalog/ObjectCatalog.md) entry. The XML has no trigger catalog of its own — layout and object triggers live inside the [LayoutCatalog branch](../../xml/catalogs/XML%20LayoutCatalog.md), file-level triggers inside the [Metadata branch](../../xml/catalogs/XML%20Metadata.md); the owner is derived from the enclosing element at import.

Triggers are navigable objects in the frontend: they have a dedicated detail view (event, armed modes, owner chain, target script and the parameter calculation) and their reference rows link straight to it.

## Properties

The table below lists the property surface of the `<ScriptTrigger>` element and where each property lands in the catalog. Properties marked **not extracted** are visible in the raw XML only.

| Property (XML) | In catalog | Notes |
|---|---|---|
| `@id` | `Trigger_ID` | Numeric FileMaker ID — unique per file only, join with `File_Name` |
| `@action` | `Trigger_Action` | The event type, see [Enumerations](#enumerations) |
| `@browseMode` | `Trigger_BrowseMode` | Trigger armed in Browse mode |
| `@findMode` | `Trigger_FindMode` | Trigger armed in Find mode |
| `@previewMode` | `Trigger_PreviewMode` | Trigger armed in Preview mode — SaXML writes only *activated* modes, so `NULL` on any of the three flags means "off", never "unknown" |
| `@scriptParameterFieldName` | `Trigger_ScriptParameter_FieldName` | OnWindowTransaction only: the field whose content FileMaker adds to the JSON script parameter — a late-bound name without table qualification, resolved into `reads_field · transaction_parameter_field` candidate edges |
| `<ScriptReference>` `@id` / `@name` / `@UUID` | `Script_ID` / `Script_Name` / `Script_UUID` | The target script → `trigger_script` link |
| `<ScriptReference>/<Calculation>` | `Trigger_Parameter_Text` | The script-parameter calculation as structural plaintext; also materialized as a `script_trigger_parameter` [Calculation](Calculation.md) instance |
| enclosing element (position in the export) | `Owner_UUID`, `Owner_Type` | Derived owner: `File`, `Layout` or `LayoutObject` → `trigger_owner` link |

## Object hierarchy

A trigger hangs between its owner and its target, modeled as a deliberate **two-layer link model**:

- **`trigger_owner`** (containment) points at the owner — a [File](File.md), [Layout](Layout.md) or [LayoutObject](LayoutObject.md) — with the **event type as `Link_Subrole`** (e.g. `OnRecordLoad`). This is how "which triggers does this layout have" is answered from the graph.
- **`trigger_script`** (usage) points at the [Script](Script.md) the trigger fires — the granular navigation edge. It **never counts for where-used**.
- The **counting mirror** is `triggers_script · <event>`, an edge whose *source is the owner* (layout object, layout or file) — the single where-used truth for trigger-fired scripts. One mirror corresponds to exactly one `ScriptTriggers` row with a script and one trigger node (guarded by the P6 check `v_check_trigger_mirror_symmetry`).

In the frontend, triggers surface on their owners (the references view of a layout or file lists them via the `trigger_owner` back-link) and open their own detail view.

## References

Full role definitions: [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

### Outgoing links (ScriptTrigger as source)

| Link_Role | Target | Kind | Description |
|---|---|---|---|
| `trigger_script` | [Script](Script.md) | usage | The script the trigger fires — navigation edge, does not count for where-used (the owner mirror `triggers_script` does) |
| `trigger_owner` | [Layout](Layout.md) / [LayoutObject](LayoutObject.md) / [File](File.md) | containment | The owner the trigger hangs on (subrole = event type) |
| `reads_field` | [Field](Field.md) | usage | OnWindowTransaction parameter-field candidates (subrole `transaction_parameter_field`, name-resolved, file-local) |

### Incoming links (ScriptTrigger as target)

No link role targets ScriptTrigger — the trigger is always the source of its edges.

## Enumerations

The authoritative event enumeration is the [script_triggers](../fm-spec-tables/script_triggers.md) table of the [fm-spec](../../Wiki/fm-spec.md) reference database — 26 events, each with its owner level, parameter capability and introduction version. The slot-ID ranges are level-bound and load-bearing (they key the synthetic trigger UUIDs `trig_<id>_<OwnerUUID>_<File>`):

| Owner level | Slot IDs | Events |
|---|---|---|
| LayoutObject | 1–8 | `OnObjectEnter`, `OnObjectKeystroke`, `OnObjectModify`, `OnObjectValidate`, `OnObjectSave`, `OnObjectExit`, `OnPanelSwitch`, `OnObjectAVPlayerChange` |
| Layout | 101–113 | `OnRecordLoad`, `OnRecordCommit`, `OnRecordRevert`, `OnLayoutEnter`, `OnLayoutExit`, `OnLayoutKeystroke`, `OnLayoutSizeChange`, `OnModeEnter`, `OnModeExit`, `OnViewChange`, `OnGestureTap`, `OnExternalCommandReceived` |
| File | 201–209 | `OnFirstWindowOpen`, `OnLastWindowClose`, `OnWindowOpen`, `OnWindowClose`, `OnWindowTransaction`, `OnFileAVPlayerChange` |

Localized event labels (the trigger-dialog captions, 11 languages) live in [script_triggers_lang](../fm-spec-tables/script_triggers_lang.md) and are served via the [Reference Database API](../../rest-api/endpoints/Reference%20Database%20API.md).

## Schema & tooling

- **XML schema:** [XML LayoutCatalog](../../xml/catalogs/XML%20LayoutCatalog.md) — `<ScriptTriggers>` blocks on layouts and layout objects · [XML Metadata](../../xml/catalogs/XML%20Metadata.md) — file-level `<ScriptTriggers>` block
- **DB schema:** [ScriptTriggers](../catalog-tables/ScriptTriggers.md) · event reference in [fm-spec](../../Wiki/fm-spec.md) ([script_triggers](../fm-spec-tables/script_triggers.md), [script_triggers_lang](../fm-spec-tables/script_triggers_lang.md))
- **Detail view:** no SQL template — `/api/get-details` builds the trigger projection directly from [ScriptTriggers](../catalog-tables/ScriptTriggers.md) and the parameter-calculation instance in [CalculationsCatalog](../catalog-tables/CalculationsCatalog.md) (served via the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md), `format=tokens` → kind `scripttrigger`)
- **Frontend:** object list at `http://localhost:5173/?type=ScriptTrigger`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [Script](Script.md) · [Layout](Layout.md) · [LayoutObject](LayoutObject.md) · [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md)
