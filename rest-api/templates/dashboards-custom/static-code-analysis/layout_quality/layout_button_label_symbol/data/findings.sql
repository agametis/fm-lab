-- Layout symbols ({{…}}) in the label of a button or popover button.
--
-- FileMaker evaluates a symbol only in a text object. In the label of a button
-- (kind 10) or popover button (kind 14) every symbol stays literal in browse and
-- preview mode — valid Get parameters such as {{CurrentDate}} included — while
-- merge fields, merge variables and layout calculations typed into the same
-- label ARE evaluated. That makes the symbol the one anchor kind that silently
-- does nothing there. Info, not a warning: the literal text may be intended.
--
-- Source is the symbol inventory LayoutObjectSymbols (P3 A.13); it lists the
-- symbols of button labels since Text_Content carries the label (schema
-- 1.33.0). The kind filter runs on LayoutObjects.Object_Kind — the inventory's
-- Is_Evaluated column says the same, but catalogs of older converters lack it.
-- On such a catalog the rule finds nothing (button labels were not extracted),
-- never a false positive. One finding per (object, symbol) with its occurrence
-- count, like layout_invalid_symbol.
WITH lo AS (
    -- LayoutObjects can carry duplicate rows per (Object_UUID, File_Name).
    SELECT Object_UUID, Object_ID, File_Name, Object_Name, Object_Type,
           Bounds_Left, Bounds_Top, Bounds_Right, Bounds_Bottom,
           ROW_NUMBER() OVER (PARTITION BY Object_UUID, File_Name ORDER BY Object_ID) AS rn
    FROM LayoutObjects
    WHERE Object_Kind IN (10, 14)
)
SELECT 'layout-button-label-symbol' AS rule_id, 'info' AS severity,
    s.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    o.Object_UUID AS object_uuid, o.Object_Type AS object_type,
    COALESCE(NULLIF(trim(o.Object_Name), ''), '(unnamed)') AS object_name,
    '{{' || s.Symbol_Text || '}}' AS symbol,
    s.Occurrence_Count AS occurrences,
    'not-evaluated' AS defect,
    o.Bounds_Left AS x, o.Bounds_Top AS y,
    (o.Bounds_Right - o.Bounds_Left) AS w, (o.Bounds_Bottom - o.Bounds_Top) AS h,
    '{{' || s.Symbol_Text || '}} in a button label is not evaluated — the text renders literally' AS message,
    row_number() OVER (ORDER BY s.File_Name, ly.L_Name, o.Object_Name, s.Symbol_Norm) AS row_key
FROM LayoutObjectSymbols s
JOIN lo o       ON o.Object_UUID = s.Object_UUID AND o.File_Name = s.File_Name AND o.rn = 1
JOIN Layouts ly ON ly.L_ID = s.Layout_ID AND ly.File_Name = s.File_Name
WHERE (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
