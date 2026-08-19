-- Layout objects bound to a value list that no longer exists in their file.
-- Resolution runs over the value-list ID, never the name: names in the raw
-- object XML are entity-encoded (umlauts arrive as &#xE4; and friends) while
-- the catalog holds them decoded, so a name join would report every value
-- list with a special character as missing. Value lists are file-local, so
-- the ID lookup stays inside the object's own file.
-- Container objects are excluded — their XML embeds their children's markup.
-- Translated from fmCheckMate ReportBrokenValueLists.
WITH leaf AS (
    SELECT lo.*
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%<ValueListReference%'
      AND NOT EXISTS (SELECT 1 FROM LayoutObjects k
                      WHERE k.Parent_Object_ID = lo.Object_ID
                        AND k.Layout_ID = lo.Layout_ID
                        AND k.File_Name = lo.File_Name)
),
ref AS (
    SELECT l.File_Name, l.Layout_ID, l.Object_UUID, l.Object_Type, l.Object_Name, l.Part_Type,
           l.Bounds_Left, l.Bounds_Top, l.Bounds_Right, l.Bounds_Bottom,
           regexp_extract(l.Object_XML, '<ValueListReference[^>]*id="(\d+)"', 1) AS vl_id,
           regexp_extract(l.Object_XML, '<ValueListReference[^>]*name="([^"]*)"', 1) AS vl_name
    FROM leaf l
)
SELECT 'layout-broken-valuelist' AS rule_id, 'error' AS severity,
    r.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    r.Object_UUID AS object_uuid, r.Object_Type AS object_type, r.Object_Name AS object_name,
    r.Part_Type AS part_type,
    COALESCE(NULLIF(r.vl_name, ''), '#' || r.vl_id) AS valuelist,
    r.Bounds_Left AS x, r.Bounds_Top AS y,
    (r.Bounds_Right - r.Bounds_Left) AS w, (r.Bounds_Bottom - r.Bounds_Top) AS h,
    'Value list no longer exists in this file' AS message,
    row_number() OVER (ORDER BY r.File_Name, ly.L_Name, r.Object_UUID) AS row_key
FROM ref r
JOIN Layouts ly ON r.Layout_ID = ly.L_ID AND r.File_Name = ly.File_Name
WHERE r.vl_id IS NOT NULL AND r.vl_id <> ''
  AND NOT EXISTS (SELECT 1 FROM ValueListCatalog v
                  WHERE v.File_Name = r.File_Name
                    AND v.VL_ID = TRY_CAST(r.vl_id AS BIGINT))
  AND (getvariable('file') IS NULL OR r.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
