-- Auto-generiert aus dem core der Rule (deep_if_nesting). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'warning'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'deep-if-nesting' AS rule_id, 'warning' AS severity,
    File_Name AS file_name, any_value(Script_UUID) AS nav_uuid, any_value(Script_Name) AS script_name,
    MAX(if_depth_before) AS max_if_depth,
    'Max If nesting depth ' || MAX(if_depth_before) AS message,
    row_number() OVER (ORDER BY File_Name, any_value(Script_Name)) AS row_key
FROM v_script_block_tree
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
GROUP BY File_Name, Script_ID
HAVING MAX(if_depth_before) >= 5
ORDER BY file_name, script_name
) _summary;
