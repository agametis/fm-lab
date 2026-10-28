-- One row per bucket × series of the stacked activity chart over the period:
-- days for 7 and 30 days, ISO weeks (Monday) for 90 and 365 days, months for all.
-- Every bucket of the frame is present, so gaps stay visible: a bucket without
-- changes carries one row with series NULL and n = 0.
--   bucket / bucket_index → the bucket as text and its position (0 = oldest)
--   bucket_label / tick   → the bucket for the tooltip and the short axis label
--   series                → object type, file, person key or module key (`stack`);
--                           '__other__' collects every entity without a slot (and
--                           objects outside the module partition), '__bulk__' the
--                           mass events (only with bulk=include, hatched)
--   series_label          → display text (type id, file name, person name, module
--                           name; without a partition the file is the module)
--   slot                  → colour slot 1–7; 0 = other, -1 = mass events. Types have
--                           a fixed slot; files, persons and modules take theirs from
--                           their solution-wide rank by individual changes, so a
--                           filter never repaints a series
--   series_total / series_members → the series over the frame (legend order and
--                           "Other (n)")
--   n / bucket_n          → objects (or bursts with count=actions) of the series in
--                           the bucket / of the whole bucket
--   bulk_objects / bulk_events → mass events in the bucket matching the filters,
--                           counted also while they are hidden (annotation)
--   from_at / to_at       → the bucket as drill-down window (to the second, clamped
--                           to the period); is_selected → it is the active window
--   grain, stack_by, count_mode, bulk_mode → echoed for the primitive and the clicks
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
-- >>> shared partition block — identical in every dataset that maps objects to the
-- modules of the cluster partition (unit test dashboard-changelog-blocks guards it);
-- change it in all files at once.
--   engine           the cluster engine with the most rows (as the graph views pick it)
--   clusters         the community of every clustered object, keyed by UUID and file
--   partition_state  has_partition: the catalog carries a community partition. The
--                    API provides empty stand-ins when the cluster layer is missing;
--                    without a partition a file is the module
--   module_names     display name per community: Semantic_Name, else Heuristic_Name
--                    without its member-count suffix "(+N)"
engine AS (
    SELECT oc.Engine
    FROM ObjectClusters oc
    WHERE oc.Engine IS NOT NULL
    GROUP BY oc.Engine
    ORDER BY count(*) DESC, oc.Engine
    LIMIT 1
),
clusters AS (
    SELECT oc.Object_UUID, oc.File_Name, oc.Community, oc.Engine
    FROM ObjectClusters oc
    JOIN engine e ON e.Engine = oc.Engine
),
partition_state AS (
    SELECT count(*) > 0 AS has_partition FROM clusters
),
module_names AS (
    SELECT cn.Community, cn.Engine,
           COALESCE(NULLIF(trim(cn.Semantic_Name), ''),
                    regexp_replace(cn.Heuristic_Name, ' \(\+[0-9]+\)$', ''))   AS module_name
    FROM CommunityNames cn
)
-- <<< shared partition block
,
stamp_modules AS (
    -- module of every stamp, only for stack=module: its community, without a
    -- partition its file; module_key NULL = an object outside the partition
    SELECT s.Object_UUID, s.File_Name,
           CASE WHEN ps.has_partition THEN CAST(cl.Community AS VARCHAR)
                ELSE s.File_Name END                                           AS module_key,
           CASE WHEN NOT ps.has_partition THEN s.File_Name
                WHEN cl.Community IS NOT NULL
                THEN COALESCE(mn.module_name, '#' || cl.Community) END         AS module_name
    FROM stamps s
    CROSS JOIN params p
    CROSS JOIN partition_state ps
    LEFT JOIN clusters cl     ON cl.Object_UUID = s.Object_UUID AND cl.File_Name = s.File_Name
    LEFT JOIN module_names mn ON mn.Community = cl.Community AND mn.Engine = cl.Engine
    WHERE p.stack_by = 'module'
),
frame AS (
    SELECT
        CASE WHEN p.days IN ('7', '30') THEN 'day'
             WHEN p.days = 'all' THEN 'month'
             ELSE 'week' END                                                   AS grain,
        pe.lo                                                                  AS lo,
        COALESCE(pe.lo, (SELECT min(c.Modified_At) FROM charted c), an.anchor_at) AS start_at,
        greatest(an.anchor_at, COALESCE((SELECT max(c.Modified_At) FROM charted c), an.anchor_at)) AS hi,
        p.stack_by, p.count_mode, p.bulk, p.w_from, p.w_to
    FROM params p, anchor an, period pe
),
buckets AS (
    SELECT g.b_start,
           g.b_start + CASE f.grain WHEN 'day' THEN INTERVAL 1 DAY
                                    WHEN 'week' THEN INTERVAL 7 DAY
                                    ELSE INTERVAL 1 MONTH END                  AS b_end,
           row_number() OVER (ORDER BY g.b_start) - 1                          AS b_index
    FROM frame f,
         generate_series(date_trunc(f.grain, f.start_at), date_trunc(f.grain, f.hi),
                         CASE f.grain WHEN 'day' THEN INTERVAL 1 DAY
                                      WHEN 'week' THEN INTERVAL 7 DAY
                                      ELSE INTERVAL 1 MONTH END) g(b_start)
),
ranked AS (
    -- solution-wide rank of files, persons and modules by individual changes (not
    -- filtered); an object outside the partition takes no slot
    SELECT k, row_number() OVER (ORDER BY n DESC, k) AS r
    FROM (SELECT CASE WHEN p.stack_by = 'file' THEN s.File_Name
                      WHEN p.stack_by = 'module' THEN sm.module_key
                      ELSE s.Person_Key END                                    AS k,
                 count(*) AS n
          FROM stamps s
          CROSS JOIN params p
          LEFT JOIN stamp_modules sm ON sm.Object_UUID = s.Object_UUID AND sm.File_Name = s.File_Name
          WHERE s.Bulk_Event_ID IS NULL
          GROUP BY 1)
    WHERE k IS NOT NULL
),
inframe AS (
    SELECT date_trunc(f.grain, c.Modified_At) AS b_start, c.Burst_ID, c.Bulk_Event_ID,
           CASE WHEN f.stack_by = 'file' THEN c.File_Name
                WHEN f.stack_by = 'person' THEN c.Person_Key
                WHEN f.stack_by = 'module' THEN sm.module_key
                ELSE c.Object_Type END                                         AS entity,
           CASE WHEN f.stack_by = 'person' THEN c.Person_Name
                WHEN f.stack_by = 'file' THEN c.File_Name
                WHEN f.stack_by = 'module' THEN sm.module_name
                ELSE c.Object_Type END                                         AS entity_label
    FROM charted c
    CROSS JOIN frame f
    LEFT JOIN stamp_modules sm ON sm.Object_UUID = c.Object_UUID AND sm.File_Name = c.File_Name
),
slotted AS (
    SELECT i.b_start, i.Burst_ID, i.Bulk_Event_ID, i.entity, i.entity_label,
           CASE
               WHEN i.Bulk_Event_ID IS NOT NULL THEN -1
               WHEN f.stack_by IN ('file', 'person', 'module') THEN
                   CASE WHEN r.r <= 7 THEN CAST(r.r AS INTEGER) ELSE 0 END
               ELSE CASE i.entity
                        WHEN 'Script' THEN 1 WHEN 'Layout' THEN 2 WHEN 'Field' THEN 3
                        WHEN 'Relationship' THEN 4 WHEN 'ValueList' THEN 5
                        WHEN 'CustomFunction' THEN 6 WHEN 'TableOccurrence' THEN 7
                        ELSE 0 END
           END                                                                 AS slot
    FROM inframe i
    CROSS JOIN frame f
    LEFT JOIN ranked r ON r.k = i.entity
    WHERE f.bulk = 'include' OR i.Bulk_Event_ID IS NULL
),
series_of AS (
    SELECT s.b_start, s.Burst_ID, s.slot,
           CASE s.slot WHEN -1 THEN '__bulk__' WHEN 0 THEN '__other__' ELSE s.entity END AS series,
           CASE s.slot WHEN -1 THEN NULL WHEN 0 THEN NULL ELSE s.entity_label END AS series_label,
           s.entity
    FROM slotted s
),
cell AS (
    SELECT b_start, series, slot, any_value(series_label) AS series_label,
           count(*) AS objects, count(DISTINCT Burst_ID) AS actions
    FROM series_of
    GROUP BY ALL
),
legend AS (
    SELECT series, slot, any_value(series_label) AS series_label,
           count(*) AS objects, count(DISTINCT Burst_ID) AS actions,
           count(DISTINCT entity) AS members
    FROM series_of
    GROUP BY ALL
),
bulk AS (
    SELECT date_trunc(f.grain, c.Modified_At) AS b_start,
           count(*) AS bulk_objects, count(DISTINCT c.Bulk_Event_ID) AS bulk_events
    FROM charted c, frame f
    WHERE c.Bulk_Event_ID IS NOT NULL
    GROUP BY 1
),
grid AS (
    -- every bucket × every series of the frame; buckets of an empty frame keep one
    -- row with series NULL
    SELECT b.b_start, b.b_end, b.b_index, l.series, l.slot, l.series_label,
           CASE WHEN f.count_mode = 'actions' THEN l.actions ELSE l.objects END AS series_total,
           l.members AS series_members
    FROM buckets b
    CROSS JOIN frame f
    LEFT JOIN legend l ON true
),
valued AS (
    SELECT g.b_start, g.b_end, g.b_index, g.series, g.slot, g.series_label,
           g.series_total, g.series_members,
           COALESCE(CASE WHEN f.count_mode = 'actions' THEN c.actions ELSE c.objects END, 0) AS n
    FROM grid g
    CROSS JOIN frame f
    LEFT JOIN cell c ON c.b_start = g.b_start AND c.series = g.series
),
totals AS (
    SELECT b_start, sum(n) AS bucket_n FROM valued GROUP BY b_start
)
SELECT
    CASE f.grain WHEN 'month' THEN strftime(v.b_start, '%Y-%m')
                 ELSE strftime(v.b_start, '%Y-%m-%d') END                     AS bucket,
    v.b_index                                                                 AS bucket_index,
    CASE f.grain WHEN 'day' THEN strftime(v.b_start, '%Y-%m-%d')
                 WHEN 'week' THEN strftime(v.b_start, '%Y-%m-%d') || ' – ' ||
                                  strftime(v.b_end - INTERVAL 1 DAY, '%Y-%m-%d')
                 ELSE strftime(v.b_start, '%Y-%m') END                        AS bucket_label,
    CASE f.grain WHEN 'month' THEN strftime(v.b_start, '%Y-%m')
                 ELSE strftime(v.b_start, '%m-%d') END                        AS tick,
    f.grain                                                                   AS grain,
    v.series                                                                  AS series,
    v.series_label                                                            AS series_label,
    v.slot                                                                    AS slot,
    v.series_total                                                            AS series_total,
    v.series_members                                                          AS series_members,
    v.n                                                                       AS n,
    t.bucket_n                                                                AS bucket_n,
    COALESCE(bk.bulk_objects, 0)                                              AS bulk_objects,
    COALESCE(bk.bulk_events, 0)                                               AS bulk_events,
    strftime(CASE WHEN f.lo IS NOT NULL AND v.b_start <= f.lo
                  THEN f.lo + INTERVAL 1 SECOND ELSE v.b_start END,
             '%Y-%m-%d %H:%M:%S')                                             AS from_at,
    strftime(v.b_end - INTERVAL 1 SECOND, '%Y-%m-%d %H:%M:%S')                AS to_at,
    COALESCE(strftime(f.w_from, '%Y-%m-%d %H:%M:%S') =
             strftime(CASE WHEN f.lo IS NOT NULL AND v.b_start <= f.lo
                           THEN f.lo + INTERVAL 1 SECOND ELSE v.b_start END, '%Y-%m-%d %H:%M:%S')
             AND strftime(f.w_to, '%Y-%m-%d %H:%M:%S') =
                 strftime(v.b_end - INTERVAL 1 SECOND, '%Y-%m-%d %H:%M:%S'), false) AS is_selected,
    f.stack_by                                                                AS stack_by,
    f.count_mode                                                              AS count_mode,
    f.bulk                                                                    AS bulk_mode
FROM valued v
CROSS JOIN frame f
JOIN totals t ON t.b_start = v.b_start
LEFT JOIN bulk bk ON bk.b_start = v.b_start
ORDER BY v.b_start, CASE WHEN v.slot > 0 THEN v.slot WHEN v.slot = 0 THEN 8 ELSE 9 END;
