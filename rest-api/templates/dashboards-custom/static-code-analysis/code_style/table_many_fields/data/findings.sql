SELECT 'table-many-fields' AS rule_id, 'info' AS severity,
    any_value(f.File_Name) AS file_name, f.Table_UUID AS nav_uuid, any_value(f.Table_Name) AS table_name,
    COUNT(*) AS field_count, COUNT(*) || ' fields' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM FieldsForTables f
WHERE (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
GROUP BY f.Table_UUID
HAVING COUNT(*) >= CAST(COALESCE(getvariable('min_fields'), '100') AS INTEGER)
ORDER BY field_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
