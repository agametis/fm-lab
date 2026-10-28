# CatalogChangeMeta

Part of the [FM-Lab schema](../Schema.md) · Change metadata · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** the `<UUID>` child of each catalog element under `Structure/AddAction` and of each `<FieldCatalog>` under `FieldsForTables` (see [XML](../../xml/XML.md))

Besides the objects, the catalogs of an export carry a change stamp of their own: `ScriptCatalog`, `LayoutCatalog`, `BaseTableCatalog` and every other catalog have a `<UUID>` child with the same four attributes as an object (`timestamp`, `userName`, `accountName`, `modifications`), and so does the field catalog of every base table. This table holds one row per catalog and file, plus one row per base table for the field catalogs.

## Columns

| Column | Type |
|---|---|
| `File_Name` | `VARCHAR` |
| `Catalog` | `VARCHAR` |
| `Scope_UUID` | `VARCHAR` |
| `Scope_Key` | `VARCHAR` |
| `Chunk_Seq` | `BIGINT` |
| `Catalog_UUID` | `VARCHAR` |
| `Modified_At` | `TIMESTAMP` |
| `Modified_At_Raw` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `Newest_Child_At` | `TIMESTAMP` |

## Catalogs

`Catalog` holds the element name: `AccountsCatalog`, `BaseDirectoryCatalog`, `BaseTableCatalog`, `CustomFunctionsCatalog`, `CustomMenuCatalog`, `CustomMenuSetCatalog`, `ExtendedPrivilegesCatalog`, `ExternalDataSourceCatalog`, `FileAccessCatalog`, `LayoutCatalog`, `PrivilegeSetsCatalog`, `RelationshipCatalog`, `ScriptCatalog`, `TableOccurrenceCatalog`, `ThemeCatalog`, `ValueListCatalog` and `FieldCatalog`. Only `FieldCatalog` rows have a scope: `Scope_UUID` is the UUID of the base table (join [BaseTableCatalog](BaseTableCatalog.md) on `BT_UUID`); `Scope_Key` is the same value with `''` instead of `NULL` and part of the key. Catalogs a file does not contain have no row; the library catalog carries no stamp.

## What the values mean

The counter `Modifications` rises with every save of an object in the catalog. The timestamp follows a rule of its own per catalog:

| Catalog | The timestamp moves when … |
|---|---|
| `ScriptCatalog` | any script action is saved — editing a script, reordering, moving into a folder, creating |
| `LayoutCatalog`, `AccountsCatalog` | the structure changes (a layout or account is created); editing a layout or a password change raise only the counter |
| `FieldCatalog` | a field of the table is deleted |
| `TableOccurrenceCatalog` | *Manage Database* is closed with OK — also when only fields changed |

`Newest_Child_At` is the newest object stamp of the catalog ([ObjectChangeMeta](ObjectChangeMeta.md); for a `FieldCatalog` the newest field of its table). A catalog stamp newer than every object points to a structural change after the last object edit. Only for `FieldCatalog` does that reliably mean a deletion — `ScriptCatalog` also moves on reordering, `TableOccurrenceCatalog` on every OK in *Manage Database*. Catalog stamps often follow the newest object by a few seconds (the dialog is committed after the object), so compare with a tolerance.

## Notes

- `Modified_At` is the local time of the editing client, without time zone; `Modified_At_Raw` keeps the exported text. Empty accounts are `NULL`.
- `Chunk_Seq` is technical (the import chunk that wrote the row); in a normal catalog every row has `0`. Treat `(Catalog, File_Name, Scope_Key)` as the identity.

```sql
-- Field catalogs changed after their newest field: a field was probably deleted
SELECT c.File_Name, b.BT_Name AS Base_Table, c.Modified_At, c.Newest_Child_At
FROM CatalogChangeMeta c
LEFT JOIN BaseTableCatalog b ON b.BT_UUID = c.Scope_UUID AND b.File_Name = c.File_Name
WHERE c.Catalog = 'FieldCatalog'
  AND c.Modified_At > c.Newest_Child_At + INTERVAL 1 MINUTE
ORDER BY c.Modified_At DESC;
```

**See also:** [ObjectChangeMeta](ObjectChangeMeta.md) · [FieldsForTables](FieldsForTables.md) · [ScriptCatalog](ScriptCatalog.md) · [Layouts](Layouts.md)
