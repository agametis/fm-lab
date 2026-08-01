-- @template_type: report
-- @description: Konsolidierte URL-Liste — aggregiert pro Wurzel-Element (Domain/IP + Port, ohne Pfad) mit Verwendungsanzahl und betroffenen Dateien. Respektiert dieselben Filter wie die URL-Detailliste (comment/api_family/ref_type/context/source_type/file), NICHT den host-Filter selbst (dieser Block ist der Host-Selektor). CTE-Kette identisch zu url_details.sql halten (V-2).
-- @params: file (optional), api_family (optional), ref_type (optional), step_name (optional), context (optional), source_type (optional), comment (optional), limit (optional, default 200)

WITH
-- 1) Open URL / Insert from URL — Script-Step direkt mit URL (http-Filter)
script_url_steps AS (
    SELECT
        s.Script_UUID                                       AS script_uuid,
        s.Script_Name                                       AS name,
        s.File_Name                                         AS file,
        s.Step_Name                                         AS context,
        s.Step_Index + 1                                        AS step_index,
        s.Step_UUID                                         AS step_uuid,
        s.Script_UUID                                       AS target_uuid,
        'Script'                                            AS target_type,
        NULL                                                AS layout_filter_types,
        regexp_extract(ddr.Step_Text, 'https?://[^ "]+')    AS url,
        'Script (URL Step)'                                 AS source_type,
        ddr.Step_Text                                       AS calc_text
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID AND ddr.File_Name = s.File_Name
    WHERE s.Step_ID IN (111, 160)   -- Open URL / Insert from URL (Step_ID: locale-unabhängig)
      AND ddr.Step_Text LIKE '%http%'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),

-- 2) Import Records — alle, unabhängig von URL. Als Schnittstellen-Indikator
--    behandeln, weil die Quelle häufig via Variable aufgebaut wird ($Pfad).
--    Die url-Spalte zeigt den Source-Pfad aus dem DDR-Step-Text (file:…,
--    $Variable, fmnet:…, http://…). Wenn keine Source-Phrase im Step_Text
--    steht (z.B. "Import Records [ ]"), bleibt url leer.
import_records_all AS (
    SELECT
        s.Script_UUID                                       AS script_uuid,
        s.Script_Name                                       AS name,
        s.File_Name                                         AS file,
        'Import Records'                                    AS context,
        s.Step_Index + 1                                        AS step_index,
        s.Step_UUID                                         AS step_uuid,
        s.Script_UUID                                       AS target_uuid,
        'Script'                                            AS target_type,
        NULL                                                AS layout_filter_types,
        COALESCE(
            -- typografische Anführungszeichen (U+201C / U+201D) im DDR-Klartext
            regexp_extract(ddr.Step_Text, 'Source:[^"“„]*[“„]([^"”"]+)["”"]', 1),
            ''
        )                                                   AS url,
        'Script (Import)'                                   AS source_type,
        ddr.Step_Text                                       AS calc_text
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID AND ddr.File_Name = s.File_Name
    WHERE s.Step_ID = 35            -- Import Records
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),

-- 3) Script-Step-Calculations (Set Variable, Set Field, If, Show Custom Dialog, …)
script_calc_steps AS (
    SELECT
        s.Script_UUID                                              AS script_uuid,
        s.Script_Name                                              AS name,
        s.File_Name                                                AS file,
        s.Step_Name                                                AS context,
        s.Step_Index + 1                                               AS step_index,
        s.Step_UUID                                                AS step_uuid,
        s.Script_UUID                                              AS target_uuid,
        'Script'                                                   AS target_type,
        NULL                                                       AS layout_filter_types,
        regexp_extract(s.Calculation_Text, 'https?://[^ "<'']+')   AS url,
        'Script (Calc Step)'                                       AS source_type,
        s.Calculation_Text                                         AS calc_text
    FROM StepsForScripts s
    WHERE s.Calculation_Text LIKE '%http%'
      AND s.Step_ID NOT IN (111, 160, 35)   -- nicht Open URL / Insert from URL / Import Records
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),

-- 3) Custom Function Bodies — via DDR_Hash auf DDR_Calculations.Chunk_Content
custom_function_calcs AS (
    SELECT DISTINCT
        NULL                                                       AS script_uuid,
        cf.CF_Name                                                 AS name,
        cf.File_Name                                               AS file,
        'Custom Function'                                          AS context,
        NULL                                                       AS step_index,
        NULL                                                       AS step_uuid,
        cf.CF_UUID                                                 AS target_uuid,
        'CustomFunction'                                           AS target_type,
        NULL                                                       AS layout_filter_types,
        regexp_extract(c.Chunk_Content, 'https?://[^ "<'']+')      AS url,
        'Custom Function'                                          AS source_type,
        c.Chunk_Content                                            AS calc_text
    FROM CustomFunctionsCatalog cf
    JOIN DDR_Calculations c
      ON c.Calc_Hash = cf.DDR_Hash
     AND c.Chunk_Content LIKE '%http%'
    WHERE (getvariable('file') IS NULL OR cf.File_Name = getvariable('file'))
),

-- 4) Calculated Fields + AutoEnter-Calc Fields
field_calcs AS (
    SELECT
        NULL                                                                     AS script_uuid,
        f.Table_Name || '::' || f.Field_Name                                     AS name,
        f.File_Name                                                              AS file,
        CASE WHEN f.Field_Type = 'Calculated' THEN 'Calculated Field'
             ELSE 'AutoEnter Calc' END                                           AS context,
        NULL                                                                     AS step_index,
        NULL                                                                     AS step_uuid,
        f.Field_UUID                                                             AS target_uuid,
        'Field'                                                                  AS target_type,
        NULL                                                                     AS layout_filter_types,
        regexp_extract(COALESCE(NULLIF(f.Calculation_Text, ''), f.AE_Calc_Text),
                       'https?://[^ "<'']+')                                     AS url,
        'Field'                                                                  AS source_type,
        COALESCE(NULLIF(f.Calculation_Text, ''), f.AE_Calc_Text)                 AS calc_text
    FROM FieldsForTables f
    WHERE (f.Calculation_Text LIKE '%http%' OR f.AE_Calc_Text LIKE '%http%')
      AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
),

-- 5) LayoutObject-Calcs — explizite Text-Spalten sowie URL-Literale im Object_XML
layout_object_calcs AS (
    SELECT
        NULL                                                       AS script_uuid,
        l.L_Name || ' / ' || lo.Object_Type                        AS name,
        lo.File_Name                                               AS file,
        CASE
            WHEN lo.Hide_Calculation_Text       LIKE '%http%' THEN 'Hide Calc'
            WHEN lo.Tooltip_Calculation_Text    LIKE '%http%' THEN 'Tooltip'
            WHEN lo.Label_Calculation_Text      LIKE '%http%' THEN 'Label Calc'
            WHEN lo.ScriptTrigger_Parameter_Text LIKE '%http%' THEN 'Trigger Param'
            ELSE lo.Object_Type
        END                                                        AS context,
        NULL                                                       AS step_index,
        NULL                                                       AS step_uuid,
        l.L_UUID                                                   AS target_uuid,
        'Layout'                                                   AS target_type,
        -- Layout-Detail-View nimmt einen `types`-Filter (Komma-Liste). Bei einem
        -- Web Viewer setzen wir zusätzlich den Container-Typ, damit das umgebende
        -- Layout-Element im Filter-Ergebnis sichtbar bleibt. Andere Layout-Typen
        -- führen genau zum eigenen Typ.
        CASE
            WHEN lo.Object_Type = 'Web Viewer' THEN 'Container,Web Viewer'
            ELSE lo.Object_Type
        END                                                        AS layout_filter_types,
        regexp_extract(
            COALESCE(
                NULLIF(lo.Hide_Calculation_Text,        ''),
                NULLIF(lo.Tooltip_Calculation_Text,     ''),
                NULLIF(lo.Label_Calculation_Text,       ''),
                NULLIF(lo.ScriptTrigger_Parameter_Text, ''),
                lo.Object_XML
            ),
            'https?://[^ "<'']+'
        )                                                          AS url,
        'Layout Object'                                            AS source_type,
        COALESCE(
            NULLIF(lo.Hide_Calculation_Text,        ''),
            NULLIF(lo.Tooltip_Calculation_Text,     ''),
            NULLIF(lo.Label_Calculation_Text,       ''),
            NULLIF(lo.ScriptTrigger_Parameter_Text, ''),
            lo.Object_XML
        )                                                          AS calc_text
    FROM LayoutObjects lo
    JOIN Layouts l ON l.L_ID = lo.Layout_ID AND l.File_Name = lo.File_Name
    WHERE (lo.Hide_Calculation_Text       LIKE '%http%'
        OR lo.Tooltip_Calculation_Text    LIKE '%http%'
        OR lo.Label_Calculation_Text      LIKE '%http%'
        OR lo.ScriptTrigger_Parameter_Text LIKE '%http%'
        OR lo.Object_XML                   LIKE '%http%')
      AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
),

all_urls AS (
    SELECT * FROM script_url_steps      WHERE url <> ''
    UNION ALL
    SELECT * FROM import_records_all    -- alle Imports, auch ohne extrahierte Source
    UNION ALL
    SELECT * FROM script_calc_steps     WHERE url <> ''
    UNION ALL
    SELECT * FROM custom_function_calcs WHERE url <> ''
    UNION ALL
    SELECT * FROM field_calcs           WHERE url <> ''
    UNION ALL
    SELECT * FROM layout_object_calcs   WHERE url <> ''
),

-- Text-Ausschnitt VOR dem URL-Treffer (für die Kommentar-Erkennung, einmal
-- berechnet). bef = alles im calc_text links der ersten URL-Fundstelle.
positioned AS (
    SELECT *,
        CASE WHEN strpos(calc_text, url) > 1
             THEN substring(calc_text, 1, strpos(calc_text, url) - 1)
             ELSE '' END                                  AS bef
    FROM all_urls
),

classified AS (
    SELECT
        script_uuid, name, file, context, step_index, step_uuid,
        target_uuid, target_type, layout_filter_types, source_type, url, calc_text,
        regexp_extract(url, '^https?://([A-Za-z0-9._:-]+)', 1) AS host,
        -- Kommentar-Heuristik: liegt der URL-Treffer in einem FileMaker-Calc-Kommentar?
        --   Block: unbalanciertes /* vor der URL (mehr /* als */ links davon).
        --   Zeile: // in derselben Zeile vor der URL (URL-Schemata vorher entfernt,
        --          damit das // aus https:// nicht fälschlich zählt).
        -- URL-/Import-Steps tragen die URL im Step-Parameter (nie Kommentar) → FALSE.
        CASE
            WHEN source_type IN ('Script (URL Step)', 'Script (Import)') THEN FALSE
            ELSE (
                (length(bef) - length(replace(bef, '/*', '')))
                    > (length(bef) - length(replace(bef, '*/', '')))
                OR replace(replace(regexp_extract(bef, '[^\r\n]*$'), 'https://', ''), 'http://', '')
                     LIKE '%//%'
            )
        END                                               AS in_comment,
        -- API-Familien-Klassifikation: Platzhalter → generierter CASE des gewählten
        -- Filter-Sets (Param `api_set`, Default `generic`). Siehe api-sets/README.md.
        /*__API_SET_CLASSIFICATION__*/ AS api_family,
        CASE
            WHEN calc_text ILIKE '%CURL.%'  OR calc_text ILIKE '%MBS(%'
              OR calc_text ILIKE '%MBS (%' OR calc_text ILIKE '%Files.%'
              OR calc_text ILIKE '%Plugin.%'    THEN 'Plugin'
            WHEN source_type LIKE 'Script%'     THEN 'Script Step'
            WHEN source_type = 'Custom Function' THEN 'Custom Function'
            WHEN source_type = 'Field'          THEN 'Field'
            WHEN source_type = 'Layout Object'  THEN 'Layout Object'
            ELSE 'Other'
        END AS ref_type
    FROM positioned
)
SELECT
    t.host,
    t.api_family,
    t.usages,
    t.files,
    -- aktuellen Kommentar-Filter mitführen, damit der Host-Klick (openDashboard
    -- ersetzt den Querystring) den Zustand bewahrt — sonst fällt die Detailliste
    -- auf 'exclude' zurück und reine Kommentar-Hosts zeigen 0 Treffer.
    COALESCE(getvariable('comment'), 'exclude')          AS comment
FROM (
    SELECT
        host,
        MAX(api_family)          AS api_family,
        COUNT(*)                 AS usages,
        COUNT(DISTINCT file)     AS files
    FROM classified
    WHERE (CASE COALESCE(getvariable('comment'), 'exclude')
               WHEN 'all'  THEN TRUE
               WHEN 'only' THEN in_comment
               ELSE NOT in_comment
           END)
      AND host <> ''
      AND (getvariable('api_family')  IS NULL OR getvariable('api_family')  IN ('', 'All', 'Alle')
           OR api_family  = getvariable('api_family'))
      AND (getvariable('ref_type')    IS NULL OR getvariable('ref_type')    IN ('', 'All', 'Alle')
           OR ref_type    = getvariable('ref_type'))
      AND (getvariable('step_name')   IS NULL OR getvariable('step_name')   IN ('', 'All', 'Alle')
           OR context     = getvariable('step_name'))
      AND (getvariable('context')     IS NULL OR getvariable('context')     IN ('', 'All', 'Alle')
           OR context     = getvariable('context'))
      AND (getvariable('source_type') IS NULL OR getvariable('source_type') IN ('', 'All', 'Alle')
           OR source_type = getvariable('source_type'))
    GROUP BY host
) t
ORDER BY t.usages DESC, t.host
LIMIT CAST(COALESCE(getvariable('limit'), '200') AS INTEGER);
