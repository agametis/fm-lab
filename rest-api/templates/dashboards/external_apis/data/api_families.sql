-- @template_type: report
-- @description: Klassifizierung aller URL-Aufrufe nach API-Familie (Hostname-basiert).
-- @params: file (optional)

WITH script_urls AS (
    SELECT
        regexp_extract(ddr.Step_Text, 'https?://[^ "]+') AS url,
        s.File_Name
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID
    WHERE s.Step_Name IN ('Open URL','Insert from URL')
      AND ddr.Step_Text LIKE '%http%'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
calc_urls AS (
    SELECT
        regexp_extract(c.Chunk_Content, 'https?://[^ "<]+') AS url,
        c.File_Name
    FROM DDR_Calculations c
    WHERE c.Chunk_Content LIKE '%http%'
      AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
),
all_urls AS (
    SELECT * FROM script_urls WHERE url <> ''
    UNION ALL
    SELECT * FROM calc_urls   WHERE url <> ''
),
classified AS (
    SELECT
        url,
        File_Name,
        regexp_extract(url, '^https?://([^/?#]+)', 1) AS host,
        CASE
            WHEN url ILIKE '%amazon%'                                                              THEN 'Amazon'
            WHEN url ILIKE '%cloudflare%' OR url ILIKE '%workers.dev%' OR url ILIKE '%imagedelivery%' THEN 'Cloudflare'
            WHEN url ILIKE '%paypal%'   OR url ILIKE '%ipayment%'                                  THEN 'Payment'
            WHEN url ILIKE '%google%'   OR url ILIKE '%map24%'                                     THEN 'Google/Maps'
            WHEN url ILIKE '%deutsche-bank%' OR url ILIKE '%ecb.europa%'                           THEN 'Banking/FX'
            WHEN url ILIKE '%evatr%'   OR url ILIKE '%destatis%' OR url ILIKE '%zolltarif%'        THEN 'Behoerden'
            WHEN url ILIKE '%skandix%'                                                             THEN 'Skandix (intern)'
            WHEN regexp_matches(url, 'https?://(192\.168|127\.0|10\.)')                            THEN 'Internes LAN'
            WHEN url ILIKE '%prowlapp%'                                                            THEN 'Push/Notification'
            WHEN url ILIKE '%filemaker-magazin%' OR url ILIKE '%briandunning%'                     THEN 'FileMaker Community'
            WHEN url ILIKE '%w3.org%' OR url ILIKE '%xmlsoap%' OR url ILIKE '%tempuri%' OR url ILIKE '%wikipedia%' THEN 'Schemas/Referenz'
            WHEN url ILIKE '%tecalliance%' OR url ILIKE '%vp-autoparts%' OR url ILIKE '%bh-a.com%' OR url ILIKE '%clk.ch%' THEN 'Lieferanten'
            WHEN url ILIKE '%viz-js%' OR url ILIKE '%httpstat%'                                    THEN 'Tools/Test'
            ELSE 'Andere'
        END AS api_family
    FROM all_urls
)
SELECT
    api_family,
    COUNT(*)             AS hits,
    COUNT(DISTINCT host) AS hosts,
    COUNT(DISTINCT url)  AS urls,
    COUNT(DISTINCT File_Name) AS files
FROM classified
GROUP BY api_family
ORDER BY hits DESC;
