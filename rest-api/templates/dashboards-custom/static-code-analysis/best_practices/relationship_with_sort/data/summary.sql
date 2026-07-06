-- Auto-generiert aus dem core der Rule (relationship_with_sort). Nicht von Hand editieren.
SELECT
    COUNT(*)                     AS finding_count,
    'info'          AS severity,
    COUNT(DISTINCT file_name)   AS affected_files
FROM (
SELECT 'relationship-with-sort' AS rule_id, 'info' AS severity,
    r.File_Name AS file_name, r.Left_TO_Name AS left_to, r.Right_TO_Name AS right_to,
    CASE WHEN r.Left_Sort_Enabled = 'True' AND r.Right_Sort_Enabled = 'True' THEN 'both sides'
         WHEN r.Left_Sort_Enabled = 'True' THEN 'left' ELSE 'right' END AS sorted_side,
    row_number() OVER (ORDER BY r.File_Name, r.Left_TO_Name) AS row_key
FROM (SELECT DISTINCT File_Name, Rel_ID, Left_TO_Name, Right_TO_Name, Left_Sort_Enabled, Right_Sort_Enabled
      FROM RelationshipCatalog WHERE Left_Sort_Enabled = 'True' OR Right_Sort_Enabled = 'True') r
WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file'))
ORDER BY r.File_Name, r.Left_TO_Name
) _summary;
