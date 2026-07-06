-- Auto-generiert aus dem core der Rule (base_table_many_occurrences). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'base-table-many-occurrences' AS rule_id, 'info' AS severity,
    any_value(o.File_Name) AS file_name, to2.BT_UUID AS nav_uuid, any_value(o.Object_Name) AS base_table,
    COUNT(*) AS occurrence_count,
    COUNT(*) || ' occurrences' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM TableOccurrenceCatalog to2
JOIN ObjectCatalog o ON o.Object_UUID = to2.BT_UUID AND o.Object_Type = 'BaseTable'
WHERE (getvariable('file') IS NULL OR o.File_Name = getvariable('file'))
GROUP BY to2.BT_UUID
HAVING COUNT(*) > 8
ORDER BY occurrence_count DESC
) _summary;
