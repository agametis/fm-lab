-- Platform-compatibility check against the Claris tri-state table.
-- Source: reference/fm_spec.duckdb -> step_compat, ATTACHed as 'ref' by the API
-- connection (config/database.js); the fm-test direct path attaches it itself.
-- Severity model: false = 'No' -> error; NULL = 'Partial' -> warning (NEVER
-- 'undocumented'); missing row (6x dataapi/cwp) = no statement -> info.
SELECT 'platform-cloud' AS rule_id,
    CASE WHEN c.step_id IS NULL THEN 'info'
         WHEN c.cloud = false THEN 'error'
         ELSE 'warning' END AS severity,
    s.File_Name AS file_name, s.Script_UUID AS nav_uuid, s.Script_Name AS script_name,
    s.Step_Index + 1 AS step_no, s.Step_UUID AS step_uuid,
    COALESCE(st.canonical_name, 'Step ' || s.Step_ID) AS step_name,
    st.url_slug AS doc_slug,
    CASE WHEN c.step_id IS NULL
         THEN COALESCE(st.canonical_name, 'Step ' || s.Step_ID) || ' has no published compatibility row for FileMaker Cloud (genuine gap in the Claris table)'
         WHEN c.cloud = false
         THEN COALESCE(st.canonical_name, 'Step ' || s.Step_ID) || ' does not run on FileMaker Cloud'
         ELSE COALESCE(st.canonical_name, 'Step ' || s.Step_ID) || ' is PARTIALLY supported on FileMaker Cloud - conditionally supported, see the step notes on its Claris help page'
    END AS message,
    row_number() OVER (ORDER BY s.File_Name, s.Script_Name, s.Step_Index) AS row_key
FROM StepsForScripts s
LEFT JOIN ref.script_steps st ON st.step_id = s.Step_ID
LEFT JOIN ref.step_compat c ON c.step_id = s.Step_ID
WHERE s.Is_Enabled
  AND s.Step_ID <> 89  -- "# (comment)"
  AND (c.step_id IS NULL OR c.cloud = false OR c.cloud IS NULL)
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR s.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, file_name, script_name, step_no
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
