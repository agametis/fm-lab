# XML FileAccessCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The inter-file access protection (*File Access*): whether authorization is required, and the list of files authorized to reference this one, each with its authorization record and creation metadata.

## Structure

```xml
<FileAccessCatalog required="True" sameHost="False">
    <UUID …>…</UUID>
    <ObjectList membercount="…">
        <Authorization id="1" type="…">
            <UUID …>…</UUID>
            <Display>Gruppen</Display>
            <Authentication>…</Authentication>
            <Source CreationAccountName="Admin" CreationTimestamp="…"/>
            <TagList/>
        </Authorization>
    </ObjectList>
</FileAccessCatalog>
```

**Extracted into:** [FileAccessAuthorizations](../../schema/catalog-tables/FileAccessAuthorizations.md) — column details in the [schema reference](../../schema/Schema.md).
