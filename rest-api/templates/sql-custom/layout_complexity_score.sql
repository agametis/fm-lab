-- @template_type: report
-- @title: Layout complexity score
-- @description: Layouts ranked by a composite render-cost score built from what the catalog knows about each layout's initial load — object count, portals, tab/slide panels, hide-condition calculations, conditional-formatting conditions, displayed unstored calculations, related-field placements, container placements and script links. The weights are calibration choices, documented in the SQL and shown as raw component columns so every score stays recomputable. High values are not defects; they mark the layouts where the "expensive execution context" and "progressive disclosure" guidance from the WAN-first DevCon material pays off first. The min_score parameter sets the floor, default 200.
-- @icon: layout-dashboard
-- @category: Layouts
-- @display: table
-- @chip_filter: default_view
-- @params: file (optional), limit (optional, default 500), min_score (optional, default 200)
-- @click_action: openObject
-- @click_args: uuid={{_nav_uuid}}&type=Layout&file={{file_name}}
-- @output_format: file_name, layout_name, default_view, complexity_score, objects, portals, panels, hide_calcs, cf_conditions, unstored_fields, related_fields, containers, script_links, _message
-- @object_types: Layout
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "complex_layouts", "meaning": "Layouts at or above the complexity floor (inventory — a metric, not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: layouts, performance, wan, complexity, community-patterns
--
-- WEIGHTS (calibration choices, not source facts):
--   objects × 1, portals × 15, panels × 5, hide_calcs × 3, cf_conditions × 3,
--   unstored_fields × 4, related_fields × 2, containers × 5, script_links × 1.
-- Portals weigh heaviest: they multiply their contents per row. Related and
-- unstored placements are the per-record render costs the WAN guidance calls
-- out; containers can dominate transfers.
--
-- cf_conditions counts '<Condition type=' occurrences on LEAF objects only —
-- container XML nests its children's XML, an unfiltered count doubles the
-- inventory. related_fields is the v1 proxy for relationship depth: displayed
-- fields whose base table differs from the layout context's base table.
-- script_links counts triggers_script edges of the layout's OBJECTS (source
-- type pinned to LayoutObject): object-level triggers plus button actions —
-- both are per-object wiring the layout renders. Layout-/file-level trigger
-- mirrors (Source_Type Layout/File, converter 2.17.0) are deliberately NOT
-- counted: they are per-layout/per-file event handlers, not object load cost.
-- Folders and separators carry no Default_View and are excluded by the join
-- on real layouts.
WITH objs AS (
    SELECT lo.File_Name, lo.Layout_ID,
           CAST(count(*) AS INTEGER) AS objects,
           CAST(count(*) FILTER (WHERE lo.Object_Type = 'Portal') AS INTEGER) AS portals,
           CAST(count(*) FILTER (WHERE lo.Object_Type IN ('TabPanel', 'SlidePanel')) AS INTEGER) AS panels,
           CAST(count(*) FILTER (WHERE lo.Hide_Calculation_Text IS NOT NULL
                                 AND lo.Hide_Calculation_Text <> '') AS INTEGER) AS hide_calcs,
           CAST(COALESCE(sum(
               CASE WHEN NOT EXISTS (SELECT 1 FROM LayoutObjects c
                                     WHERE c.Parent_Object_ID = lo.Object_ID
                                       AND c.Layout_ID = lo.Layout_ID AND c.File_Name = lo.File_Name)
                    THEN len(regexp_extract_all(lo.Object_XML, '<Condition type='))
                    ELSE 0 END), 0) AS INTEGER) AS cf_conditions
    FROM LayoutObjects lo
    GROUP BY 1, 2
),
placements AS (
    SELECT lo.File_Name, lo.Layout_ID,
           CAST(count(*) FILTER (WHERE f.Field_Type = 'Calculated'
                                 AND COALESCE(f.Storage_StoreCalcResults, FALSE) = FALSE) AS INTEGER) AS unstored_fields,
           CAST(count(*) FILTER (WHERE f.Data_Type = 'Binary') AS INTEGER) AS containers,
           CAST(count(*) FILTER (WHERE toc.BT_UUID IS NOT NULL
                                 AND f.Table_UUID <> toc.BT_UUID) AS INTEGER) AS related_fields
    FROM ObjectLinks ol
    JOIN ObjectCatalog src ON ol.Source_UUID = src.Object_UUID AND src.Object_Type = 'LayoutObject'
    JOIN LayoutObjects lo ON src.Object_UUID = lo.Object_UUID
    JOIN FieldsForTables f ON ol.Target_UUID = f.Field_UUID
    JOIN Layouts l ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
    LEFT JOIN TableOccurrenceCatalog toc ON l.L_TO_UUID = toc.TO_UUID
    WHERE ol.Link_Role = 'displays_field'
    GROUP BY 1, 2
),
script_links AS (
    SELECT lo.File_Name, lo.Layout_ID, CAST(count(*) AS INTEGER) AS script_links
    FROM ObjectLinks ol
    JOIN ObjectCatalog src ON ol.Source_UUID = src.Object_UUID AND src.Object_Type = 'LayoutObject'
    JOIN LayoutObjects lo ON src.Object_UUID = lo.Object_UUID
    WHERE ol.Link_Role = 'triggers_script'
    GROUP BY 1, 2
)
SELECT
    l.File_Name AS file_name,
    l.L_UUID AS _nav_uuid,
    l.L_Name AS layout_name,
    l.Default_View AS default_view,
    o.objects * 1 + o.portals * 15 + o.panels * 5 + o.hide_calcs * 3 + o.cf_conditions * 3
      + COALESCE(p.unstored_fields, 0) * 4 + COALESCE(p.related_fields, 0) * 2
      + COALESCE(p.containers, 0) * 5 + COALESCE(s.script_links, 0) * 1 AS complexity_score,
    o.objects, o.portals, o.panels, o.hide_calcs, o.cf_conditions,
    COALESCE(p.unstored_fields, 0) AS unstored_fields,
    COALESCE(p.related_fields, 0) AS related_fields,
    COALESCE(p.containers, 0) AS containers,
    COALESCE(s.script_links, 0) AS script_links,
    o.objects || ' objects, ' || o.portals || ' portal(s), '
      || COALESCE(p.unstored_fields, 0) || ' unstored, '
      || COALESCE(p.related_fields, 0) || ' related field placement(s)' AS _message
FROM Layouts l
JOIN ObjectCatalog oc ON l.L_UUID = oc.Object_UUID AND oc.Object_Type = 'Layout'
JOIN objs o ON o.File_Name = l.File_Name AND o.Layout_ID = l.L_ID
LEFT JOIN placements p ON p.File_Name = l.File_Name AND p.Layout_ID = l.L_ID
LEFT JOIN script_links s ON s.File_Name = l.File_Name AND s.Layout_ID = l.L_ID
WHERE o.objects * 1 + o.portals * 15 + o.panels * 5 + o.hide_calcs * 3 + o.cf_conditions * 3
      + COALESCE(p.unstored_fields, 0) * 4 + COALESCE(p.related_fields, 0) * 2
      + COALESCE(p.containers, 0) * 5 + COALESCE(s.script_links, 0) * 1
      >= CAST(COALESCE(getvariable('min_score'), '200') AS INTEGER)
  AND (getvariable('default_view') IS NULL OR l.Default_View = getvariable('default_view'))
  AND (getvariable('file') IS NULL OR l.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY complexity_score DESC, file_name, layout_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
