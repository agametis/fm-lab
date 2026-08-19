-- Top-level layout objects that stick out beyond the layout boundaries.
--
-- Only nesting level 0 is checked: those objects are positioned in absolute
-- layout coordinates, while nested objects are relative to their container
-- (covered by the lost-object rule instead). The layout box is the layout
-- width and the summed height of all its parts.
--
-- Folders and separators live in the same table as real layouts but carry no
-- width or parts — excluded with the predicate the pipeline itself uses, which
-- is also why no NULL guard on the width is needed afterwards.
--
-- The tolerance slider suppresses small overshoots: a one- or two-pixel
-- overhang is usually a rounding artefact, not a misplaced object.
WITH layout_box AS (
    SELECT ly.File_Name, ly.L_ID, ly.L_UUID, ly.L_Name, ly.L_Width,
           (SELECT SUM(lp.Part_Size) FROM LayoutParts lp
             WHERE lp.Layout_ID = ly.L_ID AND lp.File_Name = ly.File_Name) AS l_height
    FROM Layouts ly
    WHERE (ly.Folder_Type IS NULL OR ly.Folder_Type = 'False')
      AND NOT COALESCE(ly.Is_Separator, FALSE)
),
outside AS (
    SELECT lo.File_Name, lo.Layout_ID, lo.Object_UUID, lo.Object_Type, lo.Object_Name, lo.Part_Type,
           lo.Bounds_Left, lo.Bounds_Top, lo.Bounds_Right, lo.Bounds_Bottom,
           b.L_UUID, b.L_Name, b.L_Width, b.l_height,
           GREATEST(lo.Bounds_Right - b.L_Width, lo.Bounds_Bottom - b.l_height,
                    -lo.Bounds_Left, -lo.Bounds_Top) AS overshoot,
           trim(CASE WHEN lo.Bounds_Right > b.L_Width THEN 'right ' ELSE '' END
             || CASE WHEN lo.Bounds_Bottom > b.l_height THEN 'below ' ELSE '' END
             || CASE WHEN lo.Bounds_Left < 0 THEN 'left ' ELSE '' END
             || CASE WHEN lo.Bounds_Top < 0 THEN 'above' ELSE '' END) AS direction,
           CASE WHEN lo.Bounds_Left >= b.L_Width OR lo.Bounds_Top >= b.l_height
                     OR lo.Bounds_Right <= 0 OR lo.Bounds_Bottom <= 0
                THEN 'complete' ELSE 'partial' END AS extent
    FROM LayoutObjects lo
    JOIN layout_box b ON lo.Layout_ID = b.L_ID AND lo.File_Name = b.File_Name
    WHERE lo.Nesting_Level = 0
      AND (lo.Bounds_Left < 0 OR lo.Bounds_Top < 0
           OR lo.Bounds_Right > b.L_Width OR lo.Bounds_Bottom > b.l_height)
)
SELECT 'layout-object-offscreen' AS rule_id, 'warning' AS severity,
    o.File_Name AS file_name, o.L_UUID AS nav_uuid, o.L_Name AS layout_name,
    o.Object_UUID AS object_uuid, o.Object_Type AS object_type, o.Object_Name AS object_name,
    o.Part_Type AS part_type, o.direction, o.extent,
    o.Bounds_Left AS x, o.Bounds_Top AS y,
    (o.Bounds_Right - o.Bounds_Left) AS w, (o.Bounds_Bottom - o.Bounds_Top) AS h,
    CASE o.extent
        WHEN 'complete' THEN 'Object lies completely outside the layout (' || o.direction || ')'
        ELSE 'Object sticks out beyond the layout (' || o.direction || ')'
    END AS message,
    row_number() OVER (ORDER BY o.extent, o.File_Name, o.L_Name, o.Object_UUID) AS row_key
FROM outside o
WHERE o.overshoot > CAST(COALESCE(getvariable('tolerance'), '0') AS INTEGER)
  AND (getvariable('file') IS NULL OR o.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR o.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
