-- @template_type: report
-- @description: Execute-SQL-Steps (Step_ID 117, locale-unabhängig — heißt im Korpus u.a. „SQL ausführen") — externe SQL-Ausführung gegen ODBC/ESS-Quellen. Klick öffnet das Script am Step.
-- @params: file (optional), limit (optional, default 200)

SELECT
    s.File_Name                                         AS file,
    s.Script_Name                                       AS carrier,
    s.Step_Name                                         AS detail,
    s.Step_Index                                        AS step_index,
    left(COALESCE(NULLIF(s.Calculation_Text, ''), ''), 160) AS sql_preview,
    s.Script_UUID                                       AS nav_uuid,
    s.Step_UUID                                         AS step_uuid
FROM StepsForScripts s
WHERE s.Step_ID = 117
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
ORDER BY s.File_Name, s.Script_Name, s.Step_Index
LIMIT CAST(COALESCE(getvariable('limit'), '200') AS INTEGER);
