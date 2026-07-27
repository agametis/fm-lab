# CustomMenuSet

Part of the [FileMaker object types](FileMaker%20Object%20Types.md) · semantic object-type reference

A **custom menu set** is a named, ordered collection of [custom menus](CustomMenu.md) — the unit FileMaker actually activates: a layout binds a menu set as its menu bar, and the *Install Menu Set* script step switches to one at runtime. FileMaker ships the built-in set `[Standard FileMaker Menus]`; solution-defined sets combine custom and stock menus in menu-bar order. The file also designates a default menu set.

CustomMenuSet is an **exported** type: each `<CustomMenuSet>` element of [XML CustomMenuSetCatalog](../../xml/catalogs/XML%20CustomMenuSetCatalog.md) becomes a row in [ObjectCatalog](../object-catalog/ObjectCatalog.md) with `Object_Type = 'CustomMenuSet'`; the member list is extracted both as arrays on the row and as structural `contains_menu` links into the graph.

## Properties

| Property (XML) | In catalog | Notes |
|---|---|---|
| `@id` | `MenuSet_ID` | Numeric FileMaker ID — unique per file only, join with `File_Name` |
| `@name` | `MenuSet_Name` | |
| `@comment` | `Comment` | Developer comment |
| `<UUID>` (text) | `MenuSet_UUID` | Stable identity, used for all joins |
| `<UUID>/@accountName`, `@userName`, `@timestamp`, `@modifications` | — | Modification metadata — **not extracted** |
| `<CustomMenuList>/<CustomMenuReference>` (`@id`, `@name`) | `Member_Menu_IDs` / `Member_Menu_Names` | Member menus in menu-bar order, as parallel arrays; references carry only file-local IDs (no UUID) |
| `<TagList>` | — | Tags — **not extracted** |
| Catalog-level `<CustomMenuSetReference>` | — | The file's *default* menu set, noted once at catalog level (e.g. `[Standard FileMaker Menus]`) — **not extracted** |

## Object hierarchy

The menu set is the root of the custom-menu tree: set —`contains_menu`→ [CustomMenu](CustomMenu.md) —(owns)— [CustomMenuItem](CustomMenuItem.md) (`parent_menu`; submenu items add `opens_menu` usage edges between menus). Membership references are resolved by `(File_Name, Menu_ID)` against [CustomMenuCatalog](../catalog-tables/CustomMenuCatalog.md); built-in member menus (e.g. `[Standard FileMaker Menus]` members like `[Spelling]` when they are not exported as custom menus) are not catalog objects and produce no link. Menu sets are file-local — there is no cross-file menu containment.

## References

Full role definitions: [Link Roles and Subroles](../object-catalog/Link%20Roles%20and%20Subroles.md).

### Outgoing links (CustomMenuSet as source)

| Link_Role | Target | Kind | Description |
|---|---|---|---|
| `contains_menu` | [CustomMenu](CustomMenu.md) | containment | The set lists this menu as a member |

### Incoming links (CustomMenuSet as target)

| Link_Role | Source | Kind | Description |
|---|---|---|---|
| `uses_menuset` | [Layout](Layout.md) | usage | The layout binds this menu set as its menu bar |
| `installs_menuset` | [Script](Script.md) | usage | An *Install Menu Set* step activates this set |

Both incoming roles count as usage — a menu set bound only by layouts (or only installed by scripts) never appears as dead code. Containment (`contains_menu`) does not make the *set* used; conversely it is what keeps the member menus reachable in hierarchy views.

## Schema & tooling

- **XML schema:** [XML CustomMenuSetCatalog](../../xml/catalogs/XML%20CustomMenuSetCatalog.md) — `Structure/AddAction` branch
- **DB schema:** [CustomMenuSetCatalog](../catalog-tables/CustomMenuSetCatalog.md) (member menus as ID/name arrays)
- **Detail view template:**
  > **TBD:** no dedicated detail view in the frontend yet — the generic detail template (`object_details_generic.sql`) is used by the [/api/get-details endpoint](../../rest-api/endpoints/Objects%20API.md).
- **Frontend:** object list at `http://localhost:5173/?type=CustomMenuSet`

**See also:** [Object Types](../object-catalog/Object%20Types.md) · [CustomMenu](CustomMenu.md) · [CustomMenuItem](CustomMenuItem.md) · [Layout](Layout.md) · [Script](Script.md)
