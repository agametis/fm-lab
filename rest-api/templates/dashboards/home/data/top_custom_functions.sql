-- @template_type: report
-- @description: CustomFunctions mit den meisten operativen Verweisen (über ObjectLinks).
-- @params: limit (optional, default 10), file (optional)

SELECT
    cf.CF_UUID                AS uuid,
    cf.CF_Name                AS name,
    cf.File_Name              AS file,
    COUNT(ol.Source_UUID)     AS reference_count
FROM CustomFunctionsCatalog cf
LEFT JOIN ObjectLinks ol
       ON ol.Target_UUID = cf.CF_UUID
      AND ol.Link_Type   = 'operational'
WHERE (getvariable('file') IS NULL OR cf.File_Name = getvariable('file'))
GROUP BY ALL
ORDER BY reference_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '10') AS INTEGER);
