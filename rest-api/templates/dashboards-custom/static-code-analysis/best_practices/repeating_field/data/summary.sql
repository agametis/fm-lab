-- Auto-generiert aus dem core der Rule (repeating_field). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'repeating-field' AS rule_id, 'info' AS severity,
    f.File_Name AS file_name, f.Field_UUID AS nav_uuid,
    f.Table_Name AS table_name, f.Field_Name AS field_name,
    f.Max_Repetitions AS repetitions,
    row_number() OVER (ORDER BY f.Max_Repetitions DESC) AS row_key
FROM FieldsForTables f
WHERE COALESCE(f.Max_Repetitions, 1) > 1
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
ORDER BY repetitions DESC
) _summary;
