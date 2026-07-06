SELECT 'custom-function-many-params' AS rule_id, 'info' AS severity,
    cf.File_Name AS file_name, cf.CF_UUID AS nav_uuid, cf.CF_Name AS cf_name,
    len(cf.Parameters) AS param_count,
    len(cf.Parameters) || ' parameters' AS message,
    row_number() OVER (ORDER BY len(cf.Parameters) DESC) AS row_key
FROM CustomFunctionsCatalog cf
WHERE len(cf.Parameters) >= 5
  AND (getvariable('file') IS NULL OR cf.File_Name = getvariable('file'))
ORDER BY param_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
