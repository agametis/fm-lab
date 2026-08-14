WITH bal AS (
    SELECT File_Name, Script_ID,
        MIN(Script_UUID) AS Script_UUID, MIN(Script_Name) AS Script_Name,
        CAST(SUM(if_delta) AS INTEGER) AS net_if_balance,
        CAST(MIN(if_running_depth) AS INTEGER) AS worst_running_depth
    FROM v_script_block_tree GROUP BY File_Name, Script_ID
)
SELECT 'unbalanced-if-block' AS rule_id, 'error' AS severity,
    File_Name AS file_name, Script_UUID AS nav_uuid, Script_Name AS script_name,
    'If/End-If imbalance (' || net_if_balance || ') — structurally broken block nesting' AS message,
    row_number() OVER (ORDER BY File_Name, Script_Name) AS row_key
FROM bal
WHERE (net_if_balance <> 0 OR worst_running_depth < 0) AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY File_Name, Script_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
