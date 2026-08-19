-- Buttons that carry neither a script call nor a single-step action.
--
-- SaveAsXML serialises a button's action in one of two shapes: a script action
-- becomes a ScriptReference, a single-step action becomes a Step element. A
-- button with neither does nothing when clicked. The Button/Options value is
-- NOT a usable discriminator — the same value appears on buttons with and
-- without an action.
--
-- Buttons never have child objects, so the container-XML caveat does not
-- apply here; the parent context is reported instead, because an inactive
-- button-bar segment or a decorative icon inside a portal reads very
-- differently from a lone top-level button that lost its script.
-- Translated from fmCheckMate ReportButtonsWithoutAction.
SELECT 'layout-button-without-action' AS rule_id, 'info' AS severity,
    b.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    b.Object_UUID AS object_uuid, b.Object_Type AS object_type, b.Object_Name AS object_name,
    b.Part_Type AS part_type,
    COALESCE(p.Object_Type, 'top-level') AS context,
    b.Bounds_Left AS x, b.Bounds_Top AS y,
    (b.Bounds_Right - b.Bounds_Left) AS w, (b.Bounds_Bottom - b.Bounds_Top) AS h,
    'Button has neither a script call nor a single-step action' AS message,
    row_number() OVER (ORDER BY b.File_Name, ly.L_Name, b.Object_UUID) AS row_key
FROM LayoutObjects b
LEFT JOIN LayoutObjects p
       ON b.Parent_Object_ID = p.Object_ID AND b.Layout_ID = p.Layout_ID AND b.File_Name = p.File_Name
JOIN Layouts ly ON b.Layout_ID = ly.L_ID AND b.File_Name = ly.File_Name
WHERE b.Object_Type = 'Button'
  AND b.Object_XML NOT LIKE '%<ScriptReference%'
  AND b.Object_XML NOT LIKE '%<Step%'
  AND (getvariable('context') IS NULL OR COALESCE(p.Object_Type, 'top-level') = getvariable('context'))
  AND (getvariable('file') IS NULL OR b.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
