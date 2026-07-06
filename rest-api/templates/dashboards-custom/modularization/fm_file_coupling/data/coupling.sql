-- @template_type: report
-- @description: Kopplungs-Matrix — eine Zeile je gerichtetem Datei-Paar (Quelle → Ziel) mit Link-Anzahl, Anzahl verschiedener Rollen und operational/structural-Aufteilung. Klick auf eine Zeile filtert die Detailliste auf dieses Paar.
-- @params: file (optional), limit (optional, default 300)

SELECT
    Source_File                                             AS source_file,
    Target_File                                             AS target_file,
    COUNT(*)                                                AS links,
    COUNT(DISTINCT Link_Role)                               AS roles,
    -- kompakte Rollen-Vorschau (erste vier Rollen des Paars, alphabetisch).
    -- list_slice statt Slice-Syntax mit Doppelpunkt: der API-SQL-Präprozessor
    -- deutet den Doppelpunkt-Index sonst als benannten Parameter und ersetzt ihn.
    array_to_string(
        list_slice(list(DISTINCT Link_Role ORDER BY Link_Role), 1, 4), ', '
    )                                                       AS sample_roles
FROM ObjectLinks
WHERE Is_Cross_File = TRUE
  AND Source_File IS NOT NULL AND Target_File IS NOT NULL
  AND Source_File <> Target_File
  AND (getvariable('file') IS NULL
       OR Source_File = getvariable('file')
       OR Target_File = getvariable('file'))
GROUP BY Source_File, Target_File
ORDER BY links DESC, source_file, target_file
LIMIT CAST(COALESCE(getvariable('limit'), '300') AS INTEGER);
