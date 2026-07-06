-- @template_type: report
-- @description: Einzelne Cross-File-Links — pro Zeile ein Quell-Objekt (Datei A) das ein Ziel-Objekt (Datei B) referenziert, mit Rolle. Standardmäßig auf das in der Matrix gewählte Datei-Paar gefiltert. Klick auf eine Zeile öffnet das Ziel-Objekt.
-- @params: file (optional), source_file (optional), target_file (optional), link_role (optional), limit (optional, default 300)

SELECT
    ol.Source_File                          AS source_file,
    ol.Target_File                          AS target_file,
    ol.Link_Role                            AS link_role,
    ol.Link_Type                            AS link_type,
    ol.Source_Type                          AS source_type,
    COALESCE(sc.Object_Name, '—')           AS source_object,
    ol.Target_Type                          AS target_type,
    COALESCE(tc.Object_Name, '—')           AS target_object,
    ol.Target_UUID                          AS target_uuid
FROM ObjectLinks ol
LEFT JOIN ObjectCatalog sc ON ol.Source_UUID = sc.Object_UUID
LEFT JOIN ObjectCatalog tc ON ol.Target_UUID = tc.Object_UUID
WHERE ol.Is_Cross_File = TRUE
  AND ol.Source_File IS NOT NULL AND ol.Target_File IS NOT NULL
  AND ol.Source_File <> ol.Target_File
  AND (getvariable('file') IS NULL
       OR ol.Source_File = getvariable('file')
       OR ol.Target_File = getvariable('file'))
  AND (getvariable('source_file') IS NULL OR getvariable('source_file') IN ('', 'All', 'Alle')
       OR ol.Source_File = getvariable('source_file'))
  AND (getvariable('target_file') IS NULL OR getvariable('target_file') IN ('', 'All', 'Alle')
       OR ol.Target_File = getvariable('target_file'))
  AND (getvariable('link_role') IS NULL OR getvariable('link_role') IN ('', 'All', 'Alle')
       OR ol.Link_Role = getvariable('link_role'))
ORDER BY ol.Source_File, ol.Target_File, ol.Link_Role, source_object, target_object
LIMIT CAST(COALESCE(getvariable('limit'), '300') AS INTEGER);
