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
| `File_Name` | `VARCHAR` |

**See also:** [PrivilegeSetsCatalog](PrivilegeSetsCatalog.md) · [FileOptionsCatalog](FileOptionsCatalog.md)
