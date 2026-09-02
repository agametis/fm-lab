# File

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

The **File** object represents the FileMaker file itself — the `.fmp12` database a `SaveCopyAsXML` export was taken from. It is the anchor of everything file-scoped: every catalog table carries a `File_Name` column pointing back to it, and file-level settings that need graph edges (auto-login account, start layout, file-level script triggers) attach to this object.

File is a **synthetic** type: FileMaker has no "file catalog" element of its own, so the import pipeline derives exactly one File row per imported export in [ObjectCatalog](../object-catalog/ObjectCatalog.md). Its `Object_UUID` is the export's **root UUID** (the `UUID` attribute of the `<FMSaveAsXML>` root element), which makes the object stable across re-imports. Do not confuse the object type with the [FilesCatalog](../object-catalog/FilesCatalog.md) *table* — that table stores the import metadata of each file, while this page describes the file as an addressable node of the object graph.

## Properties

A File object aggregates three property groups: the root attributes of the export document, the file options of the `<Metadata>` branch, and the inter-file access protection. The tables list the XML surface and where each property lands. Properties marked **not extracted** are visible in the raw XML only.

### Identity & export metadata (root attributes of `<FMSaveAsXML>`)

Landed in [FilesCatalog](../object-catalog/FilesCatalog.md) and its low-level counterpart [XMLMetadata](../catalog-tables/XMLMetadata.md):

| Property (XML) | In catalog | Notes |
|---|---|---|
| `@File` | `File_Name` / `File_FullName` (`Filename` in XMLMetadata) | File name; `File_Name` (without `.fmp12`) is the scoping key of every catalog table |
| `@UUID` | `File_UUID` | = the File object's `Object_UUID` |
| `@version` | `XML_Version` | SaXML format version (e.g. `2.2.3.0`) |
| `@Source` | `FileMaker_Version` | Exporting FileMaker version |
| `@locale` | `Locale` | Export language — the reason object/step names are localized |
| `@Has_DDR_INFO` | `Has_DDR_INFO` | Gates [DDR_Calculations](../catalog-tables/DDR_Calculations.md) / DDR step data |
| — (pipeline-derived) | `Import_Timestamp`, `XML_Path` | Import bookkeeping, no XML counterpart |

### File options (`<Metadata>` branch)

Landed in [FileOptionsCatalog](../catalog-tables/FileOptionsCatalog.md), one row per file:

| Property (XML) | In catalog | Notes |
|---|---|---|
| `<Encryption>/@type` | `Encryption_Type` | Encryption-at-rest state |
| `<Minimum>` `@version` / `@value` | `Min_Version` / `Min_Version_Value` | Minimum allowed client version |
| `<Login>/@type` | `Login_Type` | `1` + account name = auto-login; `-1` observed for "no auto-login" *(corpus)* |
| `<Login>/<AccountName>` | `Login_AccountName` | → `auto_login_account` link (security-relevant) |
| `<ShowSignInFields>/@enable` | `Show_SignIn_Fields` | |
| `<SavePassword>` `@keychain` / `@requireMobile` | `Save_Password_Keychain` / `Save_Password_RequireMobile` | |
| `<Spelling>/@underline` | `Spelling_Underline` | |
| `<HideWebDirectSharing>/@enable` / `<HideClientSharing>/@enable` | `Hide_WebDirect_Sharing` / `Hide_Client_Sharing` | Sharing visibility switches |
| `<Defaults>/<LayoutReference>` | `Default_Layout_ID` / `_Name` / `_UUID` | Start layout — → `default_layout` link |
| `<PageSetup>` (`<Orientation>`, `<scale>`, `<size>`) | `PageSetup_Orientation` / `PageSetup_Scale` / `PageSetup_Width` / `PageSetup_Height` | Page-setup defaults |
| `<IconData>` (base64 icon streams) | — | Custom file icon — **not extracted** |
| `<ScriptTriggers>` | [ScriptTriggers](../catalog-tables/ScriptTriggers.md) table | File-level triggers become own [ScriptTrigger](ScriptTrigger.md) objects owned by the File — see [Object hierarchy](#object-hierarchy) |

### Inter-file access protection (`<FileAccessCatalog>`)

The *File Access* authorization list (which other files may reference this one) is file-level data too; it lands in [FileAccessAuthorizations](../catalog-tables/FileAccessAuthorizations.md), keyed by `File_Name`, and produces no graph links.

## Object hierarchy

The File object is the **owner anchor** at the top of the containment tree. It has no containing parent itself; two kinds of children attach to it:

- **File-level script triggers** (`OnFirstWindowOpen`, `OnLastWindowClose`, `OnWindowTransaction`, …) hang on the File via `trigger_owner` links, with the event type as subrole. Each trigger's target script is reachable twice: as the granular `trigger_script` edge of the [ScriptTrigger](ScriptTrigger.md) object (navigation, never counting) and as the File's own counting `triggers_script · <event>` mirror.
- **Everything else** is file-scoped by convention rather than by explicit links: catalog rows reference their file through the `File_Name` column, not through graph edges — the graph stays free of one-edge-per-object noise.

In the frontend there is no dedicated file view; the object opens with the generic detail view.

## References

The File object carries the security- and startup-relevant file options as graph edges. Full role definitions: [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

### Outgoing links (File as source)

| Link_Role | Target | Kind | Description |
|---|---|---|---|
| `auto_login_account` | [Account](Account.md) | usage | Auto-login account from the file options (security-relevant) |
| `default_layout` | [Layout](Layout.md) | usage | Start layout from the file options |
| `triggers_script` | [Script](Script.md) | usage | Counting mirror of every file-level trigger (subrole = event) — the where-used truth for trigger-fired scripts |
| `reads_field` / `reads_variable` | [Field](Field.md) / [Variable](Variable.md) | usage | Reference inside a file-level script-trigger parameter calc (subrole `ScriptTrigger_<id>`) |
| `calls_function` / `calls_customfunction` / `calls_pluginfunction` | [BuiltinFunction](BuiltinFunction.md) / [CustomFunction](CustomFunction.md) / [PluginFunction](PluginFunction.md) | usage | Function call inside a file-level trigger parameter calc (same subrole) |
| `has_calculation` | [Calculation](Calculation.md) | containment | Trigger-parameter calc instances of the file as addressable objects — never counts as usage |

### Incoming links (File as target)

| Link_Role | Source | Kind | Description |
|---|---|---|---|
| `trigger_owner` | [ScriptTrigger](ScriptTrigger.md) | containment | A file-level script trigger hangs on this file (subrole = event type) |

## Schema & tooling

- **XML schema:** [FMSaveAsXML root document](../../xml/XML.md) (root attributes) · [XML Metadata](../../xml/catalogs/XML%20Metadata.md) (file options & file-level triggers) · [XML FileAccessCatalog](../../xml/catalogs/XML%20FileAccessCatalog.md) (inter-file access)
- **DB schema:** [FilesCatalog](../object-catalog/FilesCatalog.md) · [XMLMetadata](../catalog-tables/XMLMetadata.md) · [FileOptionsCatalog](../catalog-tables/FileOptionsCatalog.md) · [FileAccessAuthorizations](../catalog-tables/FileAccessAuthorizations.md)
- **Detail view template:** no dedicated template — `/api/get-details` falls back to the generic detail template (`object_details_generic.sql`), served via the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md)
- **Frontend:** object list at `http://localhost:5173/?type=File`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [FilesCatalog](../object-catalog/FilesCatalog.md) · [ScriptTrigger](ScriptTrigger.md) · [Account](Account.md) · [Layout](Layout.md) · [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md)
