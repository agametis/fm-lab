-- @template_type: report
-- @description: Detailliste aller URL-Aufrufe — pro Zeile ein konkretes Klick-Ziel (Script-Step, Custom Function, Field, Layout-Object) und ein ref_type für die Familien-Aggregation. Inkl. Secret-Maskierung und Web-Viewer-Filter-Hint für Layout-Ziele.
-- @params: file (optional), api_family (optional), ref_type (optional), step_name (optional), context (optional), source_type (optional), limit (optional, default 200)

WITH
-- 1) Open URL / Insert from URL — Script-Step direkt mit URL (http-Filter)
script_url_steps AS (
    SELECT
        s.Script_UUID                                       AS script_uuid,
        s.Script_Name                                       AS name,
        s.File_Name                                         AS file,
        s.Step_Name                                         AS context,
        s.Step_Index                                        AS step_index,
        s.Step_UUID                                         AS step_uuid,
        s.Script_UUID                                       AS target_uuid,
        'Script'                                            AS target_type,
        NULL                                                AS layout_filter_types,
        regexp_extract(ddr.Step_Text, 'https?://[^ "]+')    AS url,
        'Script (URL Step)'                                 AS source_type,
        ddr.Step_Text                                       AS calc_text
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID
    WHERE s.Step_Name IN ('Open URL','Insert from URL')
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
        s.Step_Index                                        AS step_index,
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
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID
    WHERE s.Step_Name = 'Import Records'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),

-- 3) Script-Step-Calculations (Set Variable, Set Field, If, Show Custom Dialog, …)
script_calc_steps AS (
    SELECT
        s.Script_UUID                                              AS script_uuid,
        s.Script_Name                                              AS name,
        s.File_Name                                                AS file,
        s.Step_Name                                                AS context,
        s.Step_Index                                               AS step_index,
        s.Step_UUID                                                AS step_uuid,
        s.Script_UUID                                              AS target_uuid,
        'Script'                                                   AS target_type,
        NULL                                                       AS layout_filter_types,
        regexp_extract(s.Calculation_Text, 'https?://[^ "<'']+')   AS url,
        'Script (Calc Step)'                                       AS source_type,
        s.Calculation_Text                                         AS calc_text
    FROM StepsForScripts s
    WHERE s.Calculation_Text LIKE '%http%'
      AND s.Step_Name NOT IN ('Open URL','Insert from URL','Import Records')
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

classified AS (
    SELECT
        script_uuid, name, file, context, step_index, step_uuid,
        target_uuid, target_type, layout_filter_types, source_type, url, calc_text,
        regexp_extract(url, '^https?://([^/?#]+)', 1) AS host,
        -- ============================================================================
        -- API-Familien-Klassifikation (GENERISCHE VORLAGE)
        --
        -- Diese WHEN-Zweige sind eine breit gefasste Default-Liste für typische
        -- Cloud-/SaaS-/Communication-/AI-Anbieter. Sie sind NICHT projekt-spezifisch
        -- und sollen als Startpunkt für eigene Klassifikationen dienen.
        --
        -- Eigene Familien hinzufügen: WHEN-Zweige ergänzen (siehe README im Bundle).
        -- Wichtig: diesen Block in BEIDEN Dateien synchron halten:
        --   - data/url_details.sql   (Detail-Liste)
        --   - data/api_families.sql  (Aggregat-Tabelle)
        -- summary.sql nutzt nur ref_type/context/source_type — kein api_family.
        -- ============================================================================
        CASE
            -- Cloud-Plattformen
            WHEN url ILIKE '%amazonaws.com%' OR url ILIKE '%aws.amazon.com%' OR url ILIKE '%s3.%'   THEN 'AWS'
            WHEN url ILIKE '%cloudflare%' OR url ILIKE '%workers.dev%' OR url ILIKE '%imagedelivery%' THEN 'Cloudflare'
            WHEN url ILIKE '%azurewebsites%' OR url ILIKE '%azure.com%' OR url ILIKE '%azureedge%'   THEN 'Azure'
            WHEN url ILIKE '%googleapis%' OR url ILIKE '%googleusercontent%' OR url ILIKE '%cloud.google%' THEN 'GCP'
            -- Google-Endkundendienste (Maps, Sheets, Drive, …)
            WHEN url ILIKE '%google.%' OR url ILIKE '%goo.gl%' OR url ILIKE '%youtube%'              THEN 'Google'
            -- Source Hosting / DevOps
            WHEN url ILIKE '%github.%' OR url ILIKE '%githubusercontent%' OR url ILIKE '%gitlab.%' OR url ILIKE '%bitbucket.%' THEN 'Source Hosting'
            -- Payment-Anbieter
            WHEN url ILIKE '%paypal%' OR url ILIKE '%stripe.com%' OR url ILIKE '%squareup%' OR url ILIKE '%braintree%' OR url ILIKE '%adyen%' THEN 'Payment'
            -- Mail-Provider
            WHEN url ILIKE '%sendgrid%' OR url ILIKE '%mailgun%' OR url ILIKE '%postmarkapp%' OR url ILIKE '%mailchimp%' OR url ILIKE '%sparkpost%' THEN 'Mail Provider'
            -- SMS/Voice
            WHEN url ILIKE '%twilio%' OR url ILIKE '%vonage%' OR url ILIKE '%messagebird%' OR url ILIKE '%plivo%' THEN 'SMS/Voice'
            -- Team-Communication
            WHEN url ILIKE '%slack.com%' OR url ILIKE '%discord.com%' OR url ILIKE '%teams.microsoft%' OR url ILIKE '%zoom.us%' THEN 'Communication'
            -- AI-APIs
            WHEN url ILIKE '%openai.com%' OR url ILIKE '%anthropic.com%' OR url ILIKE '%cohere.%' OR url ILIKE '%huggingface%' OR url ILIKE '%mistral.%' THEN 'AI APIs'
            -- Microsoft 365 / Office
            WHEN url ILIKE '%microsoft.com%' OR url ILIKE '%office.com%' OR url ILIKE '%office365%' OR url ILIKE '%sharepoint%' THEN 'Microsoft 365'
            -- Schemas/Referenz (XML/JSON-Schema, Standards)
            WHEN url ILIKE '%w3.org%' OR url ILIKE '%xmlsoap%' OR url ILIKE '%tempuri%' OR url ILIKE '%schema.org%' OR url ILIKE '%json-schema%' THEN 'Schemas/Referenz'
            -- Lokale Netze (RFC 1918) und Localhost
            WHEN regexp_matches(url, 'https?://(192\.168|127\.0|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)')  THEN 'Internes LAN'
            WHEN url ILIKE '%localhost%' OR url ILIKE '%0.0.0.0%'                                     THEN 'Localhost'
            -- Fallback für Import Records-Treffer, die keine http-URL liefern
            -- (file:…, $Variable, fmnet:…, leere Source).
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
)
SELECT
    api_family,
    ref_type,
    host,
    source_type,
    name,
    file,
    context,
    step_index,
    regexp_replace(
        url,
        '(api[_-]?key|access[_-]?token|token|password|passwd|secret|auth|sig|signature)=([^&#"\s]+)',
        '\1=[masked]',
        'gi'
    )                                                    AS url,
    target_uuid,
    target_type,
    layout_filter_types,
    script_uuid,
    step_uuid
FROM classified
WHERE (getvariable('api_family')  IS NULL OR getvariable('api_family')  IN ('', 'Alle')
       OR api_family  = getvariable('api_family'))
  AND (getvariable('ref_type')    IS NULL OR getvariable('ref_type')    IN ('', 'Alle')
       OR ref_type    = getvariable('ref_type'))
  AND (getvariable('step_name')   IS NULL OR getvariable('step_name')   IN ('', 'Alle')
       OR context     = getvariable('step_name'))
  AND (getvariable('context')     IS NULL OR getvariable('context')     IN ('', 'Alle')
       OR context     = getvariable('context'))
  AND (getvariable('source_type') IS NULL OR getvariable('source_type') IN ('', 'Alle')
       OR source_type = getvariable('source_type'))
ORDER BY api_family, ref_type, host, file, name, step_index
LIMIT CAST(COALESCE(getvariable('limit'), '200') AS INTEGER);
