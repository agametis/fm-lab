# XML CustomMenuSetCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The custom menu sets: named collections of menus, each listing its member menus as an ordered `<CustomMenuList>` of references.

## Structure

```xml
<CustomMenuSetCatalog membercount="…">
    <ObjectList membercount="…">
        <CustomMenuSet id="1" name="Custom Menu Set 1" comment="…">
            <UUID …>…</UUID>
            <CustomMenuList membercount="…">
                <!-- CustomMenuReference entries in menu order -->
            </CustomMenuList>
            <TagList/>
        </CustomMenuSet>
    </ObjectList>
</CustomMenuSetCatalog>
```

**Extracted into:** [CustomMenuSetCatalog](../../schema/catalog-tables/CustomMenuSetCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
