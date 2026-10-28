# AccountsCatalog

Part of the [FM-Lab schema](../Schema.md) · Security · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML AccountsCatalog](../../xml/catalogs/XML%20AccountsCatalog.md)

The user accounts of each file with type, enabled state, description and the privilege set they are assigned to (`privilege_set` link). Password hashes appear only in the encrypted form the export contains.

## Columns

| Column | Type |
|---|---|
| `Account_ID` | `BIGINT` |
| `Account_Kind` | `BIGINT` |
| `Account_Type` | `VARCHAR` |
| `Is_Enabled` | `BOOLEAN` |
| `Account_UUID` | `VARCHAR` |
| `Description` | `VARCHAR` |
| `Account_Name` | `VARCHAR` |
| `Password_Encrypted` | `VARCHAR` |
| `PrivilegeSet_ID` | `BIGINT` |
| `PrivilegeSet_Name` | `VARCHAR` |
| `Modified_At` | `VARCHAR` |
| `Modified_By` | `VARCHAR` |
| `Modified_Account` | `VARCHAR` |
| `Modifications` | `BIGINT` |
| `File_Name` | `VARCHAR` |

## Notes

- `Modified_At` / `Modified_By` / `Modified_Account` / `Modifications` are the raw change metadata of the object's `<UUID>` element: timestamp as text (local time of the editing client, no time zone), user name, account (empty → `NULL`) and change counter. [ObjectChangeMeta](ObjectChangeMeta.md) collects them across all object types with a typed timestamp.
- Runtime changes stamp an account too: when a user changes their password, `Modified_By` / `Modified_Account` name that user and account — not a developer.

**See also:** [PrivilegeSetsCatalog](PrivilegeSetsCatalog.md) · [FileOptionsCatalog](FileOptionsCatalog.md)
