# BaseDirectoryCatalog

Part of the [FM-Lab schema](../Schema.md) · File level · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML BaseDirectoryCatalog](../../xml/catalogs/XML%20BaseDirectoryCatalog.md)

The base directories defined in each file — named path anchors (relative-to semantics included) that container fields and script steps can resolve external paths against.

## Columns

| Column | Type |
|---|---|
| `BD_Name` | `VARCHAR` |
| `BD_ID` | `BIGINT` |
| `BD_RelativeTo` | `VARCHAR` |
| `BD_UUID` | `VARCHAR` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the object's `<UUID>` element: timestamp as text (local time of the editing client, no time zone), user name, account (empty → `NULL`) and change counter. [ObjectChangeMeta](ObjectChangeMeta.md) collects them across all object types with a typed timestamp.

**See also:** [FileOptionsCatalog](FileOptionsCatalog.md)
