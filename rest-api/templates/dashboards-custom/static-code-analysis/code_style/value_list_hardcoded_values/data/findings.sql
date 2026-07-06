-- Custom_Values is a VARCHAR[] holding one newline-separated blob; split it back
-- into individual values, drop empties, and preview the first five (with an
-- ellipsis when more follow).
WITH vl AS (
    SELECT DISTINCT File_Name, VL_Name, VL_UUID, Custom_Values
    FROM OptionsForValueLists WHERE Source_Type = 'Custom'
),
prepared AS (
    SELECT File_Name, VL_Name, VL_UUID,
        list_filter(string_split(array_to_string(Custom_Values, chr(10)), chr(10)), lambda x: trim(x) <> '') AS vals
    FROM vl
)
SELECT 'value-list-hardcoded-values' AS rule_id, 'info' AS severity,
    File_Name AS file_name, VL_UUID AS nav_uuid, VL_Name AS vl_name,
    array_to_string(list_slice(vals, 1, 5), ', ') || CASE WHEN len(vals) > 5 THEN ', …' ELSE '' END AS values_preview,
    'Value list uses hard-coded custom values' AS message,
    row_number() OVER (ORDER BY File_Name, VL_Name) AS row_key
FROM prepared
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
ORDER BY File_Name, VL_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
