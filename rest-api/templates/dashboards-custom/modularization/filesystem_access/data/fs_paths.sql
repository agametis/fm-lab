-- @template_type: report
-- @description: Extrahierte Pfad-Literale (file:/filewin:/filemac:) aus Script-Step-Formeln — beantwortet „wohin schreibt/liest die Lösung?". Mit Normalisierung auf Verzeichnis-Ebene (Dateiname entfernt). Klick auf eine Zeile öffnet das Script am Step.
-- @params: file (optional), limit (optional, default 200)

WITH raw AS (
    SELECT
        s.File_Name                                             AS file,
        s.Script_Name                                           AS carrier,
        s.Step_Name                                             AS detail,
        s.Step_Index                                            AS step_index,
        s.Script_UUID                                           AS nav_uuid,
        s.Step_UUID                                             AS step_uuid,
        -- Alternation statt (?:win|mac)?-Gruppe: der API-SQL-Präprozessor ersetzt
        -- ":win" in einer non-capturing Gruppe sonst durch NULL (":<wort>"-Bindung).
        -- Längste Variante zuerst (filewin/filemac vor file).
        regexp_extract(s.Calculation_Text,
            '(?i)(filewin|filemac|file):[^"''\n\r]*', 0)         AS path_literal
    FROM StepsForScripts s
    WHERE s.Calculation_Text IS NOT NULL
      AND regexp_matches(s.Calculation_Text, '(?i)(filewin|filemac|file):')
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
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
