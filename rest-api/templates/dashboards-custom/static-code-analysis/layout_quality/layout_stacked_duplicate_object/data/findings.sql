-- Pairs of sibling objects (same parent scope and part) of the same type
-- with exactly identical bounds — the upper one fully covers the lower one,
-- typically a double paste. Tab and popover panels are excluded, congruent
-- panels are their normal form. One finding per pair.
WITH sib AS (
    SELECT File_Name, Layout_ID, COALESCE(Parent_Object_ID, -1) AS parent_scope, Part_Type,
           Object_ID, Object_UUID, Object_Type, Object_Name, Z_Order,
           Bounds_Left AS bl, Bounds_Top AS bt, Bounds_Right AS br, Bounds_Bottom AS bb
    FROM LayoutObjects
    WHERE Object_Type NOT IN ('Panel', 'PopoverPanel')
)
SELECT 'layout-stacked-duplicate-object' AS rule_id, 'warning' AS severity,
    a.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    a.Object_UUID AS object_uuid, a.Object_Type AS object_type,
    COALESCE(NULLIF(trim(a.Object_Name), ''), '(unnamed)') AS object_name,
    a.Part_Type AS part_type,
    b.Object_UUID AS partner_uuid,
    COALESCE(NULLIF(trim(b.Object_Name), ''), '(unnamed)') AS partner_name,
    a.bl AS x, a.bt AS y, (a.br - a.bl) AS w, (a.bb - a.bt) AS h,
    a.Z_Order || ' / ' || b.Z_Order AS z_orders,
    'Two ' || a.Object_Type || ' objects share identical bounds — the upper one fully covers the lower one' AS message,
    row_number() OVER (ORDER BY a.File_Name, ly.L_Name, a.Object_ID, b.Object_ID) AS row_key
FROM sib a
JOIN sib b ON a.File_Name = b.File_Name AND a.Layout_ID = b.Layout_ID
 AND a.parent_scope = b.parent_scope
 AND a.Part_Type IS NOT DISTINCT FROM b.Part_Type
 AND a.Object_Type = b.Object_Type
 AND a.Object_ID < b.Object_ID
 AND a.bl = b.bl AND a.bt = b.bt AND a.br = b.br AND a.bb = b.bb
JOIN Layouts ly ON a.Layout_ID = ly.L_ID AND a.File_Name = ly.File_Name
WHERE (getvariable('file') IS NULL OR a.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
