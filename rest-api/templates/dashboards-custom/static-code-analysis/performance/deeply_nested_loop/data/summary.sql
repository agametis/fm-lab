-- Auto-generiert aus dem core der Rule (deeply_nested_loop). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'warning'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT
    'deeply-nested-loop' AS rule_id, 'warning' AS severity,
    File_Name AS file_name, any_value(Script_UUID) AS nav_uuid, any_value(Script_Name) AS script_name,
    MAX(loop_depth_before) AS max_loop_depth,
    'Max loop nesting depth ' || MAX(loop_depth_before) AS message,
    row_number() OVER (ORDER BY MAX(loop_depth_before) DESC) AS row_key
FROM v_script_block_tree
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
GROUP BY File_Name, Script_ID
HAVING MAX(loop_depth_before) >= 3
ORDER BY max_loop_depth DESC
) _summary;
