-- Only base tables that resolve to a real, local BaseTable object are counted.
-- TableOccurrenceCatalog.BT_UUID is NULL for occurrences whose base table lives
-- in an external, non-imported file (these were previously merged into one
-- meaningless NULL-group row) and points to unresolvable UUIDs for cross-file
-- references into files outside the corpus (previously a broken navigation
-- link). The JOIN to ObjectCatalog restricts to resolvable local base tables,
-- so every nav_uuid navigates correctly.
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
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
