-- @template_type: report
-- @description: Prozess-/Shell-Ausführung — je Zeile ein Grenzübertritt in einen externen Prozess: Send Event, Perform AppleScript (Step_ID-gated) oder ein MBS Shell/RunTask/Process-Aufruf. Klick auf eine Zeile öffnet den Träger am konkreten Step.
-- @params: file (optional), mechanism (optional), limit (optional, default 400)
--
-- Die MBS-Seite liest aus PluginFunctionUsages (step-granular: Source_Subkey =
-- Step_Index bei Source_Type='Script') statt aus den Script→PluginFunction-Links,
-- damit der Step-Anchor (step_uuid) und die Script-Zeile (#) verfügbar sind.

WITH native AS (
    SELECT
        s.File_Name                                     AS file,
        CASE WHEN s.Step_ID = 57 THEN 'Send Event' ELSE 'AppleScript' END AS mechanism,
        'Native Step'                                   AS ref_type,
        s.Script_Name                                   AS carrier,
        s.Step_Name                                     AS detail,
        s.Step_Index                                    AS step_index,
        s.Script_UUID                                   AS nav_uuid,
        'Script'                                        AS nav_type,
        s.Step_UUID                                     AS step_uuid
    FROM StepsForScripts s
    WHERE s.Step_ID IN (57, 67)
),
mbs AS (
    SELECT
        p.File_Name                                     AS file,
        'MBS ' || regexp_extract(p.Plugin_Function_Name, '(?i)MBS:([A-Za-z]+)\.', 1) AS mechanism,
        'MBS ' || p.Source_Type                         AS ref_type,
        COALESCE(s.Script_Name, oc.Object_Name)         AS carrier,
        regexp_extract(p.Plugin_Function_Name, '(?i)MBS:(.+)$', 1) AS detail,
        s.Step_Index                                    AS step_index,
        p.Source_UUID                                   AS nav_uuid,
        p.Source_Type                                   AS nav_type,
        s.Step_UUID                                     AS step_uuid
    FROM PluginFunctionUsages p
    LEFT JOIN StepsForScripts s
      ON p.Source_Type = 'Script'
     AND s.Script_UUID = p.Source_UUID
     AND s.File_Name = p.File_Name
     AND s.Step_Index = TRY_CAST(p.Source_Subkey AS INTEGER)
    LEFT JOIN ObjectCatalog oc ON oc.Object_UUID = p.Source_UUID
    WHERE regexp_matches(p.Plugin_Function_Name, '(?i)MBS:(Shell|RunTask|Process)\.')
),
all_hits AS (
    SELECT * FROM native
    UNION ALL
    SELECT * FROM mbs
)
SELECT *
FROM all_hits
WHERE (getvariable('file') IS NULL OR file = getvariable('file'))
  AND (getvariable('mechanism') IS NULL OR getvariable('mechanism') IN ('', 'All', 'Alle')
       OR mechanism = getvariable('mechanism'))
ORDER BY mechanism, file, carrier, step_index
LIMIT CAST(COALESCE(getvariable('limit'), '400') AS INTEGER);
