-- @template_type: report
-- @description: Plugin-Abhängigkeit je Komponente — Call-Sites, verschiedene Funktionen und betroffene Dateien pro MBS-Komponente (bzw. sonstigem Plugin). Zeigt, welche Module ohne Plugin tot wären. Klick auf eine Zeile filtert die Funktions-Liste.
-- @params: file (optional), limit (optional, default 100)

WITH calls AS (
    SELECT
        src.File_Name                                             AS file,
        CASE WHEN tc.Object_Name LIKE 'MBS:%' THEN 'MBS' ELSE 'Other' END AS plugin,
        CASE WHEN tc.Object_Name LIKE 'MBS:%'
             THEN regexp_extract(tc.Object_Name, '(?i)MBS:([A-Za-z]+)\.', 1)
             ELSE 'Other' END                                     AS component,
        tc.Object_Name                                            AS fn
    FROM ObjectLinks ol
    JOIN ObjectCatalog tc ON ol.Target_UUID = tc.Object_UUID AND tc.File_Name IS NOT DISTINCT FROM ol.Target_File
    JOIN ObjectCatalog src ON ol.Source_UUID = src.Object_UUID AND src.File_Name = ol.Source_File
    WHERE ol.Link_Role = 'calls_pluginfunction'
      AND (getvariable('file') IS NULL OR src.File_Name = getvariable('file'))
)
SELECT
    plugin,
    component,
    COUNT(*)                          AS callsites,
    COUNT(DISTINCT fn)                AS functions,
    COUNT(DISTINCT file)             AS files
FROM calls
GROUP BY plugin, component
ORDER BY callsites DESC
LIMIT CAST(COALESCE(getvariable('limit'), '100') AS INTEGER);
