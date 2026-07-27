# XML PasteIndexList

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

An ordered list of object IDs that FileMaker uses for copy/paste bookkeeping. It appears both as a top-level branch and embedded inside some catalogs. FM-Lab imports it into an internal table of the same name; it plays no role in the documented analysis surface.

## Structure

```xml
<PasteIndexList membercount="…">
    <Object id="…"/>
    <Object id="…"/>
</PasteIndexList>
```

**Extracted into:** internal table only — not part of the documented [schema](../../schema/Schema.md) surface.
