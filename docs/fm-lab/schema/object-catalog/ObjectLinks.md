# ObjectLinks

Part of the [FM-Lab schema](../Schema.md) · Object catalog · `db/fm_catalog.duckdb` (solution catalog)
**XML source:** derived in phases P2–P5 from references across all branches of the [FileMaker XML](../../xml/XML.md)

The edge list of the object graph: every resolved reference between two objects, within a file and across files. Each row connects a source object to a target object (both by UUID) and classifies the connection: `Link_Type` separates *operational* links (functional dependencies such as a script calling another script) from *structural* links (containment such as a layout object sitting on its layout), and `Link_Role` names the specific relation (`calls_script`, `sets_field`, `displays_field`, `parent_layout`, …). All references are resolved at import time — query this table instead of parsing raw XML columns.

## Columns

| Column          | Type      |                                                       |
| --------------- | --------- | ----------------------------------------------------- |
| `Source_UUID`   | `VARCHAR` |                                                       |
| `Source_Type`   | `VARCHAR` |                                                       |
| `Target_UUID`   | `VARCHAR` |                                                       |
| `Target_Type`   | `VARCHAR` |                                                       |
| `Link_Type`     | `VARCHAR` |                                                       |
| `Link_Role`     | `VARCHAR` | [Link Roles and Subroles](Link%20Roles%20and%20Subroles.md#link_role)                 |
| `Link_Subrole`  | `VARCHAR` | [Link Roles and Subroles](Link%20Roles%20and%20Subroles.md#link_subrole)              |
| `Source_File`   | `VARCHAR` |                                                       |
| `Target_File`   | `VARCHAR` |                                                       |
| `Is_Cross_File` | `BOOLEAN` |                                                       |

## Notes

- `Link_Subrole` carries a role-specific qualifier, e.g. the trigger type for `trigger_owner`, `left`/`right` for relationship sort fields, or the access mode for `restricts_*` links.
- `Is_Cross_File` together with `Source_File`/`Target_File` enables multi-file dependency analysis.
- The full role vocabulary and its classification live in [LinkRoleRegistry](LinkRoleRegistry.md). Note that `restricts_*` roles are restrictions, not usages — they never make an object count as "used".
- References onto duplicate-UUID twins are disambiguated at import via FileMaker's internal reference IDs, so each healed twin carries its own incoming edges (within the same file; cross-file references resolve to the twin that kept the original UUID). A healed twin with zero incoming links is therefore a real finding, not an import artifact — see [UUID Healing and Duplicate Census](../UUID%20Healing%20and%20Duplicate%20Census.md).

**See also:** [ObjectCatalog](ObjectCatalog.md) · [LinkRoleRegistry](LinkRoleRegistry.md) · [Link Roles and Subroles](Link%20Roles%20and%20Subroles.md) (all roles and subroles enumerated)
