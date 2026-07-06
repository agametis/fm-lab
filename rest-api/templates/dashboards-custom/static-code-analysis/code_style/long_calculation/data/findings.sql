SELECT 'long-calculation' AS rule_id, 'info' AS severity,
    f.File_Name AS file_name, f.Field_UUID AS nav_uuid,
    f.Table_Name || '::' || f.Field_Name AS field_name,
    length(f.Calculation_Text) AS calc_length,
    length(f.Calculation_Text) || ' chars' AS message,
    row_number() OVER (ORDER BY length(f.Calculation_Text) DESC) AS row_key
FROM FieldsForTables f
WHERE f.Field_Type = 'Calculated' AND length(COALESCE(f.Calculation_Text, '')) >= CAST(COALESCE(getvariable('min_calc_length'), '2000') AS INTEGER)
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
ORDER BY calc_length DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
