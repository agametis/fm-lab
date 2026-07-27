# ExtendedPrivilege

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

An **extended privilege** is a named access keyword of a FileMaker file. FileMaker ships a set of reserved `fm…` keywords that gate the access channels (network sharing, WebDirect, ODBC/JDBC, the Data API, …); developers can add custom keywords and test them at runtime with `Get(AccountExtendedPrivileges)`. An extended privilege has no behavior of its own — it takes effect only through the [privilege sets](PrivilegeSet.md) that grant it, which the export lists per privilege as an inner reference list.

ExtendedPrivilege is an **exported** type: each row of [ObjectCatalog](../object-catalog/ObjectCatalog.md) with `Object_Type = 'ExtendedPrivilege'` mirrors one `<ExtendedPrivilege>` element of the export, and the definition lands in [ExtendedPrivilegesCatalog](../catalog-tables/ExtendedPrivilegesCatalog.md). The grant list is stored both as array columns and as `grants_privilege` graph links — the quick answer to access-audit questions like "who may connect via WebDirect?".

## Properties

The table below lists the full property surface of the `<ExtendedPrivilege>` element in the XML export and where each property lands in the catalog. Properties marked **not extracted** are visible in the raw XML only.

| Property (XML) | In catalog | Notes |
|---|---|---|
| `@id` | `EP_ID` | Numeric FileMaker ID — unique per file only, join with `File_Name` |
| `@name` | `EP_Name` | The privilege keyword — see [Enumerations](#enumerations) |
| `<UUID>` (text) | `EP_UUID` | Stable identity, used for all joins |
| `<UUID>/@accountName`, `@userName`, `@timestamp`, `@modifications` | — | Modification metadata (who/when/count) — **not extracted** |
| `<Description>` | `EP_Description` | Description (FileMaker pre-fills it for the reserved keywords) |
| inner `<ObjectList>` of `<PrivilegeSetReference>` | `PrivilegeSet_IDs` / `PrivilegeSet_Names` (arrays) | The privilege sets granting this privilege — → incoming `grants_privilege` links |
| `<TagList>` | — | Object tags — **not extracted** |

## References

An extended privilege is a pure target: it produces no outgoing edges and is referenced only by the privilege sets that grant it. Full role definitions: [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

### Outgoing links (ExtendedPrivilege as source)

None.

### Incoming links (ExtendedPrivilege as target)

| Link_Role | Source | Kind | Description |
|---|---|---|---|
| `grants_privilege` | [PrivilegeSet](PrivilegeSet.md) | usage | The privilege set grants this extended privilege |

## Enumerations

The keyword itself (`EP_Name`) is an open set: FileMaker's reserved `fm…` keywords plus arbitrary custom names. Keywords observed in the ooe-fm test corpus *(corpus)*: `fmapp`, `fmwebdirect`, `fmxdbc`, `fmxml`, `fmphp`, `fmextscriptaccess`, `fmurlscript`, `fmrest`, `fmodata`, `fmplugin`, `fmreauthenticate10` (the trailing number is the re-authentication timeout in minutes) and one custom keyword.

## Schema & tooling

- **XML schema:** [XML ExtendedPrivilegesCatalog](../../xml/catalogs/XML%20ExtendedPrivilegesCatalog.md) — `<ExtendedPrivilegesCatalog>` branch, one `<ExtendedPrivilege>` per keyword
- **DB schema:** [ExtendedPrivilegesCatalog](../catalog-tables/ExtendedPrivilegesCatalog.md)
- **Detail view template:** no dedicated template — `/api/get-details` falls back to the generic detail template (`object_details_generic.sql`), served via the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md)
- **Frontend:** object list at `http://localhost:5173/?type=ExtendedPrivilege`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [PrivilegeSet](PrivilegeSet.md) · [Account](Account.md) · [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md)
