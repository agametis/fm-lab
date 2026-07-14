# MBS plugin guidelines for generated scripts

Migrated from `filemaker-script-erzeugen` v1; unchanged policy.

## Native first

Use MBS only when FileMaker has no native equivalent, the native one is
insufficient (performance, features), or the task is plugin territory (CURL
options beyond Insert from URL, PDF generation, external databases).

| Task | Native | MBS (only if needed) |
|---|---|---|
| JSON | JSONGetElement / JSONSetElement | JSON.Query (JSONPath) |
| HTTP | Insert from URL | CURL.* (advanced options) |
| Base64 | Base64Encode | Text.EncodeToBase64 |
| Hash | CryptDigest | Hash.SHA256 |
| E-mail | Send Mail step | SendMail.* (direct SMTP) |

Verify every MBS function name via the `mbs-function-reference` skill — the
P4 resolver checks names against `ObjectCatalog` (PluginFunction) and warns
on unknown ones, but only for solutions where the catalog knows the plugin.

## Object lifecycle

Always release MBS objects:

```
Set Variable [ $curl ; Value: MBS("CURL.New") ]
# ... operations ...
Set Variable [ $r ; Value: MBS("CURL.Release"; $curl) ]
```

## Paths

MBS file functions expect **native paths**, FileMaker steps expect FileMaker
paths:

```
Set Variable [ $pathNative ; Value: MBS("Path.FilemakerPathToNativePath"; Get(TemporaryPath) & "file.html") ]
Set Variable [ $r ; Value: MBS("Text.WriteTextFile"; $content; $pathNative; "UTF-8") ]
# Send Mail attachment uses the FileMaker path instead
```

## Clipboard conversion (delivery)

`MBS("Clipboard.SetMonitorEnabled"; 1)` once per client enables bidirectional
XML <-> FileMaker clipboard conversion — see `paste-semantics.md` §Delivery.
