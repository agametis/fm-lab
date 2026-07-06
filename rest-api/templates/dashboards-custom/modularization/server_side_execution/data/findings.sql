-- @template_type: report
-- @description: Serverseitige Ausführung — Perform Script on Server, Execute FileMaker Data API und Install OnTimer Script (Step_ID-gated). Klick auf eine Zeile öffnet das Script am Step.
-- @params: file (optional), mechanism (optional), limit (optional, default 400)

SELECT
    s.File_Name                                         AS file,
    CASE s.Step_ID
        WHEN 164 THEN 'Perform Script on Server'
        WHEN 203 THEN 'Execute FileMaker Data API'
        WHEN 148 THEN 'Install OnTimer Script'
    END                                                 AS mechanism,
    s.Script_Name                                       AS carrier,
    s.Step_Name                                         AS detail,
    s.Step_Index                                        AS step_index,
    s.Script_UUID                                       AS nav_uuid,
    s.Step_UUID                                         AS step_uuid
FROM StepsForScripts s
WHERE s.Step_ID IN (164, 203, 148)
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('mechanism') IS NULL OR getvariable('mechanism') IN ('', 'All', 'Alle')
       OR CASE s.Step_ID WHEN 164 THEN 'Perform Script on Server'
                         WHEN 203 THEN 'Execute FileMaker Data API'
                         WHEN 148 THEN 'Install OnTimer Script' END = getvariable('mechanism'))
ORDER BY mechanism, s.File_Name, s.Script_Name, s.Step_Index
LIMIT CAST(COALESCE(getvariable('limit'), '400') AS INTEGER);
