-- @template_type: object
-- @title: Top custom functions
-- @description: Custom functions with the most operational references (via ObjectLinks).
-- @icon: function
-- @category: Top
-- @display: table
-- @params: limit (optional, default 100), file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}&type=CustomFunction
-- @output_format: uuid, name, type, file, reference_count
-- @author: fm-lab core
-- @version: 1.0
-- @tags: custom-functions, top, ranking

SELECT
    cf.CF_UUID                AS uuid,
    cf.CF_Name                AS name,
    'CustomFunction'          AS type,
    cf.File_Name              AS file,
    COUNT(ol.Source_UUID)     AS reference_count
FROM CustomFunctionsCatalog cf
LEFT JOIN ObjectLinks ol
       ON ol.Target_UUID = cf.CF_UUID
      AND ol.Link_Type   = 'operational'
WHERE (getvariable('file') IS NULL OR cf.File_Name = getvariable('file'))
GROUP BY ALL
ORDER BY reference_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '100') AS INTEGER);
