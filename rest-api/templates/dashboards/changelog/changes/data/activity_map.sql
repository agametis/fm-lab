-- One row per cell of the activity map (calendar heatmap) over the period:
-- hours of the last 7 days, days for 30–365 days, and for `all` sections of a
-- month (days 1–7, 8–14, 15–21, 22–28, 29–end) from the first change on, drawn as
-- one block per year. Every cell of the frame is present, empty ones with n = 0,
-- so gaps stay visible.
--   grain           → hour | day | week (week = a section of a month)
--   row / col       → grid position: day grain = weekday (0 Monday) × week column,
--                     hour grain = day row × hour column, week grain = section of
--                     the month (0–4) × month column (0 January) within its year
--   year            → year of the cell (week grain: the block it belongs to)
--   row_label       → hour grain: the day of the row (otherwise NULL, the
--                     primitive names the weekdays)
--   month           → month of the cell (column headers of the calendar)
--   label           → the cell as text for the tooltip
--   n               → changed objects, or bursts with count=actions; mass events
--                     only with bulk=include (they never hide in the intensity)
--   level           → 0 for n = 0, else 1–4 by the quartiles q1/q2/q3 of the
--                     non-empty cells in the frame (no fixed thresholds: solutions
--                     differ by orders of magnitude); the busiest cell is always 4
--   bulk_objects / bulk_events → objects and mass events in the cell matching the
--                     filters, counted also while mass events are hidden (marker)
--   top_types / top_persons → up to three {key, n} by objects, for the tooltip
--   from_at / to_at → the cell as drill-down window (to the second, clamped to the
--                     period) — the list then shows exactly the cell's objects
--   is_selected     → the cell is the active drill-down window
--   count_mode / bulk_mode → echoed for the click arguments
-- Times are the local time of the editing client without time zone, as text.
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
frame AS (
    -- lo is exclusive (like the period); `all` starts at the month of the first change
    SELECT
        CASE p.days WHEN '7' THEN 'hour' WHEN 'all' THEN 'week' ELSE 'day' END AS grain,
        CASE WHEN p.days = 'all'
             THEN date_trunc('month', COALESCE((SELECT min(c.Modified_At) FROM charted c), an.anchor_at))
                  - INTERVAL 1 SECOND
             ELSE pe.lo END                                                   AS lo,
        greatest(an.anchor_at, COALESCE((SELECT max(c.Modified_At) FROM charted c), an.anchor_at)) AS hi,
        p.count_mode, p.bulk, p.w_from, p.w_to
    FROM params p, anchor an, period pe
),
cells AS (
    SELECT g.cell_start,
           g.cell_start + CASE WHEN f.grain = 'hour' THEN INTERVAL 1 HOUR ELSE INTERVAL 1 DAY END AS cell_end
    FROM frame f,
         generate_series(date_trunc(f.grain, f.lo), date_trunc(f.grain, f.hi),
                         CASE WHEN f.grain = 'hour' THEN INTERVAL 1 HOUR ELSE INTERVAL 1 DAY END) g(cell_start)
    WHERE f.grain <> 'week'
    UNION ALL
    -- week grain: five sections per month, the last one 1–3 days (none in a
    -- 28-day February); sections after the end of the frame are left out
    SELECT m.m_start + INTERVAL 7 DAY * k.i                                   AS cell_start,
           least(m.m_start + INTERVAL 7 DAY * (k.i + 1), m.m_start + INTERVAL 1 MONTH) AS cell_end
    FROM frame f,
         generate_series(date_trunc('month', f.lo + INTERVAL 1 SECOND), date_trunc('month', f.hi),
                         INTERVAL 1 MONTH) m(m_start),
         range(5) k(i)
    WHERE f.grain = 'week'
      AND m.m_start + INTERVAL 7 DAY * k.i < m.m_start + INTERVAL 1 MONTH
      AND m.m_start + INTERVAL 7 DAY * k.i <= f.hi
),
inframe AS (
    SELECT CASE WHEN f.grain = 'week'
                THEN date_trunc('month', c.Modified_At)
                     + INTERVAL 7 DAY * least(CAST((day(c.Modified_At) - 1) // 7 AS INTEGER), 4)
                ELSE date_trunc(f.grain, c.Modified_At) END                  AS cell_start,
           c.Object_Type, c.Person_Name, c.Burst_ID, c.Bulk_Event_ID,
           (f.bulk = 'include' OR c.Bulk_Event_ID IS NULL) AS counts
    FROM charted c, frame f
    WHERE c.Modified_At > f.lo
),
hits AS (
    SELECT cell_start,
           count(*) FILTER (WHERE counts)                     AS objects,
           count(DISTINCT Burst_ID) FILTER (WHERE counts)     AS actions,
           count(*) FILTER (WHERE Bulk_Event_ID IS NOT NULL)  AS bulk_objects,
           count(DISTINCT Bulk_Event_ID)                      AS bulk_events
    FROM inframe
    GROUP BY cell_start
),
top_types AS (
    SELECT cell_start, list_slice(list({'key': Object_Type, 'n': CAST(n AS INTEGER)} ORDER BY n DESC, Object_Type), 1, 3) AS top
    FROM (SELECT cell_start, Object_Type, count(*) AS n FROM inframe WHERE counts GROUP BY ALL)
    GROUP BY cell_start
),
top_persons AS (
    SELECT cell_start, list_slice(list({'key': Person_Name, 'n': CAST(n AS INTEGER)} ORDER BY n DESC, Person_Name), 1, 3) AS top
    FROM (SELECT cell_start, Person_Name, count(*) AS n FROM inframe WHERE counts GROUP BY ALL)
    GROUP BY cell_start
),
counted AS (
    SELECT ce.cell_start, ce.cell_end,
           COALESCE(CASE WHEN f.count_mode = 'actions' THEN h.actions ELSE h.objects END, 0) AS n,
           COALESCE(h.bulk_objects, 0) AS bulk_objects,
           COALESCE(h.bulk_events, 0)  AS bulk_events
    FROM cells ce
    CROSS JOIN frame f
    LEFT JOIN hits h ON h.cell_start = ce.cell_start
),
quart AS (
    SELECT quantile_disc(n, 0.25) AS q1, quantile_disc(n, 0.5) AS q2, quantile_disc(n, 0.75) AS q3,
           max(n) AS mx
    FROM counted
    WHERE n > 0
),
first_cell AS (
    SELECT min(cell_start) AS c0 FROM cells
),
windowed AS (
    SELECT k.*,
           strftime(CASE WHEN k.cell_start <= f.lo THEN f.lo + INTERVAL 1 SECOND ELSE k.cell_start END,
                    '%Y-%m-%d %H:%M:%S')                                     AS from_at,
           strftime(k.cell_end - INTERVAL 1 SECOND, '%Y-%m-%d %H:%M:%S')     AS to_at
    FROM counted k, frame f
)
SELECT
    strftime(k.cell_start, '%Y-%m-%d %H:%M')                                  AS cell,
    f.grain                                                                   AS grain,
    CASE f.grain
        WHEN 'hour' THEN date_diff('day', CAST(fc.c0 AS DATE), CAST(k.cell_start AS DATE))
        WHEN 'week' THEN (day(k.cell_start) - 1) // 7
        ELSE isodow(k.cell_start) - 1 END                                     AS "row",
    CASE f.grain
        WHEN 'hour' THEN hour(k.cell_start)
        WHEN 'week' THEN month(k.cell_start) - 1
        ELSE date_diff('day', date_trunc('week', fc.c0), date_trunc('week', k.cell_start)) // 7
    END                                                                       AS col,
    year(k.cell_start)                                                        AS year,
    CASE WHEN f.grain = 'hour' THEN strftime(k.cell_start, '%Y-%m-%d') END    AS row_label,
    month(k.cell_start)                                                       AS month,
    CASE f.grain
        WHEN 'hour' THEN strftime(k.cell_start, '%Y-%m-%d %H:%M') || '–' || strftime(k.cell_end, '%H:%M')
        WHEN 'week' THEN
            CASE WHEN k.cell_end - k.cell_start = INTERVAL 1 DAY
                 THEN strftime(k.cell_start, '%Y-%m-%d')
                 ELSE strftime(k.cell_start, '%Y-%m-%d') || ' – ' ||
                      strftime(k.cell_end - INTERVAL 1 DAY, '%Y-%m-%d') END
        ELSE strftime(k.cell_start, '%Y-%m-%d') END                           AS label,
    k.n                                                                       AS n,
    CASE WHEN k.n = 0 THEN 0
         WHEN k.n >= q.mx THEN 4
         WHEN k.n <= q.q1 THEN 1
         WHEN k.n <= q.q2 THEN 2
         WHEN k.n <= q.q3 THEN 3
         ELSE 4 END                                                           AS level,
    q.q1, q.q2, q.q3,
    k.bulk_objects,
    k.bulk_events,
    COALESCE(tt.top, [])                                                      AS top_types,
    COALESCE(tp.top, [])                                                      AS top_persons,
    k.from_at,
    k.to_at,
    COALESCE(strftime(f.w_from, '%Y-%m-%d %H:%M:%S') = k.from_at
             AND strftime(f.w_to, '%Y-%m-%d %H:%M:%S') = k.to_at, false)    AS is_selected,
    f.count_mode                                                              AS count_mode,
    f.bulk                                                                    AS bulk_mode
FROM windowed k
CROSS JOIN frame f
CROSS JOIN quart q
CROSS JOIN first_cell fc
LEFT JOIN top_types tt   ON tt.cell_start = k.cell_start
LEFT JOIN top_persons tp ON tp.cell_start = k.cell_start
ORDER BY k.cell_start;
