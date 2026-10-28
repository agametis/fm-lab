-- Work sessions: consecutive changes of the same person with gaps of at most
-- 30 minutes, across files. Computed only with group=sessions (else no rows),
-- newest first, paged like the change list. from_at/to_at (to the second),
-- person_key and bulk_mode drive the drill-down into the list (the window keeps
-- the mass-event mode the sessions were built with).
-- >>> shared filter block — identical in every dataset of the Changelog dashboards
-- (unit test dashboard-changelog-blocks guards it); change it in all files at once.
--   params    URL params, normalised ('' and absent → NULL / default). `type` and
--             `file` are comma-separated lists of the multi-selects (a handful of
--             values, hence list_contains). `count` and `stack` steer only the charts.
--   stamps    every change stamp with the person (curated aliases of
--             v_change_meta_authors) and the curated technical flag
--   anchor    "data" (default): newest individual change by a developer — the
--             solution's data state; "today": the current local time
--   period    lower bound of the period `days` (7 | 30 | 90 (default) | 365 | all)
--             counted back from the anchor; NULL for all
--   win       from/to (a drill-down window, inclusive) wins over the period
--   base      every filter except time and mass events; Account/Authorization only
--             when the type filter names them (runtime changes, not developer activity)
--   scoped    base within the window
--   charted   base within the period, ignoring the drill-down window — the charts
--             keep their frame while the list shows one of their cells
--   filtered  scoped minus mass events unless `bulk=include`
WITH params AS (
    SELECT
        string_split(NULLIF(CAST(getvariable('type') AS VARCHAR), ''), ',')            AS types,
        string_split(NULLIF(CAST(getvariable('file') AS VARCHAR), ''), ',')            AS files,
        NULLIF(CAST(getvariable('person') AS VARCHAR), '')                             AS person,
        COALESCE(NULLIF(CAST(getvariable('days') AS VARCHAR), ''), '90')               AS days,
        COALESCE(NULLIF(CAST(getvariable('anchor') AS VARCHAR), ''), 'data')           AS anchor,
        COALESCE(NULLIF(CAST(getvariable('bulk') AS VARCHAR), ''), 'hide')             AS bulk,
        COALESCE(NULLIF(CAST(getvariable('technical') AS VARCHAR), ''), 'hide')        AS technical,
        TRY_CAST(NULLIF(CAST(getvariable('from') AS VARCHAR), '') AS TIMESTAMP)        AS w_from,
        TRY_CAST(NULLIF(CAST(getvariable('to') AS VARCHAR), '') AS TIMESTAMP)          AS w_to,
        lower(NULLIF(trim(CAST(getvariable('q') AS VARCHAR)), ''))                     AS q,
        COALESCE(NULLIF(CAST(getvariable('count') AS VARCHAR), ''), 'objects')         AS count_mode,
        COALESCE(NULLIF(CAST(getvariable('stack') AS VARCHAR), ''), 'type')            AS stack_by
),
stamps AS (
    SELECT
        m.Object_UUID, m.File_Name, m.Object_Type, m.Object_Name, m.Modified_At,
        m.Modified_Account, m.Modifications, m.Author_Key, m.Burst_ID, m.Bulk_Event_ID,
        COALESCE(a.Person_Key, m.Author_Key)                  AS Person_Key,
        COALESCE(a.Display_Name, m.Modified_By, m.Author_Key) AS Person_Name,
        COALESCE(a.Is_Technical, m.Author_Kind IS NOT NULL)   AS Is_Technical
    FROM ObjectChangeMeta m
    LEFT JOIN v_change_meta_authors a ON a.Author_Key = m.Author_Key
    WHERE m.Modified_At IS NOT NULL
),
anchor AS (
    SELECT CASE
               WHEN p.anchor = 'today' THEN CAST(current_localtimestamp() AS TIMESTAMP)
               ELSE COALESCE(
                   (SELECT max(s.Modified_At) FROM stamps s
                     WHERE s.Bulk_Event_ID IS NULL AND NOT s.Is_Technical),
                   (SELECT max(s.Modified_At) FROM stamps s))
           END AS anchor_at
    FROM params p
),
period AS (
    SELECT CASE
               WHEN p.days = 'all' THEN NULL
               ELSE an.anchor_at - INTERVAL 1 DAY * COALESCE(TRY_CAST(p.days AS INTEGER), 90)
           END AS lo
    FROM params p, anchor an
),
win AS (
    SELECT
        (p.w_from IS NOT NULL OR p.w_to IS NOT NULL) AS is_window,
        CASE WHEN p.w_from IS NOT NULL OR p.w_to IS NOT NULL THEN p.w_from ELSE pe.lo END AS lo,
        CASE WHEN p.w_from IS NOT NULL OR p.w_to IS NOT NULL THEN p.w_to END AS hi
    FROM params p, period pe
),
base AS (
    SELECT
        s.Object_UUID, s.File_Name, s.Object_Type, s.Object_Name, s.Modified_At,
        s.Modified_Account, s.Modifications, s.Author_Key, s.Burst_ID, s.Bulk_Event_ID,
        s.Person_Key, s.Person_Name, s.Is_Technical
    FROM stamps s, params p
    WHERE ((p.types IS NULL AND s.Object_Type NOT IN ('Account', 'Authorization'))
           OR list_contains(p.types, s.Object_Type))
      AND (p.files IS NULL OR list_contains(p.files, s.File_Name))
      AND (p.person IS NULL OR s.Person_Key = p.person)
      AND (p.technical = 'include' OR NOT s.Is_Technical)
      AND (p.q IS NULL
           OR contains(lower(COALESCE(s.Object_Name, '')), p.q)
           OR contains(lower(s.File_Name), p.q)
           OR contains(lower(s.Person_Name), p.q)
           OR contains(lower(s.Object_Type), p.q))
),
scoped AS (
    SELECT
        b.Object_UUID, b.File_Name, b.Object_Type, b.Object_Name, b.Modified_At,
        b.Modified_Account, b.Modifications, b.Author_Key, b.Burst_ID, b.Bulk_Event_ID,
        b.Person_Key, b.Person_Name, b.Is_Technical
    FROM base b, win w
    WHERE (w.lo IS NULL OR b.Modified_At > w.lo OR (w.is_window AND b.Modified_At = w.lo))
      AND (w.hi IS NULL OR b.Modified_At <= w.hi)
),
charted AS (
    SELECT
        b.Object_UUID, b.File_Name, b.Object_Type, b.Object_Name, b.Modified_At,
        b.Modified_Account, b.Modifications, b.Author_Key, b.Burst_ID, b.Bulk_Event_ID,
        b.Person_Key, b.Person_Name, b.Is_Technical
    FROM base b, period pe
    WHERE pe.lo IS NULL OR b.Modified_At > pe.lo
),
filtered AS (
    SELECT
        sc.Object_UUID, sc.File_Name, sc.Object_Type, sc.Object_Name, sc.Modified_At,
        sc.Modified_Account, sc.Modifications, sc.Author_Key, sc.Burst_ID, sc.Bulk_Event_ID,
        sc.Person_Key, sc.Person_Name, sc.Is_Technical
    FROM scoped sc, params p
    WHERE p.bulk = 'include' OR sc.Bulk_Event_ID IS NULL
)
-- <<< shared filter block
,
session_input AS (
    SELECT
        f.Object_UUID, f.File_Name, f.Object_Type, f.Modified_At, f.Person_Key, f.Person_Name
    FROM filtered f
    WHERE COALESCE(CAST(getvariable('group') AS VARCHAR), '') = 'sessions'
),
-- >>> shared session block — identical in every dataset that builds work sessions
-- (unit test dashboard-changelog-blocks guards it); change it in all files at once.
--   session_input   the stamps to group (defined by each dataset right before)
--   ordered         a stamp starts a new session when the previous stamp of the
--                   same person lies more than 30 minutes back
--   numbered_steps  every stamp with its session number per person
ordered AS (
    SELECT
        si.Object_UUID, si.File_Name, si.Object_Type, si.Modified_At, si.Person_Key, si.Person_Name,
        CASE WHEN si.Modified_At - lag(si.Modified_At) OVER w30 <= INTERVAL 30 MINUTE
             THEN 0 ELSE 1 END                                     AS is_start,
        row_number() OVER w30                                      AS seq
    FROM session_input si
    WINDOW w30 AS (PARTITION BY si.Person_Key
                   ORDER BY si.Modified_At, si.File_Name, si.Object_Type, si.Object_UUID)
),
numbered_steps AS (
    SELECT
        o.Object_UUID, o.File_Name, o.Object_Type, o.Modified_At, o.Person_Key, o.Person_Name,
        sum(o.is_start) OVER (PARTITION BY o.Person_Key ORDER BY o.seq
                              ROWS UNBOUNDED PRECEDING)            AS session_no
    FROM ordered o
)
-- <<< shared session block
,
type_counts AS (
    SELECT ns.Person_Key, ns.session_no, ns.Object_Type, count(*) AS n
    FROM numbered_steps ns
    GROUP BY ns.Person_Key, ns.session_no, ns.Object_Type
),
type_summary AS (
    SELECT tc.Person_Key, tc.session_no,
           string_agg(tc.n || ' ' || tc.Object_Type, ' · ' ORDER BY tc.n DESC, tc.Object_Type) AS types
    FROM type_counts tc
    GROUP BY tc.Person_Key, tc.session_no
),
sessions AS (
    SELECT
        ns.Person_Key, ns.session_no,
        any_value(ns.Person_Name)                                  AS person,
        min(ns.Modified_At)                                        AS start_at,
        max(ns.Modified_At)                                        AS end_at,
        count(*)                                                   AS objects,
        count(DISTINCT ns.File_Name)                               AS files,
        mode(ns.File_Name)                                         AS main_file
    FROM numbered_steps ns
    GROUP BY ns.Person_Key, ns.session_no
),
numbered AS MATERIALIZED (
    SELECT
           se.Person_Key,
           se.person,
           se.start_at,
           se.end_at,
           se.objects,
           se.files,
           se.main_file,
           ts.types,
           row_number() OVER (ORDER BY se.start_at DESC, se.Person_Key) AS rn,
           se.start_at AS _ord_1,
           se.Person_Key AS _ord_2
    FROM sessions se
    JOIN type_summary ts ON ts.Person_Key = se.Person_Key AND ts.session_no = se.session_no
),
-- The list rows; the keys of the default order travel along as hidden
-- columns.
unkeyed AS MATERIALIZED (
    SELECT
        strftime(n.start_at, '%Y-%m-%d %H:%M')                        AS started,
        CASE WHEN CAST(n.start_at AS DATE) = CAST(n.end_at AS DATE)
         THEN strftime(n.end_at, '%H:%M')
         ELSE strftime(n.end_at, '%Y-%m-%d %H:%M') END             AS ended,
        date_diff('minute', n.start_at, n.end_at)                      AS minutes,
        n.person                                                       AS person,
        n.objects                                                      AS objects,
        CASE WHEN n.files > 1 THEN n.main_file || ' +' || (n.files - 1)
         ELSE n.main_file END                                      AS files,
        n.types                                                        AS types,
        strftime(n.start_at, '%Y-%m-%d %H:%M:%S')                     AS from_at,
        strftime(n.end_at, '%Y-%m-%d %H:%M:%S')                       AS to_at,
        n.Person_Key                                                   AS person_key,
        (SELECT p.bulk FROM params p)                                  AS bulk_mode,
        n._ord_1 AS _ord_1,
        n._ord_2 AS _ord_2
    FROM numbered n
),
-- _row_seq numbers the rows in the default order (row_key stays the row's
-- identity); the whole row breaks the remaining ties, so every request
-- assigns the same number.
result AS MATERIALIZED (
    SELECT u.* EXCLUDE (_ord_1, _ord_2),
           row_number() OVER (ORDER BY u._ord_1 DESC, u._ord_2, u) AS _row_seq
    FROM unkeyed u
),
-- >>> shared paging changelog-window block
pg AS (
    SELECT s._pg_size, t._pg_total,
           LEAST(GREATEST(COALESCE(TRY_CAST(NULLIF(CAST(getvariable('page') AS VARCHAR), '') AS INTEGER), 1), 1),
                 GREATEST(CAST(ceil(t._pg_total / s._pg_size) AS INTEGER), 1)) AS _pg_page
    FROM (SELECT LEAST(GREATEST(COALESCE(TRY_CAST(CAST(getvariable('page_size') AS VARCHAR) AS INTEGER), 500), 1), 10000) AS _pg_size) s,
         (SELECT count(*) AS _pg_total FROM result) t
)
-- <<< shared paging changelog-window block
SELECT f.*, pg._pg_total AS _row_total, pg._pg_page AS _page, pg._pg_size AS _page_size
FROM result f, pg
ORDER BY /*@sort*/ _row_seq, f
LIMIT (SELECT _pg_size FROM pg) OFFSET (SELECT (_pg_page - 1) * _pg_size FROM pg);
