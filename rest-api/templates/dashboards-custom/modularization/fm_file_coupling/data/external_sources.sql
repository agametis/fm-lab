-- @template_type: report
-- @description: Externe FileMaker-Datenquellen — welche Datei bindet welche andere Datei als Datenquelle ein (deklarative Kopplung, unabhängig vom tatsächlichen Objekt-Verkehr). Mit TO-Anzahl und Sample-TO für Navigation.
-- @params: file (optional), limit (optional, default 40)

WITH ds AS (
    SELECT DS_Name, DS_Type, DS_UUID, File_Name
    FROM ExternalDataSourceCatalog
    WHERE DS_Type = 'FileMaker'
      AND (getvariable('file') IS NULL OR File_Name = getvariable('file'))
),
to_per_ds AS (
    SELECT
        ds.DS_Name,
        ds.File_Name,
        COUNT(DISTINCT t.TO_UUID)             AS to_count,
        arg_min(t.TO_UUID, t.TO_Name)         AS sample_to_uuid,
        arg_min(t.TO_Name, t.TO_Name)         AS sample_to_name
    FROM ds
    LEFT JOIN TableOccurrenceCatalog t
      ON (t.DS_UUID = ds.DS_UUID AND t.File_Name = ds.File_Name)
      OR (t.DS_UUID IS NULL AND t.DS_Name = ds.DS_Name AND t.File_Name = ds.File_Name)
    GROUP BY ds.DS_Name, ds.File_Name
)
SELECT
    ds.File_Name                              AS from_file,
    ds.DS_Name                                AS to_source,
    COALESCE(MAX(tpd.to_count), 0)            AS to_count,
    arg_min(tpd.sample_to_uuid, ds.DS_Name)  AS sample_to_uuid,
    arg_min(tpd.sample_to_name, ds.DS_Name)  AS sample_to_name
FROM ds
LEFT JOIN to_per_ds tpd ON tpd.DS_Name = ds.DS_Name AND tpd.File_Name = ds.File_Name
GROUP BY ds.File_Name, ds.DS_Name
ORDER BY ds.File_Name, to_count DESC, ds.DS_Name
LIMIT CAST(COALESCE(getvariable('limit'), '40') AS INTEGER);
