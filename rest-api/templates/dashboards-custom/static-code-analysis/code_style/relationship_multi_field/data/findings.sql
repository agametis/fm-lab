SELECT 'relationship-multi-field' AS rule_id, 'info' AS severity,
    File_Name AS file_name, 'rel_' || Rel_ID || '_' || File_Name AS nav_uuid,
    any_value(Left_TO_Name) AS left_to, any_value(Right_TO_Name) AS right_to,
    COUNT(*) AS predicate_count,
    any_value(Left_TO_Name) || ' — ' || any_value(Right_TO_Name) || ' (' || COUNT(*) || ' predicates)' AS message,
    row_number() OVER (ORDER BY COUNT(*) DESC) AS row_key
FROM RelationshipCatalog
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
-- Rel_ID is only unique per file — grouping by Rel_ID alone merged the same
-- relationship number across all files and summed their predicates. Group by
-- (File_Name, Rel_ID) so the count is the real per-relationship predicate count.
GROUP BY File_Name, Rel_ID
HAVING COUNT(*) >= 3
ORDER BY predicate_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
