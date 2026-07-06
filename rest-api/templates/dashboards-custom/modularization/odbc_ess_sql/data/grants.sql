-- @template_type: report
-- @description: ODBC-/xDBC-Zugriffs-Grants — welche Privilege-Sets fmxdbc (ODBC/JDBC-Zugriff) gewähren. Klick öffnet das Privilege-Set.
-- @params: file (optional), limit (optional, default 100)

SELECT
    sc.Object_Name              AS privilege_set,
    tc.Object_Name              AS extended_privilege,
    sc.File_Name                AS file,
    sc.Object_UUID              AS nav_uuid
FROM ObjectLinks ol
JOIN ObjectCatalog sc ON ol.Source_UUID = sc.Object_UUID
JOIN ObjectCatalog tc ON ol.Target_UUID = tc.Object_UUID
WHERE ol.Link_Role = 'grants_privilege'
  AND tc.Object_Name = 'fmxdbc'
  AND (getvariable('file') IS NULL OR sc.File_Name = getvariable('file'))
ORDER BY sc.File_Name, sc.Object_Name
LIMIT CAST(COALESCE(getvariable('limit'), '100') AS INTEGER);
