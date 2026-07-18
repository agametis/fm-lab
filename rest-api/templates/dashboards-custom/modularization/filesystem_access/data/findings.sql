-- @template_type: report
-- @description: Detailliste aller Dateisystem-Berührungspunkte — je Zeile eine Fundstelle (nativer Script-Step ODER MBS-Plugin-Aufruf) mit Operation, API-Gruppe, Träger-Objekt und Navigations-Anker. Native Steps sind Step_ID-gated (locale-unabhängig), MBS über PluginFunctionUsages (step-granular: Source_Subkey = Step_Index bei Source_Type='Script') — inkl. Step-Anchor und Script-Zeile.
-- @params: file (optional), operation (optional), api_group (optional), ref_type (optional), limit (optional, default 400)
--
-- KLASSIFIKATION — dieselbe CASE-Logik wie in fs_groups.sql. Beide Dateien
-- synchron halten (native Step_ID-Gruppen + MBS-Funktions-Muster).

WITH native AS (
    SELECT
        s.File_Name                                     AS file,
        'Native Step'                                   AS ref_type,
        s.Script_Name                                   AS carrier,
        s.Step_Name                                     AS detail,
        s.Step_Index                                    AS step_index,
        s.Script_UUID                                   AS nav_uuid,
        'Script'                                        AS nav_type,
        s.Step_UUID                                     AS step_uuid,
        CASE
            WHEN s.Step_ID IN (190,192)                 THEN 'write'
            WHEN s.Step_ID = 193                        THEN 'read'
            WHEN s.Step_ID IN (191,194,195,196,199)     THEN 'manage'
            WHEN s.Step_ID = 197                        THEN 'delete'
            WHEN s.Step_ID IN (188,189)                 THEN 'probe'
            WHEN s.Step_ID IN (35,131,56,158,159,161)   THEN 'import'
            ELSE                                             'export'
        END                                             AS operation,
        CASE
            WHEN s.Step_ID BETWEEN 188 AND 199          THEN 'Data File API'
            WHEN s.Step_ID IN (35,131,56,158,159,161)   THEN 'Import/Insert'
            ELSE                                             'Export/Save'
        END                                             AS api_group
    FROM StepsForScripts s
    WHERE s.Step_ID IN (190,191,192,193,194,195,196,197,199,188,189,
                        35,131,56,158,159,161,
                        36,132,143,144,152,225,37,3,96)
),
mbs_raw AS (
    SELECT
        p.File_Name                                     AS file,
        p.Source_Type,
        p.Source_UUID,
        p.Source_Subkey,
        regexp_extract(p.Plugin_Function_Name, '(?i)MBS:([A-Za-z]+)\.', 1)             AS component,
        regexp_extract(p.Plugin_Function_Name, '(?i)MBS:[A-Za-z]+\.([A-Za-z0-9]+)', 1) AS fn
    FROM PluginFunctionUsages p
    WHERE (regexp_matches(p.Plugin_Function_Name, '(?i)MBS:(Files|Path|Folders|FileDialog)\.')
        OR regexp_matches(p.Plugin_Function_Name, '(?i)MBS:(Text)\.(Read|Write|Append)TextFile')
        OR regexp_matches(p.Plugin_Function_Name, '(?i)MBS:(Container)\.(Export|ReadFile|WriteFile)'))
),
mbs AS (
    SELECT
        r.file                                          AS file,
        'MBS ' || r.Source_Type                         AS ref_type,
        COALESCE(s.Script_Name, oc.Object_Name)         AS carrier,
        r.component || '.' || r.fn                      AS detail,
        s.Step_Index                                    AS step_index,
        r.Source_UUID                                   AS nav_uuid,
        r.Source_Type                                   AS nav_type,
        s.Step_UUID                                     AS step_uuid,
        CASE
            WHEN r.component ILIKE 'Files' AND (r.fn ILIKE 'Read%' OR r.fn ILIKE 'List%')            THEN 'read'
            WHEN r.component ILIKE 'Files' AND r.fn IN ('CopyFile','CreateDirectory','RenameFile','MoveFile') THEN 'write'
            WHEN r.component ILIKE 'Files' AND (r.fn ILIKE 'Delete%' OR r.fn ILIKE 'MoveToTrash%')   THEN 'delete'
            WHEN r.component ILIKE 'Files' AND (r.fn LIKE '%Exists' OR r.fn LIKE '%Size' OR r.fn LIKE '%Date') THEN 'probe'
            WHEN r.component ILIKE 'Files' AND (r.fn ILIKE 'Launch%' OR r.fn ILIKE 'Reveal%')        THEN 'launch'
            WHEN r.component ILIKE 'Files' AND (r.fn ILIKE 'Mount%' OR r.fn ILIKE 'Unmount%')        THEN 'mount'
            WHEN r.component ILIKE 'Text'  AND r.fn ILIKE 'Read%'                                    THEN 'read'
            WHEN r.component ILIKE 'Text'  AND (r.fn ILIKE 'Write%' OR r.fn ILIKE 'Append%')         THEN 'write'
            WHEN r.component ILIKE 'Container' AND r.fn ILIKE 'Read%'                                THEN 'read'
            WHEN r.component ILIKE 'Container'                                                       THEN 'write'
            WHEN r.component ILIKE 'Path'                                                            THEN 'path'
            WHEN r.component ILIKE 'Folders'                                                         THEN 'path'
            WHEN r.component ILIKE 'FileDialog'                                                      THEN 'dialog'
            ELSE 'other'
        END                                             AS operation,
        'MBS ' || r.component                           AS api_group
    FROM mbs_raw r
    LEFT JOIN StepsForScripts s
      ON r.Source_Type = 'Script'
     AND s.Script_UUID = r.Source_UUID
     AND s.File_Name = r.file
     AND s.Step_Index = TRY_CAST(r.Source_Subkey AS INTEGER)
    LEFT JOIN ObjectCatalog oc ON oc.Object_UUID = r.Source_UUID AND oc.File_Name = r.file
),
all_hits AS (
    SELECT file, api_group, operation, ref_type, carrier, detail, step_index, nav_uuid, nav_type, step_uuid FROM native
    UNION ALL
    SELECT file, api_group, operation, ref_type, carrier, detail, step_index, nav_uuid, nav_type, step_uuid FROM mbs
)
SELECT
    *,
    -- eindeutiger Tabellen-Key: Step-UUID (native + MBS-Script), sonst
    -- Träger-UUID + Funktion (MBS-CustomFunction-Quellen ohne Step).
    COALESCE(step_uuid, nav_uuid || '-' || detail)      AS row_key
FROM all_hits
WHERE (getvariable('file') IS NULL OR file = getvariable('file'))
  AND (getvariable('operation') IS NULL OR getvariable('operation') IN ('', 'All', 'Alle')
       OR operation = getvariable('operation'))
  AND (getvariable('api_group') IS NULL OR getvariable('api_group') IN ('', 'All', 'Alle')
       OR api_group = getvariable('api_group'))
  AND (getvariable('ref_type') IS NULL OR getvariable('ref_type') IN ('', 'All', 'Alle')
       OR ref_type = getvariable('ref_type'))
ORDER BY api_group, operation, file, carrier, step_index
LIMIT CAST(COALESCE(getvariable('limit'), '400') AS INTEGER);
