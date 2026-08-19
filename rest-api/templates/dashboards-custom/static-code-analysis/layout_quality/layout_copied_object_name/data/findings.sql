-- Named layout objects with a copy suffix (' Copy', ' copy', ' Kopie'), a
-- numeric paste suffix (1-4 trailing digits), or a name shared with another
-- object on the same layout. FileMaker renames on paste, so the suffix check
-- is the operative duplicate detector; the duplicate clause is a cheap safety
-- net. Numeric suffixes can be deliberate naming — flagged for review, see
-- the rule description. Translated from fmCheckMate ReportCopiedObjectNames.
-- The reason chips (getvariable('reason')) and the object-type select
-- (getvariable('object_type')) narrow the result server-side — unset means
-- no filter. DuckDB resolves the reason SELECT alias in WHERE.
WITH named AS (
    SELECT File_Name, Layout_ID, Object_UUID, Object_Type, Object_Name, Part_Type,
           Bounds_Left, Bounds_Top, Bounds_Right, Bounds_Bottom
    FROM LayoutObjects
    WHERE Object_Name IS NOT NULL AND trim(Object_Name) <> ''
),
dups AS (
    SELECT File_Name, Layout_ID, Object_Name
    FROM named
    GROUP BY ALL
    HAVING COUNT(*) > 1
)
SELECT 'layout-copied-object-name' AS rule_id, 'warning' AS severity,
    n.File_Name AS file_name, l.L_UUID AS nav_uuid, l.L_Name AS layout_name,
    n.Object_UUID AS object_uuid, n.Object_Type AS object_type, n.Object_Name AS object_name,
    n.Part_Type AS part_type,
    CASE WHEN n.Object_Name LIKE '% Copy' OR n.Object_Name LIKE '% copy' OR n.Object_Name LIKE '% Kopie'
         THEN 'copy-suffix'
         WHEN d.Object_Name IS NOT NULL THEN 'duplicate-name'
         ELSE 'numeric-suffix' END AS reason,
    n.Bounds_Left AS x, n.Bounds_Top AS y, (n.Bounds_Right - n.Bounds_Left) AS w, (n.Bounds_Bottom - n.Bounds_Top) AS h,
    CASE WHEN n.Object_Name LIKE '% Copy' OR n.Object_Name LIKE '% copy' OR n.Object_Name LIKE '% Kopie'
         THEN 'Object name carries a copy suffix — probably a paste leftover'
         WHEN d.Object_Name IS NOT NULL
         THEN 'Object name appears more than once on this layout'
         ELSE 'Object name ends in a numeric suffix — possibly a paste leftover, possibly deliberate naming'
    END AS message,
    row_number() OVER (ORDER BY n.File_Name, l.L_Name, n.Object_Name, n.Object_UUID) AS row_key
FROM named n
JOIN Layouts l ON n.Layout_ID = l.L_ID AND n.File_Name = l.File_Name
LEFT JOIN dups d ON d.File_Name = n.File_Name AND d.Layout_ID = n.Layout_ID
 AND d.Object_Name = n.Object_Name
WHERE (n.Object_Name LIKE '% Copy' OR n.Object_Name LIKE '% copy' OR n.Object_Name LIKE '% Kopie'
       OR regexp_matches(n.Object_Name, ' \d{1,4}$')
       OR d.Object_Name IS NOT NULL)
  AND (getvariable('reason') IS NULL OR reason = getvariable('reason'))
  AND (getvariable('object_type') IS NULL OR n.Object_Type = getvariable('object_type'))
  AND (getvariable('file') IS NULL OR n.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
