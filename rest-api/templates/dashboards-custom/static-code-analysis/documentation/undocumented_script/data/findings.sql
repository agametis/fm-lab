-- The comment filter (getvariable('comment'), default 'without') toggles between
-- substantial scripts (>= 10 steps) WITHOUT any real comment and those WITH one —
-- the documented scripts are useful as commenting inspiration.
--
-- A Comment step (Step_ID 89) only counts as documentation when it carries text:
-- FileMaker stores that either as an attribute (`<Comment value="…"/>`) or as
-- element text (`<Comment>…</Comment>`). Empty spacer comments (`<Comment/>`,
-- blank `#` lines) do NOT count — otherwise a script padded with blank comment
-- lines was wrongly flagged as documented (and its comments-only view was blank).
WITH s AS (
    SELECT File_Name, Script_ID,
        any_value(Script_UUID) AS uuid, any_value(Script_Name) AS name,
        COUNT(*) AS step_count,
        COUNT(*) FILTER (WHERE Step_ID = 89
            AND (Step_XML LIKE '%<Comment value="%' OR Step_XML LIKE '%<Comment>%')) AS comment_steps
    FROM StepsForScripts
    WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
    GROUP BY File_Name, Script_ID
    HAVING COUNT(*) >= 10
)
SELECT 'undocumented-script' AS rule_id, 'info' AS severity,
    File_Name AS file_name, uuid AS nav_uuid, name AS script_name,
    step_count,
    -- Documented scripts open with the ScriptViewer's comments-only view
    -- (comment lines highlighted). Undocumented rows leave nav_mode NULL, so
    -- the openObject action drops the mode param and opens normally.
    CASE WHEN comment_steps > 0 THEN 'comments-only' END AS nav_mode,
    step_count || ' steps, ' || comment_steps || ' comments' AS message,
    row_number() OVER (ORDER BY step_count DESC) AS row_key
FROM s
WHERE (comment_steps > 0) = (COALESCE(getvariable('comment'), 'without') = 'with')
ORDER BY step_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
