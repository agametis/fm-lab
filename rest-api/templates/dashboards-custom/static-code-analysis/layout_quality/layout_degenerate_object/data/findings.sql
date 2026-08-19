-- Degenerate layout objects in three classes — zero width or height,
-- text objects without text, and objects below the minimum size in both
-- dimensions (width/height sliders min_w/min_h, default 4 px each). Lines are excluded entirely,
-- zero extent is their normal shape. Priority when classes overlap is
-- zero-size, then empty-text, then undersized (one finding per object).
-- The defect chips (getvariable('defect')) and the object-type select
-- (getvariable('object_type')) narrow the result server-side — unset means
-- no filter.
WITH sized AS (
    SELECT File_Name, Layout_ID, Object_UUID, Object_Type, Object_Name, Part_Type, Text_Content,
           Bounds_Left AS bl, Bounds_Top AS bt, Bounds_Right AS br, Bounds_Bottom AS bb,
           (Bounds_Right - Bounds_Left) AS w, (Bounds_Bottom - Bounds_Top) AS h
    FROM LayoutObjects
    WHERE Object_Type <> 'Line'
),
classified AS (
    SELECT *,
        CASE WHEN w <= 0 OR h <= 0 THEN 'zero-size'
             WHEN Object_Type = 'Text' AND trim(COALESCE(Text_Content, '')) = '' THEN 'empty-text'
             WHEN w < CAST(COALESCE(getvariable('min_w'), '4') AS INTEGER)
              AND h < CAST(COALESCE(getvariable('min_h'), '4') AS INTEGER) THEN 'undersized'
        END AS defect
    FROM sized
)
SELECT 'layout-degenerate-object' AS rule_id, 'info' AS severity,
    c.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    c.Object_UUID AS object_uuid, c.Object_Type AS object_type, c.Object_Name AS object_name,
    c.Part_Type AS part_type, c.defect,
    CAST(COALESCE(getvariable('min_w'), '4') AS INTEGER) AS min_w,
    CAST(COALESCE(getvariable('min_h'), '4') AS INTEGER) AS min_h,
    c.bl AS x, c.bt AS y, c.w AS w, c.h AS h,
    CASE c.defect
        WHEN 'zero-size' THEN 'Object has zero width or height'
        WHEN 'empty-text' THEN 'Text object contains no text'
        ELSE 'Object is smaller than ' || CAST(COALESCE(getvariable('min_w'), '4') AS INTEGER) || '×' || CAST(COALESCE(getvariable('min_h'), '4') AS INTEGER) || ' px (width×height)'
    END AS message,
    row_number() OVER (ORDER BY c.defect, c.File_Name, ly.L_Name, c.Object_UUID) AS row_key
FROM classified c
JOIN Layouts ly ON c.Layout_ID = ly.L_ID AND c.File_Name = ly.File_Name
WHERE c.defect IS NOT NULL
  AND (getvariable('defect') IS NULL OR c.defect = getvariable('defect'))
  AND (getvariable('object_type') IS NULL OR c.Object_Type = getvariable('object_type'))
  AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
