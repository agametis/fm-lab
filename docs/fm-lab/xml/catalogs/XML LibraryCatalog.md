# XML LibraryCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

Embedded library entries (binary payloads such as images or icons) as `<BinaryData>` elements with a `<LibraryReference>` and a stream list. FM-Lab keeps only the reference metadata — the binary streams are stripped during normalization.

## Structure

```xml
<LibraryCatalog membercount="…">
    <BinaryData>
        <LibraryReference id="4" key="…"/>
        <StreamList>
            <Stream name="…" size="…" type="…">…base64 payload…</Stream>
        </StreamList>
    </BinaryData>
</LibraryCatalog>
```

**Extracted into:** [LibraryReferences](../../schema/catalog-tables/LibraryReferences.md) — column details in the [schema reference](../../schema/Schema.md).
