-- Object names that start or end with whitespace. The space is invisible in
-- every list FileMaker shows, but it is part of the name: name-based access
-- (Perform Script by Name, Go to Layout by name, SQL against a table name) has
-- to reproduce it exactly, and two names that look identical sort apart.
-- Translated from fmCheckMate SpaceAtEnd, widened to leading whitespace.
--
-- The object types are the user-named schema objects. Deliberately left out:
-- layout objects and variables (covered by their own rules), relationships
-- (FileMaker derives the name from the two table occurrences) and the internal
-- catalog entries that carry synthesised names. Names that are entirely
-- whitespace are separators, not findings.
WITH named AS (
    SELECT Object_UUID, Object_Type, Object_Name, File_Name
    FROM ObjectCatalog
    WHERE Object_Type IN ('Script', 'Field', 'Layout', 'CustomFunction', 'TableOccurrence',
                          'BaseTable', 'ValueList', 'CustomMenu', 'CustomMenuSet',
                          'ExternalDataSource', 'Account', 'PrivilegeSet', 'Folder')
      AND Object_Name IS NOT NULL AND trim(Object_Name) <> ''
)
SELECT 'name-trailing-whitespace' AS rule_id, 'warning' AS severity,
    n.File_Name AS file_name, n.Object_UUID AS nav_uuid,
    n.Object_Type AS object_type, n.Object_Name AS object_name,
    '[' || n.Object_Name || ']' AS name_shown,
    CASE WHEN regexp_matches(n.Object_Name, '^[ \t]') AND regexp_matches(n.Object_Name, '[ \t]$') THEN 'both'
         WHEN regexp_matches(n.Object_Name, '^[ \t]') THEN 'leading'
         ELSE 'trailing' END AS defect,
    CASE WHEN regexp_matches(n.Object_Name, '^[ \t]') AND regexp_matches(n.Object_Name, '[ \t]$')
           THEN 'Name starts and ends with whitespace'
         WHEN regexp_matches(n.Object_Name, '^[ \t]')
           THEN 'Name starts with whitespace'
         ELSE 'Name ends with whitespace' END AS message,
    row_number() OVER (ORDER BY n.File_Name, n.Object_Type, n.Object_Name) AS row_key
FROM named n
WHERE n.Object_Name <> trim(n.Object_Name)
  AND (getvariable('defect') IS NULL OR
       CASE WHEN regexp_matches(n.Object_Name, '^[ \t]') AND regexp_matches(n.Object_Name, '[ \t]$') THEN 'both'
            WHEN regexp_matches(n.Object_Name, '^[ \t]') THEN 'leading'
            ELSE 'trailing' END = getvariable('defect'))
  AND (getvariable('file') IS NULL OR n.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR n.Object_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
