-- @template_type: report
-- @description: Performance rule (layout_unstored_calc_fields) — layouts ranked by the
--   number of unstored calculation fields placed on them. Each unstored calc is
--   re-evaluated per displayed record, so a high count on a record-list layout is the
--   most expensive case. Default_View (Form/List/Table) qualifies the render context —
--   List is the most critical. Optional 'view' param filters by that view type.
-- @params: file (optional), view (optional: Form|List|Table), limit (optional, default 500)
WITH unstored AS (
    SELECT Field_UUID, File_Name
    FROM FieldsForTables
    WHERE Field_Type = 'Calculated' AND Storage_StoreCalcResults = FALSE
),
-- Placements inside portals, counted on the LayoutObject level (the
-- layout-level displays_field edges below carry no container context).
-- A portal repeats the evaluation per visible row — the expensive class
-- alongside list views (WAN-first community calibration).
portal_placements AS (
    SELECT lo.File_Name, lo.Layout_ID, CAST(count(*) AS INTEGER) AS n
    FROM ObjectLinks pol
    JOIN ObjectCatalog src ON pol.Source_UUID = src.Object_UUID AND src.Object_Type = 'LayoutObject'
    JOIN LayoutObjects lo ON src.Object_UUID = lo.Object_UUID
    JOIN LayoutObjects par ON lo.Parent_Object_ID = par.Object_ID
                          AND lo.Layout_ID = par.Layout_ID AND lo.File_Name = par.File_Name
                          AND par.Object_Type = 'Portal'
    JOIN unstored u2 ON u2.Field_UUID = pol.Target_UUID
    WHERE pol.Link_Role = 'displays_field'
    GROUP BY 1, 2
)
SELECT 'layout-unstored-calc' AS rule_id, 'warning' AS severity,
    l.Default_View AS default_view,
    l.File_Name    AS file_name,
    l.L_UUID       AS nav_uuid,
    l.L_Name       AS layout_name,
    l.L_TO_Name    AS base_to,
    COUNT(DISTINCT ol.Target_UUID || '|' || COALESCE(ol.Target_File, '')) AS unstored_calc_fields,
    COUNT(*)                       AS placements,
    COALESCE(any_value(pp.n), 0)   AS portal_placements,
    row_number() OVER (ORDER BY COUNT(DISTINCT ol.Target_UUID || '|' || COALESCE(ol.Target_File, '')) DESC, l.File_Name, l.L_Name) AS row_key
FROM ObjectLinks ol
JOIN unstored u ON u.Field_UUID = ol.Target_UUID AND u.File_Name IS NOT DISTINCT FROM ol.Target_File
JOIN Layouts l  ON l.L_UUID = ol.Source_UUID AND l.File_Name = ol.Source_File
LEFT JOIN portal_placements pp ON pp.File_Name = l.File_Name AND pp.Layout_ID = l.L_ID
WHERE ol.Link_Role = 'displays_field'
  AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file'))
  AND (getvariable('view') IS NULL OR getvariable('view') = '' OR l.Default_View = getvariable('view'))
GROUP BY l.Default_View, l.File_Name, l.L_UUID, l.L_Name, l.L_TO_Name
HAVING COUNT(DISTINCT ol.Target_UUID || '|' || COALESCE(ol.Target_File, '')) > 0
ORDER BY unstored_calc_fields DESC, l.File_Name, l.L_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
