-- Callsite detail (second level below findings): WHO calls the server-bound
-- target from WHERE. Same structured core as data/findings.sql (schema 1.20.0:
-- XMLStepReferences + on_server edge + CalculationsCatalog, no Step_XML regex) —
-- keep the CTEs and the file/S-Block filters in sync. The scope filter applies
-- to the TARGET script (the platform-bound object), never to the caller: the
-- solution-wide callsite scan is what proves an in-scope script server-bound.
-- Empty (unconfigured) callsites are skipped like in the findings; by-name
-- callsites appear with their runtime expression.
WITH callsites AS (
    SELECT x.File_Name AS file_name, x.Script_UUID AS caller_uuid,
           s.Script_Name AS caller_name, s.Step_Index + 1 AS step_no,
           s.Step_UUID AS step_uuid,
           x.Ref_UUID AS target_uuid, x.Ref_Name AS target_name,
           x.Data_Source_Name AS data_source_name
    FROM XMLStepReferences x
    JOIN StepsForScripts s
      ON s.Step_UUID = x.Step_UUID AND s.Script_UUID = x.Script_UUID
     AND s.File_Name = x.File_Name
    WHERE x.Ref_Type = 'script' AND s.Step_ID IN (164, 210) AND s.Is_Enabled
),
resolved AS (
    SELECT cs.*,
           tgt.Object_UUID AS resolved_uuid, tgt.Object_Name AS resolved_name,
           tgt.File_Name AS resolved_file
    FROM callsites cs
    LEFT JOIN (SELECT DISTINCT Source_UUID, Source_File, Target_UUID, Target_File
               FROM ObjectLinks
               WHERE Link_Role = 'calls_script'
                 AND Link_Subrole IN ('on_server', 'on_server_callback')) e
      ON e.Source_UUID = cs.caller_uuid AND e.Source_File = cs.file_name
     AND e.Target_UUID = cs.target_uuid
    LEFT JOIN ObjectCatalog tgt
      ON tgt.Object_UUID = e.Target_UUID AND tgt.File_Name = e.Target_File
     AND tgt.Object_Type = 'Script'
),
rows_all AS (
    SELECT file_name, caller_name, caller_uuid, step_no, step_uuid,
           CASE WHEN resolved_uuid IS NOT NULL THEN resolved_name
                ELSE COALESCE(target_name, '(unknown script)')
                       || COALESCE(' @ ' || data_source_name, '') END AS target_name,
           resolved_uuid AS target_uuid,
           CASE WHEN resolved_uuid IS NOT NULL THEN 'resolved'
                ELSE 'external' END AS target_kind
    FROM resolved
    UNION ALL
    SELECT c.File_Name, s.Script_Name, s.Script_UUID,
           s.Step_Index + 1, c.Owner_UUID,
           'By name: ' || COALESCE(trim(COALESCE(c.Formula_Text, c.Display_Text)), '(calculated name)'),
           CAST(NULL AS VARCHAR), 'dynamic'
    FROM CalculationsCatalog c
    JOIN StepsForScripts s ON s.Step_UUID = c.Owner_UUID AND s.File_Name = c.File_Name
    WHERE s.Step_ID IN (164, 210) AND s.Is_Enabled AND c.Source_Path = 'Step/List'
)
SELECT file_name, caller_name, caller_uuid, step_no, step_uuid,
    target_name, target_uuid, target_kind,
    row_number() OVER (ORDER BY file_name, target_name, caller_name, step_no) AS row_key
FROM rows_all
WHERE (getvariable('file') IS NULL OR file_name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR target_uuid IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY file_name, target_name, caller_name, step_no
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
