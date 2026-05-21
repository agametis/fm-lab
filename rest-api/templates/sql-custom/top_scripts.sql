-- @template_type: object
-- @title: Top scripts
-- @description: Scripts with the most steps.
-- @icon: script
-- @category: Top
-- @display: table
-- @params: limit (optional, default 100), file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}&type=Script
-- @output_format: uuid, name, type, file, step_count
-- @author: fm-lab core
-- @version: 1.0
-- @tags: scripts, top, ranking

WITH scored AS (
    SELECT
        s.Script_UUID            AS uuid,
        s.Script_Name            AS name,
        'Script'                 AS type,
        s.File_Name              AS file,
        COUNT(st.Step_UUID)      AS step_count
    FROM ScriptCatalog s
    LEFT JOIN StepsForScripts st
           ON st.Script_UUID = s.Script_UUID
    WHERE (s.Folder_Type IS NULL)
      AND NOT s.Is_Separator
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
    GROUP BY ALL
)
SELECT uuid, name, type, file, step_count
FROM scored
WHERE step_count > 0
ORDER BY step_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '100') AS INTEGER);
