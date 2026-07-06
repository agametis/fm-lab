SELECT 'cascade-delete-relationship' AS rule_id, 'warning' AS severity,
    r.File_Name AS file_name, 'rel_' || r.Rel_ID || '_' || r.File_Name AS nav_uuid,
    r.Left_TO_Name AS left_to, r.Right_TO_Name AS right_to,
    CASE WHEN r.Left_Delete AND r.Right_Delete THEN 'both sides'
         WHEN r.Left_Delete THEN 'left deletes right' ELSE 'right deletes left' END AS cascade,
    row_number() OVER (ORDER BY r.File_Name, r.Left_TO_Name) AS row_key
FROM (SELECT DISTINCT File_Name, Rel_ID, Left_TO_Name, Right_TO_Name, Left_Delete, Right_Delete
      FROM RelationshipCatalog WHERE Left_Delete OR Right_Delete) r
WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file'))
ORDER BY r.File_Name, r.Left_TO_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
