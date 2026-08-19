-- Object names wrapped in literal double quotes — almost always the result of
-- pasting a name that was copied out of a calculation. The quotes become part
-- of the name, so every name-based access has to escape them. Generalised from
-- the fmCheckMate layout-object check to the user-named schema objects.
WITH named AS (
    SELECT Object_UUID, Object_Type, Object_Name, File_Name
    FROM ObjectCatalog
    WHERE Object_Type IN ('Script', 'Field', 'Layout', 'CustomFunction', 'TableOccurrence',
                          'BaseTable', 'ValueList', 'CustomMenu', 'CustomMenuSet',
                          'ExternalDataSource', 'Account', 'PrivilegeSet', 'Folder')
      AND Object_Name IS NOT NULL
)
SELECT 'name-quoted' AS rule_id, 'info' AS severity,
    n.File_Name AS file_name, n.Object_UUID AS nav_uuid,
    n.Object_Type AS object_type, n.Object_Name AS object_name,
    'Name is wrapped in literal quotes — probably pasted from a calculation' AS message,
    row_number() OVER (ORDER BY n.File_Name, n.Object_Type, n.Object_Name) AS row_key
FROM named n
WHERE n.Object_Name LIKE '"%"'
  AND (getvariable('file') IS NULL OR n.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR n.Object_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
