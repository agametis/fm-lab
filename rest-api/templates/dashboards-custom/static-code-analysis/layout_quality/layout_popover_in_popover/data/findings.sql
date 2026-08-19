-- Popover buttons with a PopoverPanel ancestor anywhere up the container
-- chain. A popover panel is serialized as a child of its own button, so the
-- upward walk never meets the button's own panel — only a truly enclosing one.
-- Translated from fmCheckMate ReportPopoverInPopover.
WITH RECURSIVE chain AS (
    SELECT File_Name, Layout_ID, Object_UUID, Object_Name, Part_Type,
           Bounds_Left, Bounds_Top, Bounds_Right, Bounds_Bottom, Parent_Object_ID
    FROM LayoutObjects
    WHERE Object_Type = 'Popover Button'
    UNION ALL
    SELECT c.File_Name, c.Layout_ID, c.Object_UUID, c.Object_Name, c.Part_Type,
           c.Bounds_Left, c.Bounds_Top, c.Bounds_Right, c.Bounds_Bottom, p.Parent_Object_ID
    FROM chain c
    JOIN LayoutObjects p ON c.Parent_Object_ID = p.Object_ID
     AND c.Layout_ID = p.Layout_ID AND c.File_Name = p.File_Name
),
nested AS (
    SELECT DISTINCT ch.File_Name, ch.Layout_ID, ch.Object_UUID, ch.Object_Name, ch.Part_Type,
           ch.Bounds_Left, ch.Bounds_Top, ch.Bounds_Right, ch.Bounds_Bottom
    FROM chain ch
    JOIN LayoutObjects anc ON ch.Parent_Object_ID = anc.Object_ID
     AND ch.Layout_ID = anc.Layout_ID AND ch.File_Name = anc.File_Name
    WHERE anc.Object_Type = 'PopoverPanel'
)
SELECT 'layout-popover-in-popover' AS rule_id, 'error' AS severity,
    n.File_Name AS file_name, l.L_UUID AS nav_uuid, l.L_Name AS layout_name,
    n.Object_UUID AS object_uuid, 'Popover Button' AS object_type, n.Object_Name AS object_name,
    n.Part_Type AS part_type,
    n.Bounds_Left AS x, n.Bounds_Top AS y, (n.Bounds_Right - n.Bounds_Left) AS w, (n.Bounds_Bottom - n.Bounds_Top) AS h,
    'Popover button is nested inside another popover panel — nested popovers close the outer popover' AS message,
    row_number() OVER (ORDER BY n.File_Name, l.L_Name, n.Object_UUID) AS row_key
FROM nested n
JOIN Layouts l ON n.Layout_ID = l.L_ID AND n.File_Name = l.File_Name
WHERE (getvariable('file') IS NULL OR n.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
