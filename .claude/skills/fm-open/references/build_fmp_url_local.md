# Degraded mode — build the fmIDE fmp:// URL locally (REST API down)

Read this only when the REST API is unreachable and the user chose the degraded
mode (fm-open workflow step 2b). Every result MUST be prefixed with:
`REST API unreachable — URL built locally, plugin/script status unverified.`

## 1. Configuration

```bash
cat rest-api/src/plugins/fmide/plugin.json 2>/dev/null
```

Read the config defaults from the manifest. Fallbacks if unreadable:
`fmp_protocol=fmp`, `server_address=$`, `script_name=fmIDE`.

## 2. URL pattern

```
<fmp_protocol>://<server_address>/<File_Name>?script=<script_name>&<$param>=<URL-encoded value>
```

## 3. Type → parameter mapping

Direct types (single name parameter, no extra lookup):

| Object_Type | fmIDE parameter |
|---|---|
| Script | `$script_name` |
| Layout | `$layout_name` |
| LayoutObject | `$object_name` |
| LayoutPart | `$layout_part_name` |
| BaseTable | `$base_table_name` |
| TableOccurrence | `$t_o_name` |
| CustomFunction | `$custom_function_name` |
| ValueList | `$value_list_name` |
| Account | `$account_name` |
| PrivilegeSet | `$privilege_set_name` |
| Theme | `$theme_name` |
| CustomMenu | `$custom_menu_name` |
| ExtendedPrivilege | `$extended_privilege_name` |
| ExternalDataSource | `$external_data_source_name` |

Not supported (no fmIDE parameter exists): Variable, DDR_ScriptStep,
DDR_Calculation, BaseDirectory, File → decline and point to `/fm-show`.

## 4. Context types (need one extra lookup)

**ScriptStep** → parent script + step index, then
`…&$script_name=<Script>&$script_step_number=<Index>`:

```sql
SELECT oc_script.Object_Name AS Script_Name, s.Step_Index
FROM ObjectLinks ol
JOIN ObjectCatalog oc_script ON ol.Target_UUID = oc_script.Object_UUID
JOIN StepsForScripts s ON s.Step_UUID = '<UUID>'
WHERE ol.Source_UUID = '<UUID>' AND ol.Link_Role = 'parent_script'
LIMIT 1;
```

**Field** → parent table, then `…&$base_table_name=<Table>&$field_name=<Field>`:

```sql
SELECT oc_table.Object_Name AS Table_Name
FROM ObjectLinks ol
JOIN ObjectCatalog oc_table ON ol.Target_UUID = oc_table.Object_UUID
WHERE ol.Source_UUID = '<UUID>' AND ol.Link_Role = 'parent_table'
LIMIT 1;
```

**Relationship** → fallback to the left TableOccurrence (`…&$t_o_name=<TO>`):

```sql
SELECT oc_to.Object_Name AS TO_Name
FROM ObjectLinks ol
JOIN ObjectCatalog oc_to ON ol.Target_UUID = oc_to.Object_UUID
WHERE ol.Source_UUID = '<UUID>' AND ol.Link_Role = 'left_table'
LIMIT 1;
```

**ScriptTrigger** → fallback to the triggered script (`…&$script_name=<Script>`):

```sql
SELECT oc_script.Object_Name AS Script_Name
FROM ObjectLinks ol
JOIN ObjectCatalog oc_script ON ol.Target_UUID = oc_script.Object_UUID
WHERE ol.Source_UUID = '<UUID>' AND ol.Link_Role = 'trigger_script'
LIMIT 1;
```

## 5. URL encoding of parameter values

Encode `%` FIRST, then the rest:
`%`→`%25` · space→`%20` · `&`→`%26` · `=`→`%3D` · `+`→`%2B` · `/`→`%2F` ·
`?`→`%3F` · `#`→`%23`

## 6. Opening

Hand the finished URL to `open_url.sh` exactly like the normal path (workflow
step 4). The URL is passed as one double-quoted argument; the `$` characters in
fmIDE parameter names need no extra escaping inside the script.
