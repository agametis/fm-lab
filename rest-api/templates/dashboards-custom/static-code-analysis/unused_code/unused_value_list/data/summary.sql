-- Auto-generiert aus dem core der Rule (unused_value_list). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT
    'unused-value-list'   AS rule_id,
    'info' AS severity,
    oc.File_Name  AS file_name,
    oc.Object_UUID AS nav_uuid,
    oc.Object_Name AS object_name,
    'Unused Value List'    AS message,
    row_number() OVER (ORDER BY oc.File_Name, oc.Object_Name) AS row_key
FROM ObjectCatalog oc
WHERE oc.Object_Type = 'ValueList'
  AND NOT EXISTS (
        SELECT 1 FROM ObjectLinks ol
        WHERE ol.Target_UUID = oc.Object_UUID
          AND ol.Link_Role IN ('uses_valuelist', 'sorts_by_valuelist', 'source_valuelist')
      )
  AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
ORDER BY oc.File_Name, oc.Object_Name
) _summary;
