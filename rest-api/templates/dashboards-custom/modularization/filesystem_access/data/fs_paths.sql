-- @template_type: report
-- @description: Extrahierte Pfad-Literale (file:/filewin:/filemac:) aus Script-Step-Formeln — beantwortet „wohin schreibt/liest die Lösung?". Mit Normalisierung auf Verzeichnis-Ebene (Dateiname entfernt). Klick auf eine Zeile öffnet das Script am Step.
-- @params: file (optional), limit (optional, default 200)

WITH raw AS (
    SELECT
        c.File_Name                                             AS file,
        s.Script_Name                                           AS carrier,
        s.Step_Name                                             AS detail,
        s.Step_Index + 1                                            AS step_index,
        s.Script_UUID                                           AS nav_uuid,
        c.Owner_UUID                                            AS step_uuid,
        -- Alternation statt (?:win|mac)?-Gruppe: der API-SQL-Präprozessor ersetzt
        -- ":win" in einer non-capturing Gruppe sonst durch NULL (":<wort>"-Bindung).
        -- Längste Variante zuerst (filewin/filemac vor file).
        regexp_extract(COALESCE(c.Formula_Text, c.Display_Text),
            '(?i)(filewin|filemac|file):[^"''\n\r]*', 0)         AS path_literal
    FROM CalculationsCatalog c
    JOIN StepsForScripts s ON s.Step_UUID = c.Owner_UUID AND s.File_Name = c.File_Name
    WHERE regexp_matches(COALESCE(c.Formula_Text, c.Display_Text), '(?i)(filewin|filemac|file):')
      AND (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
)
SELECT
    file,
    carrier,
    detail,
    step_index,
    trim(path_literal)                                          AS path_literal,
    -- Verzeichnis-Normalisierung: letzten Pfadbestandteil (Dateiname) entfernen
    regexp_replace(trim(path_literal), '/[^/]*$', '/')          AS directory,
    nav_uuid,
    step_uuid
FROM raw
WHERE path_literal <> ''
ORDER BY file, carrier, step_index
LIMIT CAST(COALESCE(getvariable('limit'), '200') AS INTEGER);
