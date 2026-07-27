# FileOptionsCatalog

Part of the [FM-Lab schema](../Schema.md) · File level · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** [XML Metadata](../../xml/catalogs/XML%20Metadata.md)

The file options of each file from the metadata branch: encryption state, minimum allowed client version, the auto-login account (security-relevant), sharing visibility switches, the default/start layout and page-setup defaults. One row per file.

## Columns

| Column | Type |
|---|---|
| `File_Name` | `VARCHAR` |
| `Encryption_Type` | `VARCHAR` |
| `Min_Version` | `VARCHAR` |
| `Min_Version_Value` | `VARCHAR` |
| `Login_Type` | `VARCHAR` |
| `Login_AccountName` | `VARCHAR` |
| `Show_SignIn_Fields` | `BOOLEAN` |
| `Spelling_Underline` | `BOOLEAN` |
| `Hide_WebDirect_Sharing` | `BOOLEAN` |
| `Hide_Client_Sharing` | `BOOLEAN` |
| `Default_Layout_ID` | `BIGINT` |
| `Default_Layout_Name` | `VARCHAR` |
| `Default_Layout_UUID` | `VARCHAR` |
| `Save_Password_Keychain` | `BOOLEAN` |
| `Save_Password_RequireMobile` | `BOOLEAN` |
| `PageSetup_Orientation` | `VARCHAR` |
| `PageSetup_Scale` | `VARCHAR` |
| `PageSetup_Width` | `VARCHAR` |
| `PageSetup_Height` | `VARCHAR` |

## Notes

- `Login_AccountName` (auto-login) becomes a `File → Account (auto_login_account)` link; the default layout a `File → Layout (default_layout)` link.

**See also:** [AccountsCatalog](AccountsCatalog.md) · [Layouts](Layouts.md) · [FilesCatalog](../object-catalog/FilesCatalog.md)
