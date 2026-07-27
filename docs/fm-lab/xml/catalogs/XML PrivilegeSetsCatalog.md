# XML PrivilegeSetsCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The privilege sets with their full access tree. The `<access>` element carries one child per object class (`Records`, `Layouts`, `ValueLists`, `Scripts`) with class-level flags, plus `<Other>` for the extended toggles. When a class is set to custom privileges, a `<Custom>` child opens a per-object detail tree.

## Structure

```xml
<PrivilegeSetsCatalog membercount="…">
    <ObjectList membercount="…">
        <PrivilegeSet id="3" name="Data Entry Only">
            <UUID …>…</UUID>
            <Description>…</Description>
            <access default="…">
                <Records View="True" Edit="True" Create="True" Delete="False" Custom="False">
                    <Custom>                      <!-- only when Custom="True" -->
                        <ObjectList membercount="…">
                            <!-- per-table access incl. calc-based rules and
                                 per-field detail (Fields access="Custom") -->
                        </ObjectList>
                    </Custom>
                </Records>
                <Layouts View="…" Edit="…" Create="…" Delete="…" Custom="…">…</Layouts>
                <ValueLists …>…</ValueLists>
                <Scripts …>…</Scripts>
                <Other Export="…" Print="…" manageDatabase="…" manageAccounts="…"
                       manageCustomMenus="…" manageExtPrivs="…" allowOverride="…"
                       allowOpenQuickly="…" disconnectIdle="…" commands="…" value="…">
                    <Password Minimum="…" interval="…" prohibitModification="…"/>
                </Other>
            </access>
        </PrivilegeSet>
    </ObjectList>
</PrivilegeSetsCatalog>
```

## Notes

- When `Custom="True"`, the class-level attributes no longer reflect real access — the importer parses the detail tree into [PrivilegeSetRecordAccess](../../schema/catalog-tables/PrivilegeSetRecordAccess.md), [PrivilegeSetFieldAccess](../../schema/catalog-tables/PrivilegeSetFieldAccess.md) and [PrivilegeSetObjectAccess](../../schema/catalog-tables/PrivilegeSetObjectAccess.md).
- Record-access rules may be calculations (with `DDRREF` hash and context table occurrence) — their references are resolved into graph links.

**Extracted into:** [PrivilegeSetsCatalog](../../schema/catalog-tables/PrivilegeSetsCatalog.md) · [PrivilegeSetRecordAccess](../../schema/catalog-tables/PrivilegeSetRecordAccess.md) · [PrivilegeSetFieldAccess](../../schema/catalog-tables/PrivilegeSetFieldAccess.md) · [PrivilegeSetObjectAccess](../../schema/catalog-tables/PrivilegeSetObjectAccess.md) — column details in the [schema reference](../../schema/Schema.md).
