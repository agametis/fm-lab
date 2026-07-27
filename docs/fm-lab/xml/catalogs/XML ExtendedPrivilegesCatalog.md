# XML ExtendedPrivilegesCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The extended privileges of the file (`fmapp`, `fmwebdirect`, `fmxdbc`, custom keywords, …). Each entry lists the privilege sets that grant it in an inner `<ObjectList>` of references.

## Structure

```xml
<ExtendedPrivilegesCatalog membercount="…">
    <ObjectList membercount="…">
        <ExtendedPrivilege id="1" name="fmwebdirect">
            <UUID …>…</UUID>
            <Description>Access via FileMaker WebDirect</Description>
            <ObjectList membercount="…">
                <!-- PrivilegeSetReference entries: the sets granting this privilege -->
            </ObjectList>
            <TagList/>
        </ExtendedPrivilege>
    </ObjectList>
</ExtendedPrivilegesCatalog>
```

**Extracted into:** [ExtendedPrivilegesCatalog](../../schema/catalog-tables/ExtendedPrivilegesCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
