# Synthetic UUIDs in the schema

Most object types in `ObjectCatalog` carry a **native FileMaker UUID** taken
verbatim from the XML (`<… UUID="…">`). For a number of object types, however,
FileMaker emits **no usable UUID** — either because the XML element has only a
local `id` and no UUID attribute, or because the "object" is a catalog
abstraction introduced during conversion that never existed as a discrete
FileMaker object. For those the `Object_UUID` is **synthesized**.

This document explains every synthetic UUID in the schema and the reasoning
behind each form. All synthetic keys are **deterministic** (no `ROW_NUMBER()`,
no randomness), so they stay stable across re-imports and across development
steps — the same persistence property a native FileMaker UUID provides.

All `Object_UUID` construction lives in the catalog phase of the conversion
pipeline, [sql/convert_xml_04_catalog.sql](../../sql/convert_xml_04_catalog.sql)
(phase 4 of the six-phase XML pipeline: extract → resolve → details → catalog →
homes → validate).

> The examples below use a fictional file name `MyFile` purely for illustration.

## Group A — real FileMaker objects without a native UUID

These elements exist as discrete objects in a solution, but FileMaker gives them
only a local `id` in the XML, not a UUID. The key is a type prefix plus the local
id plus disambiguating context.

| Object type | `Object_UUID` form | XML element |
|---|---|---|
| **ScriptTrigger** | `trig_ Trigger_ID _ Owner_UUID _ File_Name` | `<ScriptTrigger id=…>` (no UUID) |
| **LayoutPart** | `part_ Layout_ID _ Part_Kind _ Part_Seq _ File_Name` | `<Part type="…" kind="…">` (no UUID) |
| **PasteIndexObject** | `paste_ Object_ID _ File_Name` | PasteIndexList entry (no UUID) |

Example (ScriptTrigger):

```
trig_101_4F1C2A8B-7D90-4E62-AC31-2B5E9F0A6D74_MyFile
│    │   └────────────── Owner_UUID ──────────────┘ └─┬─┘
│    │                                              File_Name
│    └─ Trigger_ID (event slot)
└─ type prefix
```

### Why ScriptTrigger needs an extra Owner segment

PasteIndexObject uses `id _ File_Name` because its local `id` is **unique within
the file** — that alone identifies it. LayoutPart composes the layout id, the
part kind and a sequence number, because a layout can hold several parts of the
same kind.

ScriptTrigger is the exception. Its `id` is only an **event slot** (for example
the slot for OnObjectSave) and repeats identically across many owner objects: it
is unique only *within its owner*, not within the file. The key therefore needs
the extra `Owner_UUID` segment — the native UUID of the owning object, which is
one of:

| Owner level | Owner element | `Owner_UUID` source |
|---|---|---|
| File level (e.g. OnFirstWindowOpen) | the file node | `/FMSaveAsXML/@UUID` |
| Layout level (e.g. OnLayoutEnter) | `<Layout>` | `/Layout/UUID` |
| Object level (e.g. OnObjectSave) | `<LayoutObject>` | `/LayoutObject/UUID` |

Omitting the owner segment lets distinct triggers that share the same slot id
collide on a single key, which an `ON CONFLICT DO UPDATE` would then collapse
("last one wins"). Including it makes the triple
`(Trigger_ID, Owner_UUID, File_Name)` unique.

If an owner element ever lacks a UUID, a deterministic fallback keeps the key
non-NULL:

```sql
COALESCE(t.Owner_UUID, md5(t.trigger_xml::VARCHAR)) as Owner_UUID
```

> This fallback belongs to the extraction phase
> ([sql/convert_xml_01_extract.sql](../../sql/convert_xml_01_extract.sql), phase 1
> of the six-phase pipeline), where the trigger rows are read from the XML —
> not to the catalog phase that assembles the final `Object_UUID`.

## Group B — abstract catalog entities (not discrete FileMaker objects)

These "objects" are aggregations or registries introduced during conversion,
extracted from calculation text or shared across the whole solution. They never
had — and could never have — a native UUID. Identity is an `md5()` hash over the
defining parts.

| Object type | `Object_UUID` form | Notes |
|---|---|---|
| **Variable** | `md5(Scope :: Scope_Anchor :: Name)` | one identity per scope instance. The UUID carries no file: the anchor of a local variable is its script (`__file::<File_Name>` outside scripts), of a `let_local` variable its context, of a global variable the file, of a superglobal `__global`. Clone files share script and context UUIDs, so their local variables share the UUID — identity is `(Object_UUID, File_Name)` as for native clone objects; superglobal variables are one object for all files |
| **PluginFunction** | `md5('PluginFunction::' \|\| Name :: SubName)` | per (function, SubName); container plugins split per SubName |
| **BuiltinFunction** | `md5('BuiltinFunction::' \|\| Name [:: SubParam])` | solution-independent → `File_Name = NULL`; `Get(<x>)` splits per sub-parameter |
| **ScriptStepType** | `md5('ScriptStepType::' \|\| Step_Name)` | one entry per distinct step type |
| **PluginComponent** | `md5('PluginComponent::<vendor>::' \|\| component)` | plugin component registry |
| **Calculation** | `md5('Calculation::' \|\| File_Name :: Owner_UUID :: Calc_Role :: Calc_Index)` | schema 1.22.0; one identity per calculation **instance** (owner slot). `File_Name` is part of the key because owner UUIDs are only unique per file (clone corpora). `Calc_Index` is a `ROW_NUMBER` over a **deterministic** order (calc position / suffix numbers / anchor UUID / hash) — stable across re-imports for unchanged sources; inserting a new instance of the same role before an existing one shifts the following indexes (documented model boundary, same class as position-keyed step discriminators) |

## For contrast — native FileMaker UUIDs

The following object types carry a real `UUID` / `@UUID` from the XML and are
adopted unchanged:

BaseTable, TableOccurrence, **Relationship**, Field, ValueList, CustomFunction,
Script, ScriptStep, Layout, **LayoutObject**, Account, PrivilegeSet,
ExtendedPrivilege, CustomMenu, Theme, ExternalDataSource, BaseDirectory, File.

> Note: **LayoutObject** has a native UUID — which is exactly why it can serve as
> the `Owner_UUID` segment in a ScriptTrigger key.

> Note: **Relationship** takes its UUID from `<Relationship>/<UUID>`
> (`RelationshipCatalog.Rel_UUID`, since schema 1.34.0). Only an export without
> that element falls back to the composite key `rel_ Rel_ID _ File_Name`.

Native UUIDs are unique per file only: clone or module files can carry the same
UUID, so identity is `(Object_UUID, File_Name)`. A UUID that occurs twice inside
one file is re-keyed during import (UUID healing, census in
`DuplicateAbsorptionDetails`) — the replacement is a 32-hex `md5` value.

## Design rules for synthetic UUIDs

1. **Deterministic only.** Compose from stable content (ids, names, owner UUIDs)
   or hash it with `md5()`. Never `ROW_NUMBER() OVER (ORDER BY NULL)` — it is
   non-deterministic and breaks re-import stability.
2. **Include every identity component.** The key must contain enough context to
   make distinct objects distinct — for ScriptTrigger that means adding
   `Owner_UUID`. A too-narrow key collapses rows via `ON CONFLICT DO UPDATE`.
3. **Scope by file** where the local id is only file-unique (`… _ File_Name`),
   or set `File_Name = NULL` for solution-independent entities (built-in
   functions).
4. **Prefix hashed keys with a type tag** (`'BuiltinFunction::' || …`) so hashes
   from different object classes can never collide.
