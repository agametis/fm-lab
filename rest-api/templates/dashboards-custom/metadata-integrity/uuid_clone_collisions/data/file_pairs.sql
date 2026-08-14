-- @template_type: report
-- @description: File pairs sharing native UUIDs (which file is a clone of which), with overlap percentages relative to each file's native-UUID population. Logic adopted from quality check T4-C1.
-- @params: file (optional), scope_uuids (optional), limit (optional, default 100)
WITH params AS (
    SELECT NULLIF(CAST(getvariable('file') AS VARCHAR), '') AS file_filter,
           NULLIF(CAST(getvariable('scope_uuids') AS VARCHAR), '') AS scope_csv
),
native AS (
    SELECT Object_UUID, File_Name
    FROM ObjectCatalog
    CROSS JOIN params p
    WHERE Object_UUID IS NOT NULL
      AND File_Name IS NOT NULL
      -- Native FileMaker UUIDs only (8-4-4-4-12), same base population as data/findings.sql.
      AND regexp_matches(Object_UUID, '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')
      AND (p.scope_csv IS NULL
           OR Object_UUID IN (SELECT unnest(string_split(p.scope_csv, ','))))
),
pairs AS (
    SELECT a.File_Name AS file_a, b.File_Name AS file_b, COUNT(*) AS shared_uuids
    FROM native a
    JOIN native b
      ON a.Object_UUID = b.Object_UUID AND a.File_Name < b.File_Name
    GROUP BY 1, 2
)
SELECT file_a, file_b, shared_uuids,
       ROUND(100.0 * shared_uuids /
             (SELECT COUNT(*) FROM native WHERE File_Name = file_a), 1) AS pct_of_a,
       ROUND(100.0 * shared_uuids /
             (SELECT COUNT(*) FROM native WHERE File_Name = file_b), 1) AS pct_of_b,
       file_a || ' + ' || file_b AS row_key
FROM pairs
CROSS JOIN params p
WHERE shared_uuids > 0
  AND (p.file_filter IS NULL OR file_a = p.file_filter OR file_b = p.file_filter)
ORDER BY shared_uuids DESC
LIMIT CAST(COALESCE(NULLIF(CAST(getvariable('limit') AS VARCHAR), ''), '100') AS INTEGER);
