-- @template_type: report
-- @description: Compare scripts by total step count, real comment steps, whitespace-only comments, and the resulting density factors.
-- @params: file (optional, exact File_Name match), min_steps (optional, default 10), limit (optional, default 200)

WITH script_stats AS (
    SELECT
        s.Script_UUID,
        s.Script_Name,
        s.File_Name,
        COUNT(st.Step_UUID)                                           AS total_steps,
        -- Step_ID 89 = comment step (locale-independent; Step_Name is localized).
        COUNT(*) FILTER (WHERE st.Step_ID = 89)                       AS comment_steps,
        COUNT(*) FILTER (WHERE st.Step_ID = 89
                           AND st.Parameters_XML LIKE '%<Comment/>%') AS whitespace_steps
    FROM ScriptCatalog s
    LEFT JOIN StepsForScripts st ON st.Script_UUID = s.Script_UUID AND st.File_Name = s.File_Name
    WHERE (s.Folder_Type IS NULL OR s.Folder_Type = 'False')
      AND NOT s.Is_Separator
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
    GROUP BY ALL
)
SELECT
    Script_UUID                                                                                     AS uuid,
    Script_Name                                                                                     AS name,
    File_Name                                                                                       AS file,
    total_steps,
    comment_steps - whitespace_steps                                                                AS real_comments,
    whitespace_steps,
    ROUND((comment_steps - whitespace_steps) * 100.0
          / NULLIF(total_steps - whitespace_steps, 0), 1)                                           AS comment_pct,
    ROUND(whitespace_steps * 100.0 / NULLIF(total_steps, 0), 1)                                     AS whitespace_pct
FROM script_stats
WHERE total_steps >= CAST(COALESCE(getvariable('min_steps'), '10') AS INTEGER)
ORDER BY total_steps DESC
LIMIT CAST(COALESCE(getvariable('limit'), '200') AS INTEGER);
