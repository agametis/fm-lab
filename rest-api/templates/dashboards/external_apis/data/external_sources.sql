-- @template_type: report
-- @description: Externe Datenquellen (ExternalDataSourceCatalog) — gruppiert nach Ziel + Typ.
-- @params: file (optional), limit (optional, default 30)

SELECT
    DS_Name                  AS name,
    DS_Type                  AS type,
    COUNT(*)                 AS used_in_files,
    MIN(Path)                AS path_sample
FROM ExternalDataSourceCatalog
WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
GROUP BY DS_Name, DS_Type
ORDER BY used_in_files DESC, DS_Name
LIMIT CAST(COALESCE(getvariable('limit'), '30') AS INTEGER);
