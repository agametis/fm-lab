-- Groups (Object_Type 'Group') containing exactly one child. Restricted to
-- real groups on purpose — FileMaker serializes single-object buttons as
-- 'Grouped Button' with one child, which is its normal form, not a finding.
-- Translated from fmCheckMate ReportGroupOfOne.
WITH single_groups AS (
    SELECT g.File_Name, g.Layout_ID, g.Object_UUID, g.Object_Name, g.Part_Type,
           g.Bounds_Left AS bl, g.Bounds_Top AS bt, g.Bounds_Right AS br, g.Bounds_Bottom AS bb,
           any_value(c.Object_Type) AS child_type,
           any_value(c.Object_Name) AS child_name
    FROM LayoutObjects g
    JOIN LayoutObjects c ON c.Parent_Object_ID = g.Object_ID
     AND c.Layout_ID = g.Layout_ID AND c.File_Name = g.File_Name
    WHERE g.Object_Type = 'Group'
    GROUP BY g.File_Name, g.Layout_ID, g.Object_UUID, g.Object_Name, g.Part_Type,
             g.Bounds_Left, g.Bounds_Top, g.Bounds_Right, g.Bounds_Bottom
    HAVING COUNT(*) = 1
)
SELECT 'layout-group-of-one' AS rule_id, 'info' AS severity,
    g.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    g.Object_UUID AS object_uuid, 'Group' AS object_type, g.Object_Name AS object_name,
    g.Part_Type AS part_type, g.child_type, g.child_name,
    g.bl AS x, g.bt AS y, (g.br - g.bl) AS w, (g.bb - g.bt) AS h,
    'Group contains a single ' || g.child_type || ' object — grouping overhead without grouping anything' AS message,
    row_number() OVER (ORDER BY g.File_Name, ly.L_Name, g.Object_UUID) AS row_key
FROM single_groups g
JOIN Layouts ly ON g.Layout_ID = ly.L_ID AND g.File_Name = ly.File_Name
WHERE (getvariable('file') IS NULL OR g.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
