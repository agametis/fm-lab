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
| `File_Name` | `VARCHAR` |

**See also:** [FileOptionsCatalog](FileOptionsCatalog.md)
