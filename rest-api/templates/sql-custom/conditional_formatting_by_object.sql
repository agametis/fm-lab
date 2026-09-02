-- @template_type: report
-- @title: Conditional formatting by object
-- @description: Every layout object that carries conditional formatting, one row per object with the number of rules and how many of them are enabled. The per-rule companion "Conditional formatting inventory" shows each condition with its formula and CSS; this grouped variant surfaces the rule-heavy objects and the ones whose rules are switched off — disabled rules are invisible in the layout yet still cost evaluation review time.
-- @icon: palette
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
-- @output_format: file_name, layout_name, object_type, object_name, conditions_count, conditions_active, _message, _chip_facets, _row_total
-- @object_types: Layout
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "objects", "meaning": "Layout objects carrying conditional formatting in scope (inventory — not a defect count)" }
-- @author: fm-lab core
-- @version: 1.1
-- @tags: layouts, formatting, styling, inventory
--
-- Two click targets: the row click opens the layout-object detail view
-- (object UUID primary, layout as ref); the arrow button at the end of the
-- row (`@row_action`) jumps to the object in the rendered layout.
--
-- Reads LayoutObjectConditions, the parsed rule catalog (one row per
-- conditional-formatting rule, anchored to the owning object at import) —
-- never the raw Object_XML. Unlike an XML extraction with a leaf filter,
-- the catalog also attributes rules on containers that have children
-- (e.g. a tab panel with its own conditions), so the object set here can
-- be slightly larger than the per-rule inventory's.
--
-- A rule is active when bit 0 (ENABLE) of Options_Raw is set; the style
-- toggles of the rule live elsewhere and do not affect this flag.
--
-- The object-type chips switch SERVER-SIDE (`@chip_param: object_type`) over
-- the whole scope. `_chip_facets` counts over `base` — every filter EXCEPT the
-- object type itself, otherwise each chip would only ever show its own
-- selection — while `_row_total` counts over `sel`, i.e. WITH that filter, so
-- the header names the truncation and only then.
WITH base AS (
    SELECT
        loc.File_Name AS file_name,
        ly.L_UUID AS _nav_uuid,
        ly.L_Name AS layout_name,
        lo.Object_Type AS object_type,
        COALESCE(NULLIF(trim(lo.Object_Name), ''), '(unnamed)') AS object_name,
        count(*) AS conditions_count,
        sum(CASE WHEN (loc.Options_Raw & 1) = 1 THEN 1 ELSE 0 END) AS conditions_active,
        lo.Object_Type || ' ' || COALESCE(NULLIF(trim(lo.Object_Name), ''), '(unnamed)')
          || ' — ' || count(*) || ' condition' || CASE WHEN count(*) = 1 THEN '' ELSE 's' END
          || ' (' || sum(CASE WHEN (loc.Options_Raw & 1) = 1 THEN 1 ELSE 0 END) || ' active)' AS _message,
        loc.Object_UUID AS _object_uuid
    FROM LayoutObjectConditions loc
    JOIN LayoutObjects lo ON loc.Object_UUID = lo.Object_UUID
    JOIN Layouts ly ON loc.Layout_ID = ly.L_ID AND loc.File_Name = ly.File_Name
    WHERE (getvariable('file') IS NULL OR loc.File_Name = getvariable('file'))
      AND (getvariable('scope_uuids') IS NULL
           OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
    GROUP BY loc.File_Name, ly.L_UUID, ly.L_Name, lo.Object_Type,
             lo.Object_Name, loc.Object_UUID
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
ORDER BY conditions_count DESC, file_name, layout_name, object_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
