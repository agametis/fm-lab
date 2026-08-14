-- @template_type: report
-- @description: Every catalog occurrence of a UUID that exists in more than one file of the solution (clone collisions). Duplicate detection is always solution-wide; the file/scope params filter the listed occurrences only.
-- @params: file (optional), scope_uuids (optional), limit (optional, default 500)
-- keep in sync with data/summary.sql (shared dup CTE + outer filters)
-- Params are normalised ONCE here ('' and NULL both mean "no filter"); each
-- getvariable appears exactly once so the M5a copy-sync check stays green.
WITH params AS (
    SELECT NULLIF(CAST(getvariable('file') AS VARCHAR), '') AS file_filter,
           NULLIF(CAST(getvariable('scope_uuids') AS VARCHAR), '') AS scope_csv
),
dup AS (
    SELECT Object_UUID,
           COUNT(*) AS occurrences,
           COUNT(DISTINCT File_Name) AS file_count,
           COUNT(DISTINCT Object_Type) AS type_count
    FROM ObjectCatalog
    WHERE Object_UUID IS NOT NULL
      AND File_Name IS NOT NULL
      -- Native FileMaker UUIDs only (8-4-4-4-12). FM-Lab's synthetic identities
      -- (md5 variables/builtins/plugin components, rel_/part_/paste_ prefixes) are
      -- tool-internal and partly global by design - not solution metadata defects.
      AND regexp_matches(Object_UUID, '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')
    GROUP BY Object_UUID
    HAVING COUNT(DISTINCT File_Name) > 1
)
SELECT
    'uuid-clone-collision' AS rule_id,
    'warning' AS severity,
    oc.Object_UUID AS nav_uuid,
    oc.Object_Type AS type,
    oc.Object_Name AS name,
    oc.File_Name AS file,
    d.file_count,
    d.occurrences,
    CASE WHEN d.type_count > 1 THEN 'type conflict' ELSE '' END AS type_conflict,
    row_number() OVER (ORDER BY d.file_count DESC, oc.Object_UUID, oc.File_Name) AS row_key
FROM ObjectCatalog oc
JOIN dup d USING (Object_UUID)
CROSS JOIN params p
WHERE (p.file_filter IS NULL OR oc.File_Name = p.file_filter)
  AND (p.scope_csv IS NULL
       OR oc.Object_UUID IN (SELECT unnest(string_split(p.scope_csv, ','))))
ORDER BY d.file_count DESC, oc.Object_UUID, oc.File_Name
LIMIT CAST(COALESCE(NULLIF(CAST(getvariable('limit') AS VARCHAR), ''), '500') AS INTEGER);
