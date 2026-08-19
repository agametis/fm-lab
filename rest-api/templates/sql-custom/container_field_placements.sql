-- @template_type: report
-- @title: Container field placements
-- @description: Inventory of container fields placed on layouts, with the display context that drives their transfer cost — list-view layouts and portals repeat the container per visible row. Whether a placement should show a thumbnail instead of the full container is not statically decidable (image scaling and storage options are not exported), so this is deliberately an inventory, not a rule. Pattern source: DevCon WAN-first guidance on large containers and thumbnails.
-- @icon: image
-- @category: Layouts
-- @display: table
-- @chip_filter: context
-- @params: file (optional), limit (optional, default 500)
-- @click_action: openObject
-- @click_args: uuid={{_layout_uuid}}&type=Layout&file={{file_name}}&ref={{_object_uuid}}
-- @output_format: file_name, layout_name, table_name, field_name, default_view, context, _message
-- @object_types: Layout
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "container_placements", "meaning": "Container field placements on layouts (inventory)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: layouts, containers, performance, wan, community-patterns
--
-- Containers are Data_Type = 'Binary' — the catalog has no 'Container'
-- vocabulary. Context classes: 'portal' (the placement sits inside a portal,
-- repeated per row), 'list' (list-view layout, repeated per record), 'form'
-- (everything else). The row click opens the layout with the placement
-- highlighted.
SELECT
    lo.File_Name AS file_name,
    l.L_UUID AS _layout_uuid,
    lo.Object_UUID AS _object_uuid,
    l.L_Name AS layout_name,
    f.Table_Name AS table_name,
    f.Field_Name AS field_name,
    l.Default_View AS default_view,
    CASE WHEN par.Object_Type = 'Portal' THEN 'portal'
         WHEN l.Default_View = 'List' THEN 'list'
         ELSE 'form' END AS context,
    'Container "' || f.Field_Name || '" on layout "' || l.L_Name || '"'
      || CASE WHEN par.Object_Type = 'Portal' THEN ' inside a portal'
              WHEN l.Default_View = 'List' THEN ' on a list-view layout'
              ELSE '' END AS _message
FROM ObjectLinks ol
JOIN ObjectCatalog src ON ol.Source_UUID = src.Object_UUID AND src.Object_Type = 'LayoutObject'
JOIN LayoutObjects lo ON src.Object_UUID = lo.Object_UUID
JOIN FieldsForTables f ON ol.Target_UUID = f.Field_UUID AND f.Data_Type = 'Binary'
JOIN Layouts l ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
LEFT JOIN LayoutObjects par
       ON lo.Parent_Object_ID = par.Object_ID AND lo.Layout_ID = par.Layout_ID AND lo.File_Name = par.File_Name
WHERE ol.Link_Role = 'displays_field'
  AND (getvariable('context') IS NULL
       OR getvariable('context') = CASE WHEN par.Object_Type = 'Portal' THEN 'portal'
                                        WHEN l.Default_View = 'List' THEN 'list'
                                        ELSE 'form' END)
  AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR l.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY CASE WHEN par.Object_Type = 'Portal' THEN 0 WHEN l.Default_View = 'List' THEN 1 ELSE 2 END,
         file_name, layout_name, field_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
