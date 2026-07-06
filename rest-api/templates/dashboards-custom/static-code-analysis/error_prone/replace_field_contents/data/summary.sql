-- Auto-generiert aus dem core der Rule (replace_field_contents). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'replace-field-contents' AS rule_id, 'info' AS severity,
    File_Name AS file_name, Script_UUID AS nav_uuid, Script_Name AS script_name,
    Step_Index AS step_index, Step_UUID AS step_uuid,
    'Replace Field Contents at step ' || Step_Index || ' (whole found set, no undo)' AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name, Step_Index) AS row_key
FROM v_script_block_tree
WHERE Step_ID = 91 AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
ORDER BY File_Name, Script_Name, Step_Index
) _summary;
