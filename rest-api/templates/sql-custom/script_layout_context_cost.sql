-- @template_type: report
-- @title: Script layout-context cost
-- @description: Script → layout pairs ranked by how expensive the navigated-to layout is to render. Processing scripts that hop across heavy user layouts pay that layout's render cost on every run — the classic fix is a minimal utility layout on the same table occurrence. The layout cost re-uses the complexity components (objects, portals, unstored and related placements); the min_objects parameter keeps trivial targets out, default 100. Pattern source: Claris layout best practices and the WAN-first DevCon guidance on lightweight processing layouts.
-- @icon: route
-- @category: Scripts
-- @display: table
-- @params: file (optional), limit (optional, default 500), min_objects (optional, default 100)
-- @click_action: openObject
-- @click_args: uuid={{_nav_uuid}}&type=Script&file={{file_name}}
-- @output_format: file_name, script_name, layout_name, layout_file, objects, portals, unstored_fields, related_fields, _message
-- @object_types: Script
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "heavy_context_hops", "meaning": "Script→layout navigations whose target is at or above the object floor (inventory — a metric, not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: scripts, layouts, performance, wan, community-patterns
--
-- The pairs come from the resolved navigates_to_layout edges (no XML
-- parsing). Go to Layout ["original layout"] and calculated layout targets
-- carry no edge and are correctly absent. The cost columns are the raw
-- components, not the weighted score — a utility-layout decision needs the
-- ingredients, not the blend.
WITH layout_cost AS (
    SELECT l.File_Name, l.L_ID, l.L_UUID, l.L_Name,
           CAST(count(lo.Object_UUID) AS INTEGER) AS objects,
           CAST(count(*) FILTER (WHERE lo.Object_Type = 'Portal') AS INTEGER) AS portals
    FROM Layouts l
    JOIN ObjectCatalog oc ON l.L_UUID = oc.Object_UUID AND oc.Object_Type = 'Layout'
    LEFT JOIN LayoutObjects lo ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
    GROUP BY 1, 2, 3, 4
),
field_cost AS (
    SELECT lo.File_Name, lo.Layout_ID,
           CAST(count(*) FILTER (WHERE f.Field_Type = 'Calculated'
                                 AND COALESCE(f.Storage_StoreCalcResults, FALSE) = FALSE) AS INTEGER) AS unstored_fields,
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
)
SELECT
    s.File_Name AS file_name,
    s.Object_UUID AS _nav_uuid,
    s.Object_Name AS script_name,
    lc.L_Name AS layout_name,
    lc.File_Name AS layout_file,
    lc.objects,
    lc.portals,
    COALESCE(fc.unstored_fields, 0) AS unstored_fields,
    COALESCE(fc.related_fields, 0) AS related_fields,
    'Navigates to "' || lc.L_Name || '" (' || lc.objects || ' objects, ' || lc.portals
      || ' portal(s), ' || COALESCE(fc.unstored_fields, 0) || ' unstored)' AS _message
FROM ObjectLinks ol
JOIN ObjectCatalog s ON ol.Source_UUID = s.Object_UUID AND s.Object_Type = 'Script'
JOIN ObjectCatalog t ON ol.Target_UUID = t.Object_UUID AND t.Object_Type = 'Layout'
JOIN layout_cost lc ON lc.L_UUID = t.Object_UUID
LEFT JOIN field_cost fc ON fc.File_Name = lc.File_Name AND fc.Layout_ID = lc.L_ID
WHERE ol.Link_Role = 'navigates_to_layout'
  AND lc.objects >= CAST(COALESCE(getvariable('min_objects'), '100') AS INTEGER)
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR s.Object_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY lc.objects DESC, file_name, script_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
