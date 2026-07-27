# Account

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

An **account** is a login identity of a FileMaker file. Each account carries an authentication block (account name, encrypted password for FileMaker-internal accounts), an enabled/disabled state, an account type that names the identity provider (FileMaker-internal, External Server group, or one of the OAuth providers) and exactly one assigned [privilege set](PrivilegeSet.md) that decides what the account may do. Passwords appear in the export only in encrypted form — the catalog never contains clear-text credentials.

Account is an **exported** type: each row of [ObjectCatalog](../object-catalog/ObjectCatalog.md) with `Object_Type = 'Account'` mirrors one `<Account>` element of the `AccountsCatalog` branch, and the full definition lands in [AccountsCatalog](../catalog-tables/AccountsCatalog.md). The privilege-set assignment is resolved into a `privilege_set` graph link; if the file options define an auto-login account, the [File](File.md) object points at the account via `auto_login_account` — a security-relevant edge worth auditing.

## Properties

The table below lists the full property surface of the `<Account>` element in the XML export and where each property lands in the catalog. Properties marked **not extracted** are visible in the raw XML only.

| Property (XML)                                                     | In catalog                              | Notes                                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@id`                                                              | `Account_ID`                            | Numeric FileMaker ID — unique per file only, join with `File_Name`                                      |
| `@kind`                                                            | `Account_Kind`                          | Numeric provider code, pairs with `@type` — see [Enumerations](#enumerations)                                       |
| `@type`                                                            | `Account_Type`                          | Provider name (FileMaker, External, OAuth providers)                                                    |
| `@enable`                                                          | `Is_Enabled`                            | Active/inactive state of the account                                                                    |
| `<UUID>` (text)                                                    | `Account_UUID`                          | Stable identity, used for all joins                                                                     |
| `<UUID>/@accountName`, `@userName`, `@timestamp`, `@modifications` | —                                       | Modification metadata (who/when/count) — **not extracted**                                              |
| `<Description>`                                                    | `Description`                           | Developer description                                                                                   |
| `<Authentication>/<AccountName>`                                   | `Account_Name`                          | The login name                                                                                          |
| `<Authentication>/<PasswordEncrypted>`                             | `Password_Encrypted`                    | Encrypted password blob as contained in the export                                                      |
| `<Authentication>/<ChangePasswordOnNextLogin>`                     | —                                       | Must-change-password flag — **not extracted**                                                           |
| `<Authentication>` `@name` / `@value`                              | —                                       | Occasionally present (e.g. `name="Plain Password" value="2"`); meaning undocumented — **not extracted** |
| `<PrivilegeSetReference>`                                          | `PrivilegeSet_ID` / `PrivilegeSet_Name` | → `privilege_set` link                                                                                  |
| `<TagList>`                                                        | —                                       | Object tags — **not extracted**                                                                         |

## References

The account graph is small but security-critical: one outgoing edge to the assigned privilege set, and a possible incoming edge from the file options. Full role definitions: [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

### Outgoing links (Account as source)

| Link_Role | Target | Kind | Description |
|---|---|---|---|
| `privilege_set` | [PrivilegeSet](PrivilegeSet.md) | usage | The account is assigned this privilege set |

### Incoming links (Account as target)

| Link_Role | Source | Kind | Description |
|---|---|---|---|
| `auto_login_account` | [File](File.md) | usage | Auto-login account from the file options (security-relevant) |

## Enumerations

`Account_Kind` and `Account_Type` always appear as a pair — the numeric code and its provider name. The pairs below are the literals observed in the ooe-fm test corpus *(corpus)*; further providers exist in FileMaker and would appear as additional pairs.

| Account_Kind | Account_Type |
|---|---|
| `0` | `FileMaker` |
| `1` | `External` |
| `18` | `Amazon` |
| `34` | `Microsoft Azure User` |
| `35` | `Microsoft Azure Group` |
| `66` | `Custom OAuth` |
| `67` | `Custom OAuth Group` |

## Schema & tooling

- **XML schema:** [XML AccountsCatalog](../../xml/catalogs/XML%20AccountsCatalog.md) — `<AccountsCatalog>` branch, one `<Account>` per account
- **DB schema:** [AccountsCatalog](../catalog-tables/AccountsCatalog.md)
- **Detail view template:**
  > **TBD:** no dedicated detail view in the frontend yet — the generic detail template (`object_details_generic.sql`) is used, served via the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md).
- **Frontend:** object list at `http://localhost:5173/?type=Account`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [PrivilegeSet](PrivilegeSet.md) · [ExtendedPrivilege](ExtendedPrivilege.md) · [File](File.md) · [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md)
