-- @template_type: report
-- @description: Aggregat-Kennzahlen für TO-DO-Kommentare in Scripts (Steps, Scripts, Dateien).
-- @params: file (optional)
-- Erkennt Schreibvarianten TODO, TO DO, To-Do, TO_DO, TO DOs etc. (case-insensitive)
-- über die Regex \bto[\s\-_]?do — Wortgrenze davor, damit "today", "stop"
-- u.ä. nicht treffen. Der Comment-Text wird direkt aus Parameters_XML extrahiert
-- (kein xml_extract_text / LOAD webbed, da das REST-API-Backend nur ein Statement
-- pro prepare() erlaubt).

WITH comment_steps AS (
    SELECT
        s.Script_UUID,
        s.File_Name,
        regexp_extract(s.Parameters_XML, '<Comment value="([^"]*)"', 1) AS comment_text
    FROM StepsForScripts s
    WHERE s.Step_Name = '# (comment)'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
todos AS (
    SELECT *
    FROM comment_steps
    WHERE comment_text <> ''
      AND regexp_matches(comment_text, '(?i)\bto[\s\-_]?do')
)
SELECT
    COUNT(*)                       AS todo_steps,
    COUNT(DISTINCT Script_UUID)    AS todo_scripts,
    COUNT(DISTINCT File_Name)      AS todo_files
FROM todos;
