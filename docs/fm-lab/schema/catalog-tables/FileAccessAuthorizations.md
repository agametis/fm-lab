# FileAccessAuthorizations

Part of the [FM-Lab schema](../Schema.md) · Security · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML FileAccessCatalog](../../xml/catalogs/XML%20FileAccessCatalog.md)

The inter-file access authorizations of each file (*File Access* protection): which other files are authorized to reference this file, with the authorization hash, the creating account and timestamp, and the require-authorization switches.

## Columns

| Column | Type |
|---|---|
| `Auth_ID` | `BIGINT` |
| `Auth_Type` | `VARCHAR` |
| `Is_Self` | `BOOLEAN` |
| `Authorized_Name` | `VARCHAR` |
| `Auth_UUID` | `VARCHAR` |
| `Authentication_Hash` | `VARCHAR` |
| `Source_CreationAccountName` | `VARCHAR` |
| `Source_CreationTimestamp` | `VARCHAR` |
| `Catalog_Required` | `BOOLEAN` |
| `Catalog_SameHost` | `BOOLEAN` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the object's `<UUID>` element: timestamp as text (local time of the editing client, no time zone), user name, account (empty → `NULL`) and change counter. [ObjectChangeMeta](ObjectChangeMeta.md) collects them across all object types with a typed timestamp.
- Authorizations have no [ObjectCatalog](../object-catalog/ObjectCatalog.md) entry; [ObjectChangeMeta](ObjectChangeMeta.md) lists them with `Object_Type = 'Authorization'`.

**See also:** [FileOptionsCatalog](FileOptionsCatalog.md)
