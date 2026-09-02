-- @template_type: report
-- @title: Tooltip inventory
-- @description: Every layout object that carries a tooltip, with the tooltip expression side by side. A tooltip slot holds a calculation — a static text arrives as a quoted literal — and is invisible in Layout mode, so this inventory is where stale hints, duplicated texts and calculations referencing retired fields become readable next to each other.
-- @icon: layout
-- @category: Layouts
-- @display: table
-- @chip_filter: object_type
-- @chip_param: object_type
-- @params: file (optional), limit (optional, default 500), object_type (optional)
-- @click_action: openObject
-- @click_args: uuid={{_object_uuid}}&ref={{_nav_uuid}}&file={{file_name}}
-- @row_action: openObject
-- @row_action_args: uuid={{_nav_uuid}}&type=Layout&file={{file_name}}&ref={{_object_uuid}}
-- @row_action_label: Show in layout
-- @output_format: file_name, layout_name, object_type, object_name, tooltip_calc, _message, _chip_facets, _row_total
-- @object_types: Layout
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "tooltips", "meaning": "Layout objects with a tooltip in scope (inventory — not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: layouts, tooltip, inventory
--
-- Companion of the conditional-formatting inventory: same shape, same scope
-- model, one row per carrying object. The presence predicate mirrors the
-- layout-canvas payload (NULLIF(Tooltip_Calculation_Text, '') IS NOT NULL, no
-- trim) so the layout view's "Tooltip" chip counter and this inventory always
-- agree for a layout scope.
--
-- The object-type chips switch SERVER-SIDE (`@chip_param: object_type`) over
-- the whole scope. `_chip_facets` counts over `base` — every filter EXCEPT the
-- object type itself — while `_row_total` counts over `sel` (WITH that filter),
-- so the header names the truncation and only then.
WITH base AS (
    SELECT
        lo.File_Name AS file_name,
        ly.L_UUID AS _nav_uuid,
        ly.L_Name AS layout_name,
        lo.Object_Type AS object_type,
        COALESCE(NULLIF(trim(lo.Object_Name), ''), '(unnamed)') AS object_name,
        replace(lo.Tooltip_Calculation_Text, chr(10), ' ') AS tooltip_calc,
        lo.Object_Type || ' ' || COALESCE(NULLIF(trim(lo.Object_Name), ''), '(unnamed)')
          || ' — tooltip '
          || replace(lo.Tooltip_Calculation_Text, chr(10), ' ') AS _message,
        lo.Object_UUID AS _object_uuid
    FROM LayoutObjects lo
    JOIN Layouts ly ON lo.Layout_ID = ly.L_ID AND lo.File_Name = ly.File_Name
    WHERE NULLIF(lo.Tooltip_Calculation_Text, '') IS NOT NULL
      AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
      AND (getvariable('scope_uuids') IS NULL
           OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
),
sel AS (
    SELECT * FROM base
    WHERE (getvariable('object_type') IS NULL OR object_type = getvariable('object_type'))
)
SELECT s.*,
    (SELECT json_group_object(object_type, n)
       FROM (SELECT object_type, count(*) AS n FROM base GROUP BY 1)) AS _chip_facets,
    (SELECT count(*) FROM sel) AS _row_total
FROM sel s
ORDER BY file_name, layout_name, object_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
