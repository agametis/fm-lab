-- @template_type: object
-- @title: Scripts without callers
-- @description: Scripts that are not invoked by any other script or trigger.
-- @icon: script
-- @category: Scripts
-- @display: list
-- @params: file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}
-- @output_format: uuid, name, file, step_count
-- @author: Marcel
-- @version: 1.0
-- @tags: scripts, analysis, unused

WITH script_callers AS (
    SELECT DISTINCT Target_UUID
    FROM ObjectLinks
    WHERE Link_Role IN ('calls_script', 'trigger_script', 'triggers_script')
)
SELECT
    oc.Object_UUID                       AS uuid,
    oc.Object_Name                       AS name,
    'Script'                             AS type,
    oc.File_Name                         AS file,
    (SELECT COUNT(*)
        FROM StepsForScripts s
        WHERE s.Script_UUID = oc.Object_UUID) AS step_count
FROM ObjectCatalog oc
JOIN ScriptCatalog sc ON sc.Script_UUID = oc.Object_UUID
LEFT JOIN script_callers c ON c.Target_UUID = oc.Object_UUID
WHERE oc.Object_Type = 'Script'
  AND sc.Folder_Type IS NULL
  AND NOT sc.Is_Separator
  AND c.Target_UUID IS NULL
  AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
ORDER BY oc.File_Name, oc.Object_Name;
