# XML AccountsCatalog

Part of the [FileMaker XML reference](../XML.md) · SaXML v2.2 (FileMaker 22) · `Structure/AddAction` branch

The user accounts with type, enabled state, authentication block and the privilege set they are assigned to. Passwords appear only in encrypted form.

## Structure

```xml
<AccountsCatalog membercount="…">
    <ObjectList membercount="…">
        <Account id="2" kind="…" type="…" enable="True">
            <UUID …>…</UUID>
            <Description>…</Description>
            <Authentication name="…" value="…">
                <AccountName>Admin</AccountName>
                <PasswordEncrypted>…</PasswordEncrypted>
                <ChangePasswordOnNextLogin>…</ChangePasswordOnNextLogin>
            </Authentication>
            <PrivilegeSetReference id="1" name="[Full Access]"/>
            <TagList/>
        </Account>
    </ObjectList>
</AccountsCatalog>
```

**Extracted into:** [AccountsCatalog](../../schema/catalog-tables/AccountsCatalog.md) — column details in the [schema reference](../../schema/Schema.md).
