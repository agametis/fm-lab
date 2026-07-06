-- Passwort-Feld wird im Klartext angezeigt (Layout-Objekt-Ebene).
-- Ein Passwort-/PIN-benanntes Feld wird von einem Layout-Objekt dargestellt, das
-- KEIN „verschlüsseltes Bearbeitungsfeld" (Concealed Edit Box) ist — der Wert steht
-- also im Klartext auf dem Layout. Ergebnis ist bewusst PRO Layout-Objekt (ein Feld
-- kann auf mehreren Layouts / mehrfach unverschlüsselt gezeigt werden).
--
-- Locale-unabhängiges Merkmal: das Concealed-Rendering ist im Objekt-XML als
-- `<Field><Display Style="7"/>` kodiert (Style 7 = concealed, korpus-weit eindeutig;
-- Style 0 = normales Bearbeitungsfeld). Object_Type ist lokalisiert (EN „Edit Box"
-- vs. DE „Bearbeitungsfeld") und deshalb NICHT als Filter geeignet. Wir filtern per
-- LIKE auf dem XML — kein xml_extract_text/LOAD webbed (Ein-Statement-Constraint des
-- REST-Backends).
WITH pw AS (
    SELECT f.Field_UUID, f.File_Name, f.Table_Name, f.Field_Name
    FROM FieldsForTables f
    WHERE regexp_matches(LOWER(f.Field_Name), '(password|passwort|kennwort|\bpin\b)')
      AND f.Field_Type = 'Normal' AND COALESCE(f.Is_Global, '') <> 'True'
)
SELECT 'password-field-plaintext-display' AS rule_id, 'warning' AS severity,
    lo.File_Name AS file_name,
    pw.Table_Name || '::' || pw.Field_Name AS field_name,
    l.L_Name AS layout_name,
    l.L_UUID AS nav_uuid,
    pw.Field_UUID AS field_uuid,
    lo.Object_UUID AS object_uuid
FROM ObjectLinks ol
JOIN pw ON pw.Field_UUID = ol.Target_UUID
JOIN LayoutObjects lo ON lo.Object_UUID = ol.Source_UUID
JOIN Layouts l ON l.L_ID = lo.Layout_ID AND l.File_Name = lo.File_Name
WHERE ol.Link_Role = 'displays_field'
  AND ol.Source_Type = 'LayoutObject'
  AND lo.Object_XML NOT LIKE '%<Display Style="7"%'
  AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
ORDER BY file_name, field_name, layout_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
