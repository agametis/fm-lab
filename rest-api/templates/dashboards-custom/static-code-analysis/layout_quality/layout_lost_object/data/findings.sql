-- Nested objects completely or partially outside their parent's local extent.
-- Bounds are parent-relative, so the parent occupies [0,w] x [0,h] in the
-- child's coordinate system. Calibrations from the source and a 165k-object
-- reference corpus — portal scrollbar tolerance 19 px on the right edge,
-- PopoverPanel children excluded (floating panels legitimately sit outside
-- their button), zero-extent lines sitting exactly on the parent edge use
-- strict comparisons (legitimate border lines). Translated from fmCheckMate
-- ReportObjectsLostInContainers.
-- The extent chips (getvariable('extent')) and the object-type select
-- (getvariable('object_type')) narrow the result server-side — unset means
-- no filter. DuckDB resolves the extent SELECT alias in WHERE.
WITH child AS (
    SELECT c.File_Name, c.Layout_ID, c.Object_UUID, c.Object_Type, c.Object_Name, c.Part_Type,
           c.Bounds_Left AS bl, c.Bounds_Top AS bt, c.Bounds_Right AS br, c.Bounds_Bottom AS bb,
           par.Object_Type AS parent_type,
           (par.Bounds_Right - par.Bounds_Left) AS parent_w,
           (par.Bounds_Bottom - par.Bounds_Top) AS parent_h,
           (par.Bounds_Right - par.Bounds_Left)
               + CASE WHEN par.Object_Type = 'Portal' THEN 19 ELSE 0 END AS eff_w,
           (c.Object_Type = 'Line'
            AND (c.Bounds_Right - c.Bounds_Left = 0 OR c.Bounds_Bottom - c.Bounds_Top = 0)) AS zero_line
    FROM LayoutObjects c
    JOIN LayoutObjects par ON c.Parent_Object_ID = par.Object_ID
     AND c.Layout_ID = par.Layout_ID AND c.File_Name = par.File_Name
    WHERE c.Object_Type <> 'PopoverPanel'
),
flagged AS (
    SELECT *,
        CASE WHEN zero_line THEN (br < 0 OR bb < 0 OR bl > eff_w OR bt > parent_h)
             ELSE (br <= 0 OR bb <= 0 OR bl >= eff_w OR bt >= parent_h) END AS fully_out,
        (bl < 0 OR bt < 0 OR br > eff_w OR bb > parent_h) AS out_any
    FROM child
)
SELECT 'layout-lost-object' AS rule_id, 'warning' AS severity,
    f.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    f.Object_UUID AS object_uuid, f.Object_Type AS object_type, f.Object_Name AS object_name,
    f.Part_Type AS part_type, f.parent_type,
    CASE WHEN f.fully_out THEN 'completely' ELSE 'partially' END AS extent,
    f.bl AS x, f.bt AS y, (f.br - f.bl) AS w, (f.bb - f.bt) AS h,
    CASE WHEN f.fully_out
         THEN 'Object lies completely outside its parent ' || f.parent_type || ' (' || f.parent_w || 'x' || f.parent_h || ' px)'
         ELSE 'Object extends beyond its parent ' || f.parent_type || ' (' || f.parent_w || 'x' || f.parent_h || ' px)'
    END AS message,
    row_number() OVER (ORDER BY f.fully_out DESC, f.File_Name, ly.L_Name, f.Object_UUID) AS row_key
FROM flagged f
JOIN Layouts ly ON f.Layout_ID = ly.L_ID AND f.File_Name = ly.File_Name
WHERE (f.fully_out OR f.out_any)
  AND (getvariable('extent') IS NULL OR extent = getvariable('extent'))
  AND (getvariable('object_type') IS NULL OR f.Object_Type = getvariable('object_type'))
  AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
