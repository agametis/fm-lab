-- Objects completely covered by a sibling portal, tab control or slide
-- control that is drawn later in the stacking order (higher Z_Order = in
-- front). Siblings share one coordinate system, so bounds compare directly.
-- Popover buttons and panels are excluded (their panels float). Objects in
-- front of containers (e.g. buttons over portals) are normal design and not
-- flagged. Translated from fmCheckMate ReportObjectsHiddenBehindContainers.
WITH sib AS (
    SELECT File_Name, Layout_ID, COALESCE(Parent_Object_ID, -1) AS parent_scope, Part_Type,
           Object_ID, Object_UUID, Object_Type, Object_Name, Z_Order,
           Bounds_Left AS bl, Bounds_Top AS bt, Bounds_Right AS br, Bounds_Bottom AS bb
    FROM LayoutObjects
),
covered AS (
    SELECT o.File_Name, o.Layout_ID, o.Object_UUID, o.Object_Type, o.Object_Name, o.Part_Type,
           o.bl, o.bt, o.br, o.bb,
           c.Object_Type AS container_type, c.Object_Name AS container_name,
           row_number() OVER (PARTITION BY o.File_Name, o.Layout_ID, o.Object_ID
                              ORDER BY c.Z_Order DESC) AS rn
    FROM sib o
    JOIN sib c ON o.File_Name = c.File_Name AND o.Layout_ID = c.Layout_ID
     AND o.parent_scope = c.parent_scope
     AND o.Part_Type IS NOT DISTINCT FROM c.Part_Type
     AND o.Object_ID <> c.Object_ID
    WHERE c.Object_Type IN ('Portal', 'Tab Control', 'Slide Control')
      AND o.Object_Type NOT IN ('Popover Button', 'PopoverPanel')
      AND c.Z_Order > o.Z_Order
      AND o.bl >= c.bl AND o.bt >= c.bt AND o.br <= c.br AND o.bb <= c.bb
)
SELECT 'layout-object-occluded' AS rule_id, 'warning' AS severity,
    o.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    o.Object_UUID AS object_uuid, o.Object_Type AS object_type, o.Object_Name AS object_name,
    o.Part_Type AS part_type, o.container_type,
    o.bl AS x, o.bt AS y, (o.br - o.bl) AS w, (o.bb - o.bt) AS h,
    'Object lies completely behind a ' || o.container_type || ' drawn in front of it — covered and unreachable in Browse mode' AS message,
    row_number() OVER (ORDER BY o.File_Name, ly.L_Name, o.Object_UUID) AS row_key
FROM covered o
JOIN Layouts ly ON o.Layout_ID = ly.L_ID AND o.File_Name = ly.File_Name
WHERE o.rn = 1
  AND (getvariable('file') IS NULL OR o.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
