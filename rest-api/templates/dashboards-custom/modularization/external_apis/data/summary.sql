-- @template_type: report
-- @description: KPI-Übersicht — Counts entsprechen exakt den Filter-Ergebnissen in der URL-Detailliste, damit ein KPI-Klick eine konsistente Resultatmenge öffnet.
-- @params: file (optional)

WITH
script_url_steps AS (
    SELECT
        regexp_extract(ddr.Step_Text, 'https?://[^ "]+') AS url,
        -- context locale-unabhängig aus Step_ID herleiten: die KPIs unten filtern
        -- FILTER (WHERE context = 'Open URL'/'Insert from URL') gegen englische Literale.
        CASE s.Step_ID WHEN 111 THEN 'Open URL' WHEN 160 THEN 'Insert from URL' END AS context,
        ddr.Step_Text                                     AS calc_text,
        'Script (URL Step)'                               AS source_type
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID
    WHERE s.Step_ID IN (111, 160)   -- Open URL / Insert from URL (Step_ID: locale-unabhängig)
      AND ddr.Step_Text LIKE '%http%'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
import_records_all AS (
    -- Alle Import-Records-Steps (auch ohne http) — Schnittstellen-Indikator,
    -- weil Quelle häufig per Variable gesetzt wird.
    SELECT
        COALESCE(
            regexp_extract(ddr.Step_Text, 'Source:[^"“„]*[“„]([^"”"]+)["”"]', 1),
            ''
        )                                                 AS url,
        'Import Records'                                  AS context,
        ddr.Step_Text                                     AS calc_text,
        'Script (Import)'                                 AS source_type
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID
    WHERE s.Step_ID = 35            -- Import Records
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
script_calc_steps AS (
    SELECT
        regexp_extract(s.Calculation_Text, 'https?://[^ "<'']+') AS url,
        s.Step_Name                                              AS context,
        s.Calculation_Text                                       AS calc_text,
        'Script (Calc Step)'                                     AS source_type
    FROM StepsForScripts s
    WHERE s.Calculation_Text LIKE '%http%'
      AND s.Step_ID NOT IN (111, 160, 35)   -- nicht Open URL / Insert from URL / Import Records
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
custom_function_calcs AS (
    SELECT DISTINCT
        regexp_extract(c.Chunk_Content, 'https?://[^ "<'']+') AS url,
        'Custom Function'                                     AS context,
        c.Chunk_Content                                       AS calc_text,
        'Custom Function'                                     AS source_type
    FROM CustomFunctionsCatalog cf
    JOIN DDR_Calculations c
      ON c.Calc_Hash = cf.DDR_Hash AND c.Chunk_Content LIKE '%http%'
    WHERE (getvariable('file') IS NULL OR cf.File_Name = getvariable('file'))
),
field_calcs AS (
    SELECT
        regexp_extract(COALESCE(NULLIF(f.Calculation_Text, ''), f.AE_Calc_Text),
                       'https?://[^ "<'']+')                      AS url,
        'Field'                                                   AS context,
        COALESCE(NULLIF(f.Calculation_Text, ''), f.AE_Calc_Text)  AS calc_text,
        'Field'                                                   AS source_type
    FROM FieldsForTables f
    WHERE (f.Calculation_Text LIKE '%http%' OR f.AE_Calc_Text LIKE '%http%')
      AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
),
layout_object_calcs AS (
    SELECT
        regexp_extract(
            COALESCE(NULLIF(lo.Hide_Calculation_Text,''), NULLIF(lo.Tooltip_Calculation_Text,''),
                     NULLIF(lo.Label_Calculation_Text,''), NULLIF(lo.ScriptTrigger_Parameter_Text,''),
                     lo.Object_XML),
            'https?://[^ "<'']+')                                 AS url,
        lo.Object_Type                                            AS context,
        COALESCE(NULLIF(lo.Hide_Calculation_Text,''), NULLIF(lo.Tooltip_Calculation_Text,''),
                 NULLIF(lo.Label_Calculation_Text,''), NULLIF(lo.ScriptTrigger_Parameter_Text,''),
                 lo.Object_XML)                                   AS calc_text,
        'Layout Object'                                           AS source_type
    FROM LayoutObjects lo
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
    SELECT * FROM import_records_all    -- alle Imports, auch ohne Source-Extraction
    UNION ALL
    SELECT * FROM script_calc_steps     WHERE url <> ''
    UNION ALL
    SELECT * FROM custom_function_calcs WHERE url <> ''
    UNION ALL
    SELECT * FROM field_calcs           WHERE url <> ''
    UNION ALL
    SELECT * FROM layout_object_calcs   WHERE url <> ''
),
classified AS (
    SELECT
        url, context, source_type,
        CASE
            WHEN calc_text ILIKE '%CURL.%'  OR calc_text ILIKE '%MBS(%'
              OR calc_text ILIKE '%MBS (%' OR calc_text ILIKE '%Files.%'
              OR calc_text ILIKE '%Plugin.%' THEN 'Plugin'
            WHEN source_type LIKE 'Script%' THEN 'Script Step'
            WHEN source_type = 'Custom Function' THEN 'Custom Function'
            WHEN source_type = 'Field' THEN 'Field'
            WHEN source_type = 'Layout Object' THEN 'Layout Object'
            ELSE 'Other'
        END AS ref_type
    FROM all_urls
)
SELECT
    COUNT(*) FILTER (WHERE context = 'Open URL')                          AS open_url_steps,
    COUNT(*) FILTER (WHERE context = 'Insert from URL')                   AS insert_url_steps,
    COUNT(*) FILTER (WHERE context = 'Import Records')                    AS import_records_steps,
    COUNT(*) FILTER (WHERE ref_type = 'Plugin')                           AS mbs_plugin_hits,
    COUNT(*) FILTER (WHERE context = 'Web Viewer')                        AS web_viewer_hits,
    COUNT(*) FILTER (WHERE source_type = 'Script (Calc Step)')            AS calc_step_hits,
    COUNT(DISTINCT url) FILTER (WHERE url <> '')                          AS distinct_urls
FROM classified;
