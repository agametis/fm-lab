-- @template_type: report
-- @description: E-Mail-Versand — je Zeile ein Send-Mail-Step (Step_ID 63), klassifiziert nach Versandweg (SMTP-Server vs. E-Mail-Client) mit extrahiertem SMTP-Host und Flag für hartkodierte Zugangsdaten. Plus MBS SendMail-Aufrufe. Klick öffnet den Träger.
-- @params: file (optional), mode (optional), limit (optional, default 400)

WITH native AS (
    SELECT
        s.File_Name                                         AS file,
        CASE
            WHEN ddr.Step_Text LIKE '%Send via SMTP Server%'  THEN 'SMTP'
            WHEN ddr.Step_Text LIKE '%Send via E-mail Client%' THEN 'Client'
            ELSE 'unknown'
        END                                                 AS mode,
        'Send Mail'                                          AS mechanism,
        s.Script_Name                                        AS carrier,
        regexp_extract(COALESCE(ddr.Step_Text, ''), 'SMTP Server:\s*"([^"]+)"', 1) AS smtp_host,
        (COALESCE(ddr.Step_Text, '') LIKE '%Password:%')     AS hardcoded_auth,
        s.Step_Index + 1                                         AS step_index,
        s.Script_UUID                                        AS nav_uuid,
        'Script'                                             AS nav_type,
        s.Step_UUID                                          AS step_uuid
    FROM StepsForScripts s
    LEFT JOIN DDR_ScriptSteps ddr ON s.Step_UUID = ddr.Step_UUID AND ddr.File_Name = s.File_Name
    WHERE s.Step_ID = 63
),
mbs AS (
    -- Per-usage aus PluginFunctionUsages (step-granular: Source_Subkey =
    -- Step_Index bei Source_Type='Script') statt der deduplizierten
    -- Script→PluginFunction-Links, damit MBS-Zeilen Step-Anchor + Script-Zeile tragen.
    SELECT
        p.File_Name                                          AS file,
        'MBS'                                                AS mode,
        'MBS ' || regexp_extract(p.Plugin_Function_Name, '(?i)MBS:([A-Za-z]+\.[A-Za-z0-9]+)', 1) AS mechanism,
        COALESCE(s.Script_Name, oc.Object_Name)              AS carrier,
        CAST(NULL AS VARCHAR)                                AS smtp_host,
        FALSE                                                AS hardcoded_auth,
        s.Step_Index + 1                                         AS step_index,
        p.Source_UUID                                        AS nav_uuid,
        p.Source_Type                                        AS nav_type,
        s.Step_UUID                                          AS step_uuid
    FROM PluginFunctionUsages p
    LEFT JOIN StepsForScripts s
      ON p.Source_Type = 'Script'
     AND s.Script_UUID = p.Source_UUID
     AND s.File_Name = p.File_Name
     AND s.Step_Index = TRY_CAST(p.Source_Subkey AS INTEGER)
    LEFT JOIN ObjectCatalog oc ON oc.Object_UUID = p.Source_UUID AND oc.File_Name = p.File_Name
    WHERE regexp_matches(p.Plugin_Function_Name, '(?i)MBS:(SendMail|EmailParser)\.')
),
all_hits AS (SELECT * FROM native UNION ALL SELECT * FROM mbs)
SELECT
    *,
    COALESCE(step_uuid, nav_uuid || '-' || mechanism)    AS row_key
FROM all_hits
WHERE (getvariable('file') IS NULL OR file = getvariable('file'))
  AND (getvariable('mode') IS NULL OR getvariable('mode') IN ('', 'All', 'Alle')
       OR mode = getvariable('mode'))
ORDER BY mode, file, carrier, step_index
LIMIT CAST(COALESCE(getvariable('limit'), '400') AS INTEGER);
