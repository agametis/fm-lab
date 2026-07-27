# XML ScriptCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

All scripts of the file including the Script Workspace folder tree: folders and separators are `<Script>` entries too, flagged by `isFolder`/`isSeparatorItem`. The steps themselves live in the separate [XML StepsForScripts](XML%20StepsForScripts.md) branch.

## Structure

```xml
<ScriptCatalog membercount="…">
    <Script id="27" name="Startup" isFolder="False" isSeparatorItem="False">
        <UUID modifications="…" userName="…" accountName="…" timestamp="…">0164…</UUID>
        <Options access="…" hidden="False" runwithfullaccess="False"
                 compatibility="…" SiriShortcutVisible="…"/>
        <TagList/>
    </Script>
</ScriptCatalog>
```

**Extracted into:** [ScriptCatalog](../../schema/catalog-tables/ScriptCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
