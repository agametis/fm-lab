-- Object names that still carry the suffix FileMaker appends when something is
-- duplicated. Translated from fmCheckMate CopiedNames; the localised suffix
-- list is extensible and currently covers the English and German wording.
--
-- The numeric class (a name ending in a space and one to four digits) is what
-- FileMaker leaves behind on a second duplicate — but it is also how countless
-- deliberate names are built ("Address 2", "Report 2024"). Measured on a large
-- solution it outnumbers the copy suffixes roughly two to one, almost all of it
-- legitimate. It is therefore a separate class the chip bar switches to, and
-- not part of the default finding set.
WITH named AS (
    SELECT Object_UUID, Object_Type, Object_Name, File_Name
    FROM ObjectCatalog
    WHERE Object_Type IN ('Script', 'Field', 'Layout', 'CustomFunction', 'TableOccurrence',
                          'BaseTable', 'ValueList', 'CustomMenu', 'CustomMenuSet',
                          'ExternalDataSource', 'Account', 'PrivilegeSet', 'Folder')
      AND Object_Name IS NOT NULL
),
classified AS (
    SELECT *,
           CASE WHEN Object_Name LIKE '% Copy' OR Object_Name LIKE '% copy' OR Object_Name LIKE '% Kopie'
                THEN 'copy'
                WHEN regexp_matches(Object_Name, ' [0-9]{1,4}$') THEN 'numeric'
           END AS suffix_class
    FROM named
)
SELECT 'name-copied-suffix' AS rule_id, 'info' AS severity,
    c.File_Name AS file_name, c.Object_UUID AS nav_uuid,
    c.Object_Type AS object_type, c.Object_Name AS object_name,
    c.suffix_class,
    CASE WHEN c.suffix_class = 'copy'
         THEN 'Name still carries the suffix FileMaker adds when duplicating'
         ELSE 'Name ends in a number — possibly a duplicate that was never renamed'
    END AS message,
    row_number() OVER (ORDER BY c.File_Name, c.Object_Type, c.Object_Name) AS row_key
FROM classified c
WHERE c.suffix_class IS NOT NULL
  AND (getvariable('object_type') IS NULL OR c.Object_Type = getvariable('object_type'))
  AND (COALESCE(getvariable('suffix_kind'), 'copy') = 'all'
       OR c.suffix_class = COALESCE(getvariable('suffix_kind'), 'copy'))
  AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR c.Object_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
