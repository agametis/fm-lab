-- @template_type: report
-- @description: Externe Datenquellen — gruppiert nach Ziel + Typ, inklusive TO-Anzahl und einer Sample-TO-UUID für direkte Navigation zum TableOccurrence-Detail.
-- @params: file (optional), limit (optional, default 30)

WITH ds AS (
    SELECT
        DS_Name,
        DS_Type,
        DS_UUID,
        File_Name,
        Path
    FROM ExternalDataSourceCatalog
    WHERE (getvariable('file') IS NULL OR File_Name = getvariable('file'))
),
to_per_ds AS (
    -- TOs werden über DS_UUID (gleiche Datei) bzw. DS_Name (Cross-File-Fallback)
    -- mit der Quelle verknüpft. arg_min liefert eine deterministische Sample-TO
    -- (alphabetisch erste), damit der Klick aus dem Dashboard reproduzierbar
    -- zum selben TO-Detail springt.
    SELECT
        ds.DS_Name,
        ds.DS_Type,
        COUNT(DISTINCT t.TO_UUID)                              AS to_count,
        arg_min(t.TO_UUID, t.TO_Name)                          AS sample_to_uuid,
        arg_min(t.TO_Name, t.TO_Name)                          AS sample_to_name
    FROM ds
    LEFT JOIN TableOccurrenceCatalog t
      ON (t.DS_UUID = ds.DS_UUID AND t.File_Name = ds.File_Name)
      OR (t.DS_UUID IS NULL AND t.DS_Name = ds.DS_Name AND t.File_Name = ds.File_Name)
    GROUP BY ds.DS_Name, ds.DS_Type
)
SELECT
    ds.DS_Name                       AS name,
    ds.DS_Type                       AS type,
    COUNT(*)                         AS used_in_files,
    COALESCE(MAX(tpd.to_count), 0)   AS to_count,
    MIN(ds.Path)                     AS path_sample,
    arg_min(tpd.sample_to_uuid, ds.File_Name) AS sample_to_uuid,
    arg_min(tpd.sample_to_name, ds.File_Name) AS sample_to_name
FROM ds
LEFT JOIN to_per_ds tpd
  ON tpd.DS_Name = ds.DS_Name AND tpd.DS_Type = ds.DS_Type
GROUP BY ds.DS_Name, ds.DS_Type
ORDER BY used_in_files DESC, to_count DESC, ds.DS_Name
LIMIT CAST(COALESCE(getvariable('limit'), '30') AS INTEGER);
