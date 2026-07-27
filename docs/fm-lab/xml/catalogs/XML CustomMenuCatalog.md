# XML CustomMenuCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The custom menus with their items inline: each `<CustomMenu>` names its built-in base menu, install conditions and mode options, and carries a `<MenuItemList>` whose `<CustomMenuItem>` entries are commands, separators or submenu pointers.

## Structure

```xml
<CustomMenuCatalog membercount="…">
    <CustomMenu id="9" name="File Copy">
        <UUID …>…</UUID>
        <Base name="…" value="…"/>                <!-- built-in base menu -->
        <Comment>…</Comment>
        <Conditions><Install>…</Install></Conditions>
        <Options browseMode="…" findMode="…" previewMode="…"/>
        <MenuItemList membercount="…">
            <CustomMenuItem index="1" isSeparatorItem="False" isSubMenuItem="False" hash="…">
                <UUID>…</UUID>
                <Command id="…" name="…"/>                <!-- built-in command -->
                <Name><Calculation>…</Calculation></Name> <!-- calculated title -->
                <Override action="…" name="…" Shortcut="…"/>
                <Shortcut key="…" modifier="…"/>
                <action><Step id="…" …>…</Step></action>  <!-- embedded script step -->
                <CustomMenuReference id="…" name="…"/>    <!-- submenu target (no UUID) -->
            </CustomMenuItem>
        </MenuItemList>
        <TagList/>
    </CustomMenu>
</CustomMenuCatalog>
```

## Notes

- The submenu target `CustomMenuReference` carries only a file-local `id` — the importer resolves it via `(File_Name, Menu_ID)` into the `opens_menu` link.
- The importer keeps the raw `Menu_XML`/`Item_XML` fragments and additionally parses the items into [CustomMenuItemCatalog](../../schema/catalog-tables/CustomMenuItemCatalog.md).

**Extracted into:** [CustomMenuCatalog](../../schema/catalog-tables/CustomMenuCatalog.md) · [CustomMenuItemCatalog](../../schema/catalog-tables/CustomMenuItemCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
