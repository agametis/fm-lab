SELECT
    'unused-external-data-source'   AS rule_id,
    'info' AS severity,
    oc.File_Name  AS file_name,
    oc.Object_UUID AS nav_uuid,
    oc.Object_Name AS object_name,
    'Unused External Data Source'    AS message,
    row_number() OVER (ORDER BY oc.File_Name, oc.Object_Name) AS row_key
FROM ObjectCatalog oc
WHERE oc.Object_Type = 'ExternalDataSource'
  AND NOT EXISTS (
        SELECT 1 FROM ObjectLinks ol
        WHERE ol.Target_UUID = oc.Object_UUID
          AND ol.Link_Role IN ('data_source')
      )
  AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
ORDER BY oc.File_Name, oc.Object_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
