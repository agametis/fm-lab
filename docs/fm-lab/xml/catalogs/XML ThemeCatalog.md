# XML ThemeCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The layout themes of the file. Each `<Theme>` carries rich identity attributes (base name/version, platform, locale) and its complete CSS rule set as text, plus a theme-internal `<Metadata>` block with named styles.

## Structure

```xml
<ThemeCatalog membercount="…">
    <Theme id="1" name="com.filemaker.theme.enlightened" Display="Hell"
           Group="…" baseName="…" baseVersion="…" defaultTheme="…"
           locale="…" platform="…" version="…">
        <UUID …>…</UUID>
        <CSS><![CDATA[.self { … }]]></CSS>
        <Image type="…">…</Image>
        <Metadata><namedstyles>…</namedstyles>…</Metadata>
        <TagList/>
    </Theme>
</ThemeCatalog>
```

## Notes

- **Name collision:** the theme-internal `<Metadata>` block is unrelated to the file-level [XML Metadata](XML%20Metadata.md) branch — only a `<Metadata>` with an `<AddAction>` child is the file-options branch.

**Extracted into:** [ThemeCatalog](../../schema/catalog-tables/ThemeCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
