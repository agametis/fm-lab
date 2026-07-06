-- Auto-generiert aus dem core der Rule (relationship_multi_field). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'relationship-multi-field' AS rule_id, 'info' AS severity,
    any_value(File_Name) AS file_name, any_value(Left_TO_Name) AS left_to, any_value(Right_TO_Name) AS right_to,
    COUNT(*) AS predicate_count,
    any_value(Left_TO_Name) || ' — ' || any_value(Right_TO_Name) || ' (' || COUNT(*) || ' predicates)' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM RelationshipCatalog
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
GROUP BY File_Name, Rel_ID
HAVING COUNT(*) >= 3
ORDER BY predicate_count DESC
) _summary;
