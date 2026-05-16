-- @template_type: report
-- @description: Scripts mit den meisten Schritten.
-- @params: limit (optional, default 10), file (optional)

WITH scored AS (
    SELECT
        s.Script_UUID            AS uuid,
        s.Script_Name            AS name,
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
SELECT uuid, name, file, step_count
FROM scored
WHERE step_count > 0
ORDER BY step_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '10') AS INTEGER);
