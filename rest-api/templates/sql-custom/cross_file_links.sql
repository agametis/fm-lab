-- @template_type: report
-- @title: Datei-zu-Datei-Beziehungen
-- @description: Aggregierte Übersicht der Cross-File-Referenzen pro Datei-Paar.
-- @icon: link
-- @category: Abhängigkeiten
-- @display: table
-- @params: none
-- @author: Marcel
-- @version: 3.1
-- @tags: files, dependencies

SELECT
  s.File_Name AS source_file,
  t.File_Name AS target_file,
  COUNT(*)    AS link_count
FROM ObjectLinks ol
JOIN ObjectCatalog s ON ol.Source_UUID = s.Object_UUID
JOIN ObjectCatalog t ON ol.Target_UUID = t.Object_UUID
WHERE ol.Is_Cross_File = TRUE
  AND ol.Link_Type = 'operational'
GROUP BY s.File_Name, t.File_Name
ORDER BY link_count DESC, source_file, target_file;
