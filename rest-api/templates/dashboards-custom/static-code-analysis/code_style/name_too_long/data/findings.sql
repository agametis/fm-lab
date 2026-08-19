-- Object names beyond a readable length, and names sitting exactly on
-- FileMaker's 100-character ceiling. Translated from fmCheckMate NamesTooLong —
-- but recalibrated: the source's fixed limit is not a useful detector here,
-- because FileMaker enforces the 100-character ceiling itself, so a name can
-- never exceed it. What is worth reporting instead is a configurable
-- readability threshold (max_len, default 80) plus the names that landed
-- exactly on 100 characters, which is where FileMaker silently truncated what
-- the developer typed.
WITH named AS (
    SELECT Object_UUID, Object_Type, Object_Name, File_Name, length(Object_Name) AS name_length
    FROM ObjectCatalog
    WHERE Object_Type IN ('Script', 'Field', 'Layout', 'CustomFunction', 'TableOccurrence',
                          'BaseTable', 'ValueList', 'CustomMenu', 'CustomMenuSet',
                          'ExternalDataSource', 'Account', 'PrivilegeSet', 'Folder')
      AND Object_Name IS NOT NULL
)
SELECT 'name-too-long' AS rule_id,
    CASE WHEN n.name_length >= 100 THEN 'warning' ELSE 'info' END AS severity,
    n.File_Name AS file_name, n.Object_UUID AS nav_uuid,
    n.Object_Type AS object_type, n.Object_Name AS object_name,
    n.name_length,
    CASE WHEN n.name_length >= 100 THEN 'at-limit' ELSE 'too-long' END AS defect,
    CASE WHEN n.name_length >= 100
         THEN 'Name is at FileMaker''s 100-character ceiling and may have been truncated'
         ELSE 'Name is longer than ' || CAST(COALESCE(getvariable('max_len'), '80') AS INTEGER) || ' characters'
    END AS message,
    row_number() OVER (ORDER BY n.name_length DESC, n.File_Name, n.Object_Name) AS row_key
FROM named n
WHERE n.name_length > CAST(COALESCE(getvariable('max_len'), '80') AS INTEGER)
  AND (getvariable('object_type') IS NULL OR n.Object_Type = getvariable('object_type'))
  AND (getvariable('defect') IS NULL
       OR (CASE WHEN n.name_length >= 100 THEN 'at-limit' ELSE 'too-long' END) = getvariable('defect'))
  AND (getvariable('file') IS NULL OR n.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR n.Object_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
