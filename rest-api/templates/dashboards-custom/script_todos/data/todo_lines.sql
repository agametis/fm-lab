-- @template_type: report
-- @description: Markierte Kommentar-Zeilen — eine Zeile pro Treffer, mit normalisierter
--               Notations-Kategorie (Pattern) und Kommentartext. Filterbar nach Notation.
-- @params: file (optional), pattern (optional: todo|fixit|tbd), limit (optional, default 500)
--
-- Grain = pro Treffer-Zeile (nicht pro Script), damit die Pattern-Spalte je Zeile
-- eindeutig ist und der Hero-Filter exakt greift. Erkennung/Klassifikation identisch
-- zu todo_kpi.sql (Familien + Präzedenz FIX IT > TBD > TO DO).
--
-- search_term = die TATSÄCHLICH gefundene Schreibweise der zugewiesenen Kategorie
-- (ASCII-Marker, z.B. "TO DO"/"FIX IT"/"TBD") → für den ?sq=…-Highlight in der Detail-Ansicht.
--
-- comment = dekodierter Kommentartext. Da der Wert roh aus Parameters_XML stammt
-- (kein xml_extract_text/LOAD webbed wegen Ein-Statement-Constraint des REST-Backends),
-- werden die häufigsten XML-Entities pragmatisch per replace() aufgelöst: deutsche
-- Umlaute/ß (Hex-Form, wie vom Serializer erzeugt) plus die fünf Standard-XML-Entities
-- (&amp; zuletzt, um Doppel-Dekodierung zu vermeiden). Seltene Entities bleiben roh.

WITH comment_steps AS (
    SELECT
        s.Script_UUID,
        s.Script_Name,
        s.File_Name,
        s.Step_Index,
        regexp_extract(s.Parameters_XML, '<Comment value="([^"]*)"', 1) AS comment_text
    FROM StepsForScripts s
    WHERE s.Step_ID = 89   -- '# (Comment)' — Step_ID ist locale-unabhängig (Step_Name lokalisiert)
      AND (getvariable('file') IS NULL OR getvariable('file') = '' OR s.File_Name = getvariable('file'))
),
classified AS (
    SELECT
        Script_UUID,
        Script_Name,
        File_Name,
        Step_Index,
        comment_text,
        CASE
            WHEN regexp_matches(comment_text, '(?i)\bfix[\s\-_]?(it|me)\b')                              THEN 'FIX IT'
            WHEN regexp_matches(comment_text, '(?i)(\btbd\b|\bto[\s\-_]be[\s\-_](done|defined)\b)')  THEN 'TBD'
            WHEN regexp_matches(comment_text, '(?i)\bto[\s\-_]?do')                                  THEN 'TO DO'
        END AS pattern,
        CASE
            WHEN regexp_matches(comment_text, '(?i)\bfix[\s\-_]?(it|me)\b')                              THEN regexp_extract(comment_text, '(?i)\bfix[\s\-_]?(it|me)\b', 0)
            WHEN regexp_matches(comment_text, '(?i)(\btbd\b|\bto[\s\-_]be[\s\-_](done|defined)\b)')  THEN regexp_extract(comment_text, '(?i)(\btbd\b|\bto[\s\-_]be[\s\-_](done|defined)\b)', 0)
            ELSE regexp_extract(comment_text, '(?i)\bto[\s\-_]?do', 0)
        END AS search_term
    FROM comment_steps
    WHERE comment_text <> ''
)
SELECT
    Script_UUID || '#' || Step_Index    AS row_id,
    Script_UUID                         AS uuid,
    File_Name                           AS file,
    Script_Name                         AS name,
    pattern                             AS pattern,
    replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(replace(
        comment_text,
        '&#xFC;', 'ü'), '&#xF6;', 'ö'), '&#xE4;', 'ä'),
        '&#xDC;', 'Ü'), '&#xD6;', 'Ö'), '&#xC4;', 'Ä'),
        '&#xDF;', 'ß'),
        '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', '''')
        , '&amp;', '&')              AS comment,
    search_term                         AS search_term,
    Step_Index                          AS step_index
FROM classified
WHERE pattern IS NOT NULL
  AND ( getvariable('pattern') IS NULL OR getvariable('pattern') = ''
        OR pattern = CASE getvariable('pattern')
                         WHEN 'todo'  THEN 'TO DO'
                         WHEN 'fixit' THEN 'FIX IT'
                         WHEN 'tbd'   THEN 'TBD'
                     END )
ORDER BY file, name, step_index
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
