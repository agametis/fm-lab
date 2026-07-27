# XML LayoutCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The layouts with everything on them — the largest and deepest branch of the export. A `<Layout>` element covers the layout header (context table occurrence, theme and menu-set references, options, grid style, script triggers) and a `<PartsList>` whose `<Part>` elements contain the actual layout objects. Layout objects nest recursively: tab controls, slide controls, popovers and groups carry their children inside panel elements, reaching nesting depth 5 in practice.

## Structure

```xml
<LayoutCatalog membercount="…">
    <Layout id="2" name="Contacts" width="…" isFolder="False" isSeparatorItem="False">
        <UUID …>…</UUID>
        <TableOccurrenceReference id="…" name="Contacts" UUID="…"/>  <!-- context TO -->
        <LayoutThemeReference id="…" name="…" UUID="…" Base="…" Display="…"/>
        <MenuSet><CustomMenuSetReference id="…" name="…" UUID="…"/></MenuSet>
        <Options hidden="False"/>
        <GridStyle>…</GridStyle> <ClientType>…</ClientType>
        <ScriptTriggers membercount="…">
            <ScriptTrigger action="OnRecordLoad" browseMode="True" findMode="…" id="…">
                <ScriptReference id="…" name="…" UUID="…"/>
            </ScriptTrigger>
        </ScriptTriggers>
        <PartsList membercount="…">
            <Part type="Body" kind="…" name="…">
                <Definition size="…" absolute="…" Options="…" kind="…" type="…">
                    <FieldReference …/>   <!-- sub-summary break field only -->
                </Definition>
                <ObjectList membercount="…">
                    <LayoutObject id="7" type="Edit Box" kind="…" name="…" hash="…">
                        <UUID>…</UUID>
                        <Bounds top="…" left="…" bottom="…" right="…"/>
                        <Options>…</Options>
                        <Field>…type-specific payload…</Field>
                        <LocalCSS>…</LocalCSS> <ExtendedAttributes>…</ExtendedAttributes>
                        <!-- container types (TabControl, SlideControl, PopoverButton,
                             Group, Portal) nest child LayoutObjects in their panels -->
                    </LayoutObject>
                </ObjectList>
            </Part>
        </PartsList>
    </Layout>
</LayoutCatalog>
```

## Notes

- 22 layout-object types occur; the type-specific payload sits in a child element named after the type (`<Field>`, `<Text>`, `<Portal>`, `<TabControl>`, `<GroupedButton>`, `<WebViewer>`, …).
- Buttons can either call a script (`<ScriptReference>`) or embed a **single script step** (`Button/action/Step`) — the importer extracts both reference kinds.
- Conditional formatting, hide conditions, tooltips and placeholders are calculations inside the object payload; their `DDRREF` hashes join to [XML DDR_INFO](XML%20DDR_INFO.md).
- Folders and separators of the layout list appear as `<Layout>` entries with `isFolder`/`isSeparatorItem`; folder membership is carried by `<OwnerID>`.

**Extracted into:** [Layouts](../../schema/catalog-tables/Layouts.md) · [LayoutParts](../../schema/catalog-tables/LayoutParts.md) · [LayoutObjects](../../schema/catalog-tables/LayoutObjects.md) · [ScriptTriggers](../../schema/catalog-tables/ScriptTriggers.md) — column details in the [schema reference](../../schema/Schema.md).
