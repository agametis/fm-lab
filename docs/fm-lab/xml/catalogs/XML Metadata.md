# XML Metadata

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · top-level `Metadata` branch

The file-level options — a top-level `<Metadata>` branch (sibling of `<Structure>`) whose `<AddAction>` holds one element per option group: encryption, minimum client version, the login block (auto-login!), sharing visibility, the start layout, page setup, icons and the file-level script triggers.

## Structure

```xml
<Metadata membercount="…">
    <AddAction membercount="…">
        <Encryption type="0"/>
        <Minimum version="19.0" value="1900"/>
        <Login type="1">                      <!-- type=1 + AccountName = auto-login -->
            <AccountName>Admin</AccountName>
        </Login>
        <ShowSignInFields enable="…"/>
        <SavePassword keychain="…" requireMobile="…"/>
        <Spelling underline="False"/>
        <HideWebDirectSharing enable="…"/> <HideClientSharing enable="…"/>
        <Defaults><LayoutReference id="…" name="…" UUID="…"/></Defaults>  <!-- start layout -->
        <PageSetup>
            <Orientation name="…" value="…"/> <scale value="…"/> <size width="…" height="…"/>
        </PageSetup>
        <IconData scale="…" type="…">…</IconData>
        <ScriptTriggers membercount="…">      <!-- file-level: OnFirstWindowOpen, … -->
            <ScriptTrigger action="OnFirstWindowOpen" browseMode="…" id="…">
                <ScriptReference id="…" name="…" UUID="…"/>
            </ScriptTrigger>
        </ScriptTriggers>
    </AddAction>
</Metadata>
```

## Notes

- The auto-login account (`Login type="1"` with `<AccountName>`) is security-relevant and becomes the `auto_login_account` link.
- Only a `<Metadata>` element with an `<AddAction>` child is this branch — themes contain unrelated `<Metadata>` blocks of their own (see [XML ThemeCatalog](XML%20ThemeCatalog.md)).

**Extracted into:** [FileOptionsCatalog](../../schema/catalog-tables/FileOptionsCatalog.md) · [ScriptTriggers](../../schema/catalog-tables/ScriptTriggers.md) — column details in the [schema reference](../../schema/Schema.md).
