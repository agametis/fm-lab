-- @template_type: report
-- @description: Scripts mit TO-DO-Kommentaren — pro Script die Anzahl der Treffer
--               sowie die erste gefundene Schreibweise (für ?sq=…-Highlight).
-- @params: file (optional), limit (optional, default 200)
-- Liefert die Script-UUID mit, damit Klicks auf eine Zeile die Detail-Ansicht öffnen.
-- search_term enthält die TATSÄCHLICHE Schreibweise (TODO, TO DO, To-Do, …) aus
-- dem ersten Comment-Step des Scripts — damit der Substring-Match im Frontend
-- case-insensitive treffen kann.

WITH comment_steps AS (
    SELECT
        s.Script_UUID,
        s.Script_Name,
        s.File_Name,
        s.Step_Index,
        regexp_extract(s.Parameters_XML, '<Comment value="([^"]*)"', 1) AS comment_text
    FROM StepsForScripts s
    WHERE s.Step_Name = '# (comment)'
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
todos AS (
    SELECT
        Script_UUID,
        Script_Name,
        File_Name,
        Step_Index,
        regexp_extract(comment_text, '(?i)\bto[\s\-_]?do', 0) AS extracted_term
    FROM comment_steps
    WHERE comment_text <> ''
      AND regexp_matches(comment_text, '(?i)\bto[\s\-_]?do')
)
SELECT
    Script_UUID                              AS uuid,
    File_Name                                AS file,
    Script_Name                              AS name,
    COUNT(*)                                 AS todo_count,
    arg_min(extracted_term, Step_Index)      AS search_term
FROM todos
GROUP BY Script_UUID, File_Name, Script_Name
ORDER BY todo_count DESC, file, name
LIMIT CAST(COALESCE(getvariable('limit'), '200') AS INTEGER);
