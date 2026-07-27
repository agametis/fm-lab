# PasteIndexObject

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

A **paste index object** is a bookkeeping entry from the export's `<PasteIndexList>` — an ordered list of object IDs FileMaker maintains for copy/paste housekeeping. The entries carry no name, no definition and no relation to other objects; FileMaker's own documentation does not describe their exact meaning. FM-Lab imports them for completeness (nothing in the export is silently dropped), but they play **no analytical role**.

PasteIndexObject is a **synthetic** type: the `<Object>` entries have no identity of their own, so the pipeline derives one [ObjectCatalog](../object-catalog/ObjectCatalog.md) row per entry with a synthetic UUID (`paste_<id>_<file>`) and a generated display name (`Paste Object #<id>`). The list order lands in the internal `PasteIndexList` table, which is not part of the documented schema surface.

## Properties

| Property (XML) | In catalog | Notes |
|---|---|---|
| `<Object>/@id` | `Object_ID` (internal `PasteIndexList` table; also `ObjectCatalog.Object_ID`) | The referenced numeric object ID |
| position in the list | `List_Index` (internal `PasteIndexList` table) | Order of appearance |
| `<PasteIndexList>/@membercount` | — | Entry count of the list — **not extracted** (implicit in the row count) |

Which catalog the `@id` values point into is not documented by FileMaker; FM-Lab does not resolve them.

## References

None — a PasteIndexObject is neither source nor target of any [link role](../object-catalog/Link%20Roles%20and%20Subroles.md).

## Schema & tooling

- **XML schema:** [XML PasteIndexList](../../xml/catalogs/XML%20PasteIndexList.md) — top-level `<PasteIndexList>` branch (also embedded inside some catalogs)
- **DB schema:** internal `PasteIndexList` table only — not part of the documented schema surface; the objects appear in [ObjectCatalog](../object-catalog/ObjectCatalog.md)
- **Detail view template:** no dedicated template — `/api/get-details` falls back to the generic detail template (`object_details_generic.sql`), served via the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md)
- **Frontend:** object list at `http://localhost:5173/?type=PasteIndexObject`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [ObjectCatalog](../object-catalog/ObjectCatalog.md) · [XML PasteIndexList](../../xml/catalogs/XML%20PasteIndexList.md)
