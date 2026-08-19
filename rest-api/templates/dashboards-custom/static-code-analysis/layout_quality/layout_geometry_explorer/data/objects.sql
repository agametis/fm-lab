-- Layout-object geometry inventory — one row per layout object with its own
-- x/y/w/h (parent-relative for nested objects, layout-absolute at top level)
-- plus part, nesting level and z-order. The coordinate window
-- (x_min/x_max/y_min/y_max, layout-absolute, "object intersects window")
-- matches top-level objects exactly; nested objects count via their top-level
-- container, resolved through the recursive root walk below. Size filters
-- (w_min/w_max/h_min/h_max) apply to the object itself. Unset parameters mean
-- no filter.
WITH RECURSIVE rooted AS (
    SELECT File_Name, Layout_ID, Object_ID, Object_ID AS root_id
    FROM LayoutObjects
    WHERE Parent_Object_ID IS NULL
    UNION ALL
    SELECT c.File_Name, c.Layout_ID, c.Object_ID, r.root_id
    FROM LayoutObjects c
    JOIN rooted r ON c.Parent_Object_ID = r.Object_ID
     AND c.Layout_ID = r.Layout_ID AND c.File_Name = r.File_Name
)
SELECT
    lo.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    lo.Part_Type AS part_type, lo.Object_Type AS object_type, lo.Object_Name AS object_name,
    lo.Nesting_Level AS nesting,
    lo.Bounds_Left AS x, lo.Bounds_Top AS y,
    (lo.Bounds_Right - lo.Bounds_Left) AS w, (lo.Bounds_Bottom - lo.Bounds_Top) AS h,
    lo.Z_Order AS z,
    lo.Object_UUID AS object_uuid,
    row_number() OVER (ORDER BY lo.File_Name, ly.L_Name, lo.Z_Order, lo.Object_UUID) AS row_key
FROM LayoutObjects lo
JOIN rooted rt ON rt.Object_ID = lo.Object_ID
 AND rt.Layout_ID = lo.Layout_ID AND rt.File_Name = lo.File_Name
JOIN LayoutObjects root ON root.Object_ID = rt.root_id
 AND root.Layout_ID = lo.Layout_ID AND root.File_Name = lo.File_Name
JOIN Layouts ly ON lo.Layout_ID = ly.L_ID AND lo.File_Name = ly.File_Name
WHERE (getvariable('part') IS NULL OR lo.Part_Type = getvariable('part'))
  AND (getvariable('object_type') IS NULL OR lo.Object_Type = getvariable('object_type'))
  AND (getvariable('w_min') IS NULL OR (lo.Bounds_Right - lo.Bounds_Left) >= CAST(getvariable('w_min') AS INTEGER))
  AND (getvariable('w_max') IS NULL OR (lo.Bounds_Right - lo.Bounds_Left) <= CAST(getvariable('w_max') AS INTEGER))
  AND (getvariable('h_min') IS NULL OR (lo.Bounds_Bottom - lo.Bounds_Top) >= CAST(getvariable('h_min') AS INTEGER))
  AND (getvariable('h_max') IS NULL OR (lo.Bounds_Bottom - lo.Bounds_Top) <= CAST(getvariable('h_max') AS INTEGER))
  AND (getvariable('x_min') IS NULL OR root.Bounds_Right > CAST(getvariable('x_min') AS INTEGER))
  AND (getvariable('x_max') IS NULL OR root.Bounds_Left < CAST(getvariable('x_max') AS INTEGER))
  AND (getvariable('y_min') IS NULL OR root.Bounds_Bottom > CAST(getvariable('y_min') AS INTEGER))
  AND (getvariable('y_max') IS NULL OR root.Bounds_Top < CAST(getvariable('y_max') AS INTEGER))
  AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
