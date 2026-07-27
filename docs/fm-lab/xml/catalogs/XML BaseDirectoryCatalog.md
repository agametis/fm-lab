# XML BaseDirectoryCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

Named base directories of the file — path anchors that container-field storage and file references can resolve against. A small, flat catalog.

## Structure

```xml
<BaseDirectoryCatalog membercount="…" generate="True" temporary="True">
    <BaseDirectory id="1" name="Temporary" relativeTo="…">
        <UUID modifications="…" userName="…" accountName="…" timestamp="…">C2AF3F1D-…</UUID>
        <TagList/>
    </BaseDirectory>
</BaseDirectoryCatalog>
```

## Notes

- `relativeTo` carries the relative-to semantics of the directory definition.

**Extracted into:** [BaseDirectoryCatalog](../../schema/catalog-tables/BaseDirectoryCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
