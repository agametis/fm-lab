# ExtendedPrivilegesCatalog

Part of the [FM-Lab schema](../Schema.md) · Security · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML ExtendedPrivilegesCatalog](../../xml/catalogs/XML%20ExtendedPrivilegesCatalog.md)

The extended privileges (`fmapp`, `fmwebdirect`, `fmxdbc`, custom keywords, …) of each file, each with the list of privilege sets that grant it — the quick answer to access-audit questions like "who may connect via WebDirect?" (also available as `grants_privilege` graph links).

## Columns

| Column | Type |
|---|---|
| `EP_ID` | `BIGINT` |
| `EP_Name` | `VARCHAR` |
| `EP_Description` | `VARCHAR` |
| `EP_UUID` | `VARCHAR` |
| `PrivilegeSet_IDs` | `BIGINT[]` |
| `PrivilegeSet_Names` | `VARCHAR[]` |
| `File_Name` | `VARCHAR` |

**See also:** [PrivilegeSetsCatalog](PrivilegeSetsCatalog.md)
