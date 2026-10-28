# RelationshipCatalog

Part of the [FM-Lab schema](../Schema.md) · Data model · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML RelationshipCatalog](../../xml/catalogs/XML%20RelationshipCatalog.md)

The relationships of the graph, stored **per join predicate**: a relationship with a multi-field join produces one row per predicate, numbered by `Predicate_Index`, each naming the left/right table occurrence, the compared fields and the operator. Cascade options (allow create, delete related) and the per-side sort definitions complete the picture.

## Columns

| Column | Type |
|---|---|
| `Rel_ID` | `BIGINT` |
| `Rel_UUID` | `VARCHAR` |
| `Left_TO_Name` | `VARCHAR` |
| `Left_TO_ID` | `BIGINT` |
| `Left_TO_UUID` | `VARCHAR` |
| `Left_Delete` | `BOOLEAN` |
| `Left_Create` | `BOOLEAN` |
| `Right_TO_Name` | `VARCHAR` |
| `Right_TO_ID` | `BIGINT` |
| `Right_TO_UUID` | `VARCHAR` |
| `Right_Delete` | `BOOLEAN` |
| `Right_Create` | `BOOLEAN` |
| `Operator` | `VARCHAR` |
| `Predicate_Index` | `BIGINT` |
| `Left_Field_Name` | `VARCHAR` |
| `Left_Field_ID` | `BIGINT` |
| `Left_Field_UUID` | `VARCHAR` |
| `Left_Field_TO_Name` | `VARCHAR` |
| `Left_Field_TO_UUID` | `VARCHAR` |
| `Right_Field_Name` | `VARCHAR` |
| `Right_Field_ID` | `BIGINT` |
| `Right_Field_UUID` | `VARCHAR` |
| `Right_Field_TO_Name` | `VARCHAR` |
| `Right_Field_TO_UUID` | `VARCHAR` |
| `Left_Sort_Enabled` | `BOOLEAN` |
| `Left_Sort_Fields` | `VARCHAR` |
| `Left_Sort_Field_UUIDs` | `VARCHAR[]` |
| `Left_Sort_Field_IDs` | `BIGINT[]` |
| `Left_Sort_Field_TO_UUIDs` | `VARCHAR[]` |
| `Left_Sort_ValueList_UUIDs` | `VARCHAR[]` |
| `Right_Sort_Enabled` | `BOOLEAN` |
| `Right_Sort_Fields` | `VARCHAR` |
| `Right_Sort_Field_UUIDs` | `VARCHAR[]` |
| `Right_Sort_Field_IDs` | `BIGINT[]` |
| `Right_Sort_Field_TO_UUIDs` | `VARCHAR[]` |
| `Right_Sort_ValueList_UUIDs` | `VARCHAR[]` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- To count relationships (rather than predicates), group by `Rel_ID` and `File_Name`.
- `Rel_UUID` is the relationship's native FileMaker UUID and its `Object_UUID` in [ObjectCatalog](../object-catalog/ObjectCatalog.md); it repeats on every predicate row. Join to the catalog on `Object_UUID = Rel_UUID AND File_Name = File_Name` — clone files can share a UUID. `NULL` only for exports without `<UUID>`; the catalog key is then `rel_<Rel_ID>_<File_Name>`.
- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the `<UUID>` element (timestamp as text); [ObjectChangeMeta](ObjectChangeMeta.md) holds one typed row per relationship.
- Sorted relationship sides list their sort fields (and, for custom sorts, the reference value lists) in the `*_Sort_*` array columns — these feed the `sort_field` and `sorts_by_valuelist` graph links.

**See also:** [TableOccurrenceCatalog](TableOccurrenceCatalog.md) · [FieldsForTables](FieldsForTables.md)
