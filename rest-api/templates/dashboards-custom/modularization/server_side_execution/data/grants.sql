-- @template_type: report
-- @description: Server-/API-Zugriffs-Grants — welche Privilege-Sets die serverseitig relevanten Extended Privileges gewähren (fmrest, fmurlscript, fmodata, fmxml, fmphp, fmextscriptaccess). Klick auf eine Zeile öffnet das Privilege-Set.
-- @params: file (optional), limit (optional, default 200)

SELECT
    sc.Object_Name              AS privilege_set,
    tc.Object_Name              AS extended_privilege,
    sc.File_Name                AS file,
    sc.Object_UUID              AS nav_uuid
FROM ObjectLinks ol
JOIN ObjectCatalog sc ON ol.Source_UUID = sc.Object_UUID AND sc.File_Name = ol.Source_File
JOIN ObjectCatalog tc ON ol.Target_UUID = tc.Object_UUID AND tc.File_Name IS NOT DISTINCT FROM ol.Target_File
WHERE ol.Link_Role = 'grants_privilege'
  AND tc.Object_Name IN ('fmrest','fmurlscript','fmodata','fmxml','fmphp','fmextscriptaccess')
  AND (getvariable('file') IS NULL OR sc.File_Name = getvariable('file'))
ORDER BY tc.Object_Name, sc.File_Name, sc.Object_Name
LIMIT CAST(COALESCE(getvariable('limit'), '200') AS INTEGER);
