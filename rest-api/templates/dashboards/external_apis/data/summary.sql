-- @template_type: report
-- @description: KPI-Übersicht zu APIs, URL-Aufrufen und externen Datenquellen.
-- @params: file (optional)

WITH all_urls AS (
    SELECT regexp_extract(ddr.Step_Text, 'https?://[^ "]+') AS url, s.File_Name
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID
    WHERE s.Step_Name IN ('Open URL','Insert from URL')
      AND ddr.Step_Text LIKE '%http%'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))

    UNION ALL

    SELECT regexp_extract(c.Chunk_Content, 'https?://[^ "<]+') AS url, c.File_Name
    FROM DDR_Calculations c
    WHERE c.Chunk_Content LIKE '%http%'
      AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
)
SELECT
    (SELECT COUNT(*) FROM StepsForScripts
       WHERE Step_Name = 'Open URL'
         AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
    )                                                              AS open_url_steps,
    (SELECT COUNT(*) FROM StepsForScripts
       WHERE Step_Name = 'Insert from URL'
         AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
    )                                                              AS insert_url_steps,
    (SELECT COUNT(*) FROM DDR_Calculations
       WHERE Chunk_Content LIKE '%CURL.%'
         AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
    )                                                              AS mbs_curl_chunks,
    (SELECT COUNT(*) FROM StepsForScripts
       WHERE Step_Name = 'Import Records'
         AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
    )                                                              AS import_records_steps,
    (SELECT COUNT(DISTINCT url) FROM all_urls WHERE url <> '')     AS distinct_urls,
    (SELECT COUNT(*) FROM ExternalDataSourceCatalog
       WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
    )                                                              AS external_sources;
