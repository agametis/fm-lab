-- @template_type: report
-- @description: Klassifizierung aller URL-Aufrufe nach API-Familie mit Aufschlüsselung pro Referenztyp (Script Step, Plugin, Custom Function, Field, Layout Object). Führende "Alle"-Zeile = Gesamtsummen, klickbar als Filter-Reset.
-- @params: file (optional)

WITH
script_url_steps AS (
    SELECT
        regexp_extract(ddr.Step_Text, 'https?://[^ "]+') AS url,
        s.File_Name                                       AS file,
        ddr.Step_Text                                     AS calc_text,
        'Script (URL Step)'                               AS source_type
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID
    WHERE s.Step_Name IN ('Open URL','Insert from URL')
      AND ddr.Step_Text LIKE '%http%'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
import_records_all AS (
    -- Alle Import-Records-Steps (auch ohne http) als Schnittstellen-Indikator.
    SELECT
        COALESCE(
            regexp_extract(ddr.Step_Text, 'Source:[^"“„]*[“„]([^"”"]+)["”"]', 1),
            ''
        )                                                 AS url,
        s.File_Name                                       AS file,
        ddr.Step_Text                                     AS calc_text,
        'Script (Import)'                                 AS source_type
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID
    WHERE s.Step_Name = 'Import Records'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
script_calc_steps AS (
    SELECT
        regexp_extract(s.Calculation_Text, 'https?://[^ "<'']+') AS url,
        s.File_Name                                              AS file,
        s.Calculation_Text                                       AS calc_text,
        'Script (Calc Step)'                                     AS source_type
    FROM StepsForScripts s
    WHERE s.Calculation_Text LIKE '%http%'
      AND s.Step_Name NOT IN ('Open URL','Insert from URL','Import Records')
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
custom_function_calcs AS (
    SELECT DISTINCT
        regexp_extract(c.Chunk_Content, 'https?://[^ "<'']+') AS url,
        cf.File_Name                                          AS file,
        c.Chunk_Content                                       AS calc_text,
        'Custom Function'                                     AS source_type
    FROM CustomFunctionsCatalog cf
    JOIN DDR_Calculations c
      ON c.Calc_Hash = cf.DDR_Hash
     AND c.Chunk_Content LIKE '%http%'
    WHERE (getvariable('file') IS NULL OR cf.File_Name = getvariable('file'))
),
field_calcs AS (
    SELECT
        regexp_extract(COALESCE(NULLIF(f.Calculation_Text, ''), f.AE_Calc_Text),
                       'https?://[^ "<'']+')                       AS url,
        f.File_Name                                                AS file,
        COALESCE(NULLIF(f.Calculation_Text, ''), f.AE_Calc_Text)   AS calc_text,
        'Field'                                                    AS source_type
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
            'https?://[^ "<'']+'
        )                                                          AS url,
        lo.File_Name                                               AS file,
        COALESCE(NULLIF(lo.Hide_Calculation_Text,''), NULLIF(lo.Tooltip_Calculation_Text,''),
                 NULLIF(lo.Label_Calculation_Text,''), NULLIF(lo.ScriptTrigger_Parameter_Text,''),
                 lo.Object_XML)                                    AS calc_text,
        'Layout Object'                                            AS source_type
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
        url, file, source_type,
        regexp_extract(url, '^https?://([^/?#]+)', 1) AS host,
        -- ============================================================================
        -- API-Familien-Klassifikation (GENERISCHE VORLAGE) — siehe url_details.sql
        -- Diesen Block in beiden Dateien synchron halten.
        -- ============================================================================
        CASE
            WHEN url ILIKE '%amazonaws.com%' OR url ILIKE '%aws.amazon.com%' OR url ILIKE '%s3.%'   THEN 'AWS'
            WHEN url ILIKE '%cloudflare%' OR url ILIKE '%workers.dev%' OR url ILIKE '%imagedelivery%' THEN 'Cloudflare'
            WHEN url ILIKE '%azurewebsites%' OR url ILIKE '%azure.com%' OR url ILIKE '%azureedge%'   THEN 'Azure'
            WHEN url ILIKE '%googleapis%' OR url ILIKE '%googleusercontent%' OR url ILIKE '%cloud.google%' THEN 'GCP'
            WHEN url ILIKE '%google.%' OR url ILIKE '%goo.gl%' OR url ILIKE '%youtube%'              THEN 'Google'
            WHEN url ILIKE '%github.%' OR url ILIKE '%githubusercontent%' OR url ILIKE '%gitlab.%' OR url ILIKE '%bitbucket.%' THEN 'Source Hosting'
            WHEN url ILIKE '%paypal%' OR url ILIKE '%stripe.com%' OR url ILIKE '%squareup%' OR url ILIKE '%braintree%' OR url ILIKE '%adyen%' THEN 'Payment'
            WHEN url ILIKE '%sendgrid%' OR url ILIKE '%mailgun%' OR url ILIKE '%postmarkapp%' OR url ILIKE '%mailchimp%' OR url ILIKE '%sparkpost%' THEN 'Mail Provider'
            WHEN url ILIKE '%twilio%' OR url ILIKE '%vonage%' OR url ILIKE '%messagebird%' OR url ILIKE '%plivo%' THEN 'SMS/Voice'
            WHEN url ILIKE '%slack.com%' OR url ILIKE '%discord.com%' OR url ILIKE '%teams.microsoft%' OR url ILIKE '%zoom.us%' THEN 'Communication'
            WHEN url ILIKE '%openai.com%' OR url ILIKE '%anthropic.com%' OR url ILIKE '%cohere.%' OR url ILIKE '%huggingface%' OR url ILIKE '%mistral.%' THEN 'AI APIs'
            WHEN url ILIKE '%microsoft.com%' OR url ILIKE '%office.com%' OR url ILIKE '%office365%' OR url ILIKE '%sharepoint%' THEN 'Microsoft 365'
            WHEN url ILIKE '%w3.org%' OR url ILIKE '%xmlsoap%' OR url ILIKE '%tempuri%' OR url ILIKE '%schema.org%' OR url ILIKE '%json-schema%' THEN 'Schemas/Referenz'
            WHEN regexp_matches(url, 'https?://(192\.168|127\.0|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)')  THEN 'Internes LAN'
            WHEN url ILIKE '%localhost%' OR url ILIKE '%0.0.0.0%'                                     THEN 'Localhost'
            WHEN source_type = 'Script (Import)'                                                      THEN 'Lokaler Import'
            ELSE 'Andere'
        END AS api_family,
        CASE
            WHEN calc_text ILIKE '%CURL.%'  OR calc_text ILIKE '%MBS(%'
              OR calc_text ILIKE '%MBS (%' OR calc_text ILIKE '%Files.%'
              OR calc_text ILIKE '%Plugin.%'    THEN 'Plugin'
            WHEN source_type LIKE 'Script%'     THEN 'Script Step'
            WHEN source_type = 'Custom Function' THEN 'Custom Function'
            WHEN source_type = 'Field'          THEN 'Field'
            WHEN source_type = 'Layout Object'  THEN 'Layout Object'
            ELSE 'Andere'
        END AS ref_type
    FROM all_urls
),
-- Eine Zeile pro Familie mit Pivot-Counts pro ref_type
per_family AS (
    SELECT
        api_family,
        COUNT(*)                                                                    AS hits,
        COUNT(DISTINCT host) FILTER (WHERE host <> '')                              AS hosts,
        COUNT(DISTINCT url)  FILTER (WHERE url  <> '')                              AS urls,
        COUNT(DISTINCT file)                                                        AS files,
        COUNT(*) FILTER (WHERE ref_type = 'Script Step')                            AS script_step,
        COUNT(*) FILTER (WHERE ref_type = 'Plugin')                                 AS plugin,
        COUNT(*) FILTER (WHERE ref_type = 'Layout Object')                          AS layout_object,
        COUNT(*) FILTER (WHERE ref_type = 'Field')                                  AS field,
        COUNT(*) FILTER (WHERE ref_type = 'Custom Function')                        AS custom_function
    FROM classified
    GROUP BY api_family
),
all_row AS (
    -- Direkt aus classified aggregieren (nicht aus per_family),
    -- damit COUNT(DISTINCT …) korrekt ist statt SUM über Familien-Buckets.
    SELECT
        'Alle' AS api_family,
        COUNT(*)                                                     AS hits,
        COUNT(DISTINCT host) FILTER (WHERE host <> '')               AS hosts,
        COUNT(DISTINCT url)  FILTER (WHERE url  <> '')               AS urls,
        COUNT(DISTINCT file)                                         AS files,
        COUNT(*) FILTER (WHERE ref_type = 'Script Step')             AS script_step,
        COUNT(*) FILTER (WHERE ref_type = 'Plugin')                  AS plugin,
        COUNT(*) FILTER (WHERE ref_type = 'Layout Object')           AS layout_object,
        COUNT(*) FILTER (WHERE ref_type = 'Field')                   AS field,
        COUNT(*) FILTER (WHERE ref_type = 'Custom Function')         AS custom_function
    FROM classified
)
-- "Alle" zuerst (sort_order=0), dann nach hits absteigend
SELECT api_family, hits, hosts, urls, files, script_step, plugin, layout_object, field, custom_function
FROM (
    SELECT 0 AS sort_order, * FROM all_row
    UNION ALL
    SELECT 1 AS sort_order, * FROM per_family
) t
ORDER BY sort_order, hits DESC;
