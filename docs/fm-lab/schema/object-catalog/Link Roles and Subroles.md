# Link Roles and Subroles

Part of the [FM-Lab schema](../Schema.md) · Object catalog · enumerations of [ObjectLinks](ObjectLinks.md)

> Enumeration state: **schema version 1.14.0** (2026-07-16) — see [Schema Version History](../Schema%20Version%20History.md). The authoritative runtime source is the [LinkRoleRegistry](LinkRoleRegistry.md) table; new schema versions may add roles.

Every edge in [ObjectLinks](ObjectLinks.md) is classified by three values: `Link_Type` (the coarse class), `Link_Role` (the specific relation — a closed vocabulary of 59 registered roles) and `Link_Subrole` (an optional, role-specific qualifier). This page enumerates all three. `Link_Role` and `Link_Subrole` live on one page deliberately: a subrole has no meaning of its own — it always qualifies a specific role.

## Link_Type

| Value | Description |
|---|---|
| `operational` | A functional dependency: the source *uses* the target (calls, reads, writes, displays, navigates, restricts). Where-used and dead-code analyses walk these edges. |
| `structural` | A containment relation: the source *belongs to* the target (a step to its script, an object to its layout, an item to its menu). These edges model hierarchy, never usage. |

## Link_Role

Roles are registered in [LinkRoleRegistry](LinkRoleRegistry.md) with their kind (`usage` / `containment` / `restriction`) and the `Counts_For_Where_Used` flag. All 49 usage roles count for where-used; containment and restriction roles never do — a privilege set restricting a layout does not make that layout "used".

The *Source → Target* column lists the documented carrier types; a role can have several (e.g. `reads_field` is carried by scripts, calculated fields, custom functions, layout objects and privilege sets alike).

### Usage roles (49)

| Role                   | Source → Target                                                               | Description                                                     |
| ---------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `auto_login_account`   | File → Account                                                                | Auto-login account from the file options (security-relevant)    |
| `base_table`           | TableOccurrence → BaseTable                                                   | The base table the occurrence represents                        |
| `breaks_on_field`      | LayoutPart → Field                                                            | Sub-summary part breaks on this field                           |
| `calls_customfunction` | Script/Field/LayoutObject/ CustomFunction/ PrivilegeSet → CustomFunction      | A calculation calls the custom function                         |
| `calls_function`       | Script/Field/LayoutObject/ CustomFunction/ CustomMenuItem/… → BuiltinFunction | A calculation calls a built-in FileMaker function               |
| `calls_pluginfunction` | Script/Field/LayoutObject/ CustomFunction/ PrivilegeSet → PluginFunction      | A calculation calls an external plugin function (e.g. MBS)      |
| `calls_script`         | Script → Script                                                               | Perform Script (incl. Perform Script on Server) target          |
| `context_table`        | Layout → TableOccurrence                                                      | The layout's context table occurrence                           |
| `data_source`          | TableOccurrence/ValueList → ExternalDataSource                                | Object sources its data from this external data source          |
| `default_layout`       | File → Layout                                                                 | Start layout from the file options                              |
| `displays_field`       | LayoutObject/Layout → Field                                                   | The field is displayed (field control or merge field)           |
| `displays_variable`    | LayoutObject → Variable                                                       | A merge variable is displayed on the layout                     |
| `exports_from_field`   | Script → Field                                                                | Export-class steps read the field                               |
| `finds_in_field`       | Script → Field                                                                | Find-class steps constrain on the field                         |
| `grants_privilege`     | PrivilegeSet → ExtendedPrivilege                                              | The privilege set grants this extended privilege                |
| `imports_to_field`     | Script → Field                                                                | Import-class steps write the field                              |
| `inputs_to_field`      | Script → Field                                                                | Insert-class steps target the field                             |
| `installs_menuset`     | Script → CustomMenuSet                                                        | Install Menu Set step                                           |
| `left_field`           | Relationship → Field                                                          | Join-predicate field of the left side (one pair per predicate)  |
| `left_table`           | Relationship → TableOccurrence                                                | Left table occurrence of the relationship                       |
| `lookup_relationship`  | Field → TableOccurrence                                                       | The lookup resolves through this relationship                   |
| `lookup_source`        | Field → Field                                                                 | The lookup copies from this source field                        |
| `navigates_to_field`   | Script/LayoutObject → Field                                                   | Go-to-Field-class steps target the field                        |
| `navigates_to_layout`  | Script/LayoutObject → Layout                                                  | Go to Layout / GTRR target layout (incl. button-embedded steps) |
| `navigates_to_to`      | Script/LayoutObject → TableOccurrence                                         | Go to Related Record target occurrence (GTRR only)              |
| `opens_menu`           | CustomMenuItem → CustomMenu                                                   | Submenu item opens this menu                                    |
| `parent_table`         | Field → BaseTable                                                             | The base table the field belongs to                             |
| `portal_context`       | LayoutObject → TableOccurrence                                                | The portal's data-source occurrence                             |
| `privilege_set`        | Account → PrivilegeSet                                                        | The account is assigned this privilege set                      |
| `reads_field`          | Script/Field/CustomFunction/ LayoutObject/PrivilegeSet → Field                | A step or calculation reads the field                           |
| `reads_variable`       | Script/Field/CustomFunction/ LayoutObject/PrivilegeSet → Variable             | A step or calculation reads the variable                        |
| `references_field`     | Script/LayoutObject → Field                                                   | Fallback role for field references of uncurated step types      |
| `right_field`          | Relationship → Field                                                          | Join-predicate field of the right side                          |
| `right_table`          | Relationship → TableOccurrence                                                | Right table occurrence of the relationship                      |
| `sets_field`           | Script/LayoutObject → Field                                                   | Set-Field-class steps write the field                           |
| `sets_variable`        | Script/CustomFunction → Variable                                              | Set Variable step / Let assignment writes the variable          |
| `sort_field`           | Relationship → Field                                                          | Sort field of a relationship side                               |
| `sorts_by_field`       | Script/LayoutObject → Field                                                   | Sort Records / portal sort / button-embedded sort field         |
| `sorts_by_valuelist`   | Script/LayoutObject/Relationship → ValueList                                  | Custom sort order by value list                                 |
| `source_field`         | ValueList → Field                                                             | Field-based value list: the value field                         |
| `source_table`         | ValueList → TableOccurrence                                                   | Field-based value list: the source occurrence                   |
| `source_valuelist`     | ValueList → ValueList                                                         | External wrapper sources its values from a list in another file |
| `summarizes_field`     | Field → Field                                                                 | Summary field aggregates this field                             |
| `trigger_script`       | ScriptTrigger → Script                                                        | The script the trigger fires                                    |
| `triggers_script`      | LayoutObject → Script                                                         | The object (button, trigger carrier) performs the script        |
| `uses_menuset`         | Layout → CustomMenuSet                                                        | Layout-bound menu set                                           |
| `uses_theme`           | Layout → Theme                                                                | The layout uses this theme                                      |
| `uses_valuelist`       | LayoutObject/Field → ValueList                                                | Field control uses the list; field validation by list           |
| `validates_by_calc`    | Field → Field/CustomFunction                                                  | A field-validation calculation references the target            |

### Containment roles (8)

Structural owner relations (`Link_Type = 'structural'`); never counted as usage.

| Role | Source → Target | Description |
|---|---|---|
| `contains_menu` | CustomMenuSet → CustomMenu | The menu set contains the menu as a member |
| `groups_into` | PluginFunction → PluginComponent | Plugin functions aggregate into their component |
| `parent_folder` | Script/Layout/Folder → Folder | The object sits in this folder (script/layout folder trees; folders nest) |
| `parent_layout` | LayoutObject/LayoutPart → Layout | The object or part belongs to the layout |
| `parent_menu` | CustomMenuItem → CustomMenu | The item belongs to the menu (owner backlink — the *usage* counterpart is `opens_menu`) |
| `parent_object` | LayoutObject → LayoutObject | A nested object's container parent (tab panel, group, popover, …) |
| `parent_script` | ScriptStep → Script | The step belongs to the script |
| `trigger_owner` | ScriptTrigger → Layout/LayoutObject/File | The trigger hangs on this owner |

### Restriction roles (2)

Access limitations from Custom Privileges (`Access_Mode <> 'ReadWrite'` only). A restriction is **not** a usage — these edges never make an object appear "used".

| Role | Source → Target | Description |
|---|---|---|
| `restricts_field` | PrivilegeSet → Field | Field-level custom privilege restriction |
| `restricts_object` | PrivilegeSet → Layout/ValueList/Script | Object-level custom privilege restriction |

## Link_Subrole

`Link_Subrole` is **not a closed enum**: its value set depends on the role, and some patterns are dynamic (they embed object names or indexes). NULL when a role needs no qualifier.

| Role(s) | Subrole values | Meaning |
|---|---|---|
| `trigger_owner` | `OnFirstWindowOpen`, `OnRecordLoad`, `OnLayoutEnter`, `OnObjectSave`, … | The trigger event type |
| `parent_layout` (LayoutPart) | `Body`, `Header`, `Footer`, `Title Header`, `Leading Sub-summary`, `Trailing Grand Summary`, `Top Navigation`, … | The part type |
| `breaks_on_field` | part type (e.g. `Leading Sub-summary`) | Which part breaks on the field |
| `sort_field` | `left`, `right` | Which relationship side sorts |
| `sorts_by_valuelist` | `left`, `right` (relationship) · `portal`, `button` (layout object) | Which carrier defines the custom sort |
| `sorts_by_field` | `portal`, `button` | Portal sort vs. button-embedded sort step |
| `restricts_field`, `restricts_object` | `NoAccess`, `ReadOnly`, `Calculation`, … | The access mode of the restriction |
| PrivilegeSet-carried `reads_field`, `reads_variable`, `calls_customfunction`, `calls_pluginfunction` | `<Operation>:<Table>` (e.g. `Delete:Contacts`) | Which Custom-Record-Privilege rule carries the reference |
| calculation-carried roles (`reads_field`, `calls_function`, …) | step index (`0`, `1`, …) or calc slot (`Hide`, `Tooltip`, `Condition_1`, `Filter`, `Install`, `Placeholder`, chart series keys, …) | Which calculation of the owner contains the reference — the DDR calc-anchor suffix (see [XML DDR_INFO](../../xml/catalogs/XML%20DDR_INFO.md)) |
| `uses_valuelist`, `validates_by_calc` | `validation` | The reference comes from a field validation |
| `source_field` | `primary`, `secondary`, `secondary_sort` | Which value-list field slot |
| `summarizes_field` | `List`, `Total`, `Average`, … | The summary operation |

**See also:** [ObjectLinks](ObjectLinks.md) · [LinkRoleRegistry](LinkRoleRegistry.md) · [Object Types](Object%20Types.md)
