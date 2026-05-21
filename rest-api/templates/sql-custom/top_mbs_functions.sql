-- @template_type: object
-- @title: Top MBS Plugin functions
-- @description: MBS Plugin functions with the most operational call sites.
-- @icon: plugin
-- @category: Top
-- @display: table
-- @params: limit (optional, default 100), file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}&type=PluginFunction
-- @output_format: uuid, name, type, call_count, file_count
-- @author: fm-lab core
-- @version: 1.0
-- @tags: mbs, plugin, top, ranking
-- @note: PluginFunctions are synthetic ObjectCatalog entries without a home file
--        (Object_Name = 'MBS::<Category>.<Function>'). Callers come from
--        ObjectLinks (calls_pluginfunction). When the dashboard-wide file filter
--        is active, only callers from that file are counted; functions without
--        any matching caller are hidden.

WITH calls AS (
    SELECT
        ol.Target_UUID,
        oc_src.File_Name AS source_file
    FROM ObjectLinks ol
    JOIN ObjectCatalog oc_src ON ol.Source_UUID = oc_src.Object_UUID
    WHERE ol.Link_Role = 'calls_pluginfunction'
      AND (getvariable('file') IS NULL OR oc_src.File_Name = getvariable('file'))
)
SELECT
    oc.Object_UUID                              AS uuid,
    oc.Object_Name                              AS name,
    'PluginFunction'                            AS type,
    COUNT(c.Target_UUID)                        AS call_count,
    COUNT(DISTINCT c.source_file)               AS file_count
FROM ObjectCatalog oc
LEFT JOIN calls c ON c.Target_UUID = oc.Object_UUID
WHERE oc.Object_Type = 'PluginFunction'
  AND oc.Object_Name LIKE 'MBS::%'
GROUP BY ALL
HAVING COUNT(c.Target_UUID) > 0
ORDER BY call_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '100') AS INTEGER);
