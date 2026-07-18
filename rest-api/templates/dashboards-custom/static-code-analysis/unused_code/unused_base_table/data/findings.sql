SELECT
    'unused-base-table'   AS rule_id,
    'info' AS severity,
    oc.File_Name  AS file_name,
    oc.Object_UUID AS nav_uuid,
    oc.Object_Name AS object_name,
    'Unused Base Table'    AS message,
    row_number() OVER (ORDER BY oc.File_Name, oc.Object_Name) AS row_key
FROM ObjectCatalog oc
WHERE oc.Object_Type = 'BaseTable'
  AND NOT EXISTS (
        SELECT 1 FROM ObjectLinks ol
        WHERE ol.Target_UUID = oc.Object_UUID AND ol.Target_File IS NOT DISTINCT FROM oc.File_Name
          AND ol.Link_Role IN ('base_table')
      )
  AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
ORDER BY oc.File_Name, oc.Object_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
