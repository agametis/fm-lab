-- @title: Change window (C1) — data state, partition, persons and work-session lookup
-- @description: Three read-only result sets that resolve the window of a change report. Variables: person (Author_Key or NULL), session_at (TIMESTAMP or NULL) — set both to NULL when no session is asked for.
-- @version: 1.0.0
-- @tags: changes, window, sessions
-- @note: The work-session rule matches the web dashboard "Recent changes": consecutive
--        individual changes of one person (mass events and technical authors excluded,
--        accounts and authorizations too) with gaps of at most 30 minutes, across files.
--        Persons are case-folded user names (Author_Key); the curated aliases that merge
--        spelling variants exist only in the REST API.

-- #1 data state, stamps present, partition engine (engine with the most rows, or NULL)
SELECT
    (SELECT count(*) FROM ObjectChangeMeta)                                        AS stamps,
    strftime((SELECT max(Modified_At) FROM ObjectChangeMeta
               WHERE Bulk_Event_ID IS NULL AND Author_Kind IS NULL), '%Y-%m-%d %H:%M:%S') AS data_state,
    strftime((SELECT min(Modified_At) FROM ObjectChangeMeta), '%Y-%m-%d')           AS oldest_stamp,
    (SELECT oc.Engine FROM ObjectClusters oc WHERE oc.Engine IS NOT NULL
      GROUP BY oc.Engine ORDER BY count(*) DESC, oc.Engine LIMIT 1)                 AS engine;

-- #2 persons — to resolve a name from the prompt to an Author_Key (spelling variants of
--    one person stay separate keys here; name them together in the report)
SELECT m.Author_Key,
       any_value(m.Modified_By)                                       AS spelling,
       count(*) FILTER (WHERE m.Bulk_Event_ID IS NULL)                AS individual_changes,
       strftime(max(m.Modified_At), '%Y-%m-%d %H:%M')                AS last_change,
       bool_or(m.Author_Kind IS NOT NULL)                             AS technical
FROM ObjectChangeMeta m
WHERE m.Author_Key IS NOT NULL
GROUP BY m.Author_Key
ORDER BY individual_changes DESC, m.Author_Key;

-- #3 the work session of `person` that contains `session_at` (no row when none does)
WITH steps AS (
    SELECT m.Author_Key, m.Modified_At,
           CASE WHEN m.Modified_At - lag(m.Modified_At) OVER w <= INTERVAL 30 MINUTE
                THEN 0 ELSE 1 END AS is_start,
           row_number() OVER w AS seq
    FROM ObjectChangeMeta m
    WHERE m.Modified_At IS NOT NULL
      AND m.Bulk_Event_ID IS NULL
      AND m.Author_Kind IS NULL
      AND m.Object_Type NOT IN ('Account', 'Authorization')
      AND m.Author_Key = getvariable('person')
    WINDOW w AS (PARTITION BY m.Author_Key ORDER BY m.Modified_At, m.File_Name, m.Object_Type, m.Object_UUID)
),
numbered AS (
    SELECT s.Modified_At,
           sum(s.is_start) OVER (ORDER BY s.seq ROWS UNBOUNDED PRECEDING) AS session_no
    FROM steps s
),
sessions AS (
    SELECT n.session_no, min(n.Modified_At) AS start_at, max(n.Modified_At) AS end_at, count(*) AS objects
    FROM numbered n
    GROUP BY n.session_no
)
SELECT strftime(se.start_at, '%Y-%m-%d %H:%M:%S') AS session_from,
       strftime(se.end_at, '%Y-%m-%d %H:%M:%S')   AS session_to,
       se.objects
FROM sessions se
WHERE getvariable('session_at') IS NOT NULL
  AND CAST(getvariable('session_at') AS TIMESTAMP)
      BETWEEN se.start_at - INTERVAL 30 MINUTE AND se.end_at + INTERVAL 30 MINUTE
ORDER BY abs(date_diff('second', se.start_at, CAST(getvariable('session_at') AS TIMESTAMP)))
LIMIT 1;
