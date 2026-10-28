-- The selected module (param `module`) of the dashboard "Module activity": one row
-- with its figures for the detail card, independent of the narrowing filters (the
-- selection also arrives from the Graph Atlas), plus the click targets:
--   atlas_path    the module's tile in the Graph Atlas, coloured by activity
--   module_files  the files of its members, comma-separated — the drill-down to
--                 "Recent changes" filters by them (the changes of these files,
--                 a superset of the module's own changes)
--   days, anchor, technical, bulk  the current filters, passed through
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
-- >>> shared module input block — identical in every dataset of this bundle that
-- classifies modules (unit test dashboard-changelog-blocks guards it); change it in
-- all files at once.
--   activity_input    every stamp with the curated technical flag (as in the filter
--                     block); with bulk=include a mass stamp dates the last change
--                     like an individual one
--   activity_members  the module of every object: its community, or — without a
--                     partition — its file
activity_input AS (
    SELECT s.Object_UUID, s.File_Name, s.Object_Type, s.Modified_At, s.Modifications,
           s.Bulk_Event_ID IS NULL AND NOT s.Is_Technical                         AS Is_Individual,
           p.bulk = 'include' OR (s.Bulk_Event_ID IS NULL AND NOT s.Is_Technical) AS Age_Known
    FROM stamps s, params p
),
activity_members AS (
    SELECT CAST(cl.Community AS VARCHAR) AS Group_Key, cl.Object_UUID, cl.File_Name
    FROM clusters cl
    UNION ALL
    SELECT s.File_Name, s.Object_UUID, s.File_Name
    FROM stamps s, partition_state ps
    WHERE NOT ps.has_partition
)
-- <<< shared module input block
,
-- >>> shared activity block — identical in every dataset, graph overview template
-- and skill script that classifies change activity (unit test activity-block guards
-- it); change it in all files at once.
--   activity_input    defined by each carrier right before: one row per stamped
--                     object — Object_UUID, File_Name, Object_Type, Modified_At,
--                     Modifications, Is_Individual (no mass event, no technical
--                     author) and Age_Known (the stamp dates the last real change:
--                     Is_Individual, or every stamp when mass events are included)
--   activity_members  defined by each carrier right before: Group_Key, Object_UUID,
--                     File_Name — the members of every tile or module; a member
--                     without stamp counts as "no stamp"
--   activity_anchor   the data state: newest individual change, else newest stamp
--   activity_nodes    class per stamped object: 1 ≤ 30 days · 2 ≤ 90 days · 3 ≤ 1 year
--                     · 4 ≤ 2 years · 5 > 2 years · 6 unknown. A stamp that does not
--                     date the last real change (mass event, technical author) only
--                     bounds it from above: older than 2 years → 5, else unknown,
--                     never young. saves_rank = mid-rank of the lifetime save counter
--                     within the object type, solution-wide: (percent_rank + cume_dist)
--                     / 2, so ties share the middle of their range and a filter never
--                     moves it (activity_ranks computes it over the distinct counter
--                     values of each type — a window over every stamp costs ~10× more)
--   activity_groups   per Group_Key: activity_class = the youngest class of a member
--                     (6 = only unknown members, 7 = no member with a stamp),
--                     class_counts = members per class 1…7, newest_change and its age,
--                     active_90 (members with a dated change ≤ 90 days), median age
--                     and saves, undated (stamped members whose stamp is undated),
--                     saves_level 1…5 from the mean saves_rank (limits 0.3 · 0.4 · 0.5
--                     · 0.6), and saves_sum/saves_n to merge groups
activity_anchor AS (
    SELECT COALESCE(max(ai.Modified_At) FILTER (WHERE ai.Is_Individual),
                    max(ai.Modified_At))                               AS anchor_at
    FROM activity_input ai
),
activity_ranks AS (
    SELECT v.Object_Type, v.saves,
           ((CASE WHEN v.n > 1 THEN v.below / (v.n - 1) ELSE 0 END) + (v.below + v.c) / v.n) / 2
                                                                       AS saves_rank
    FROM (
        SELECT g.Object_Type, g.saves, g.c,
               sum(g.c) OVER (PARTITION BY g.Object_Type ORDER BY g.saves) - g.c AS below,
               sum(g.c) OVER (PARTITION BY g.Object_Type)                    AS n
        FROM (SELECT ai.Object_Type, COALESCE(ai.Modifications, 0) AS saves, count(*) AS c
                FROM activity_input ai
               GROUP BY ai.Object_Type, COALESCE(ai.Modifications, 0)) g
    ) v
),
activity_nodes AS (
    SELECT
        ai.Object_UUID, ai.File_Name, ai.Object_Type, ai.Modified_At, ai.Modifications,
        ai.Is_Individual, ai.Age_Known,
        date_diff('day', ai.Modified_At, aa.anchor_at)                 AS age_days,
        CASE
            WHEN NOT ai.Age_Known
                 AND ai.Modified_At >= aa.anchor_at - INTERVAL 730 DAY   THEN 6
            WHEN ai.Modified_At >= aa.anchor_at - INTERVAL 30 DAY       THEN 1
            WHEN ai.Modified_At >= aa.anchor_at - INTERVAL 90 DAY       THEN 2
            WHEN ai.Modified_At >= aa.anchor_at - INTERVAL 365 DAY      THEN 3
            WHEN ai.Modified_At >= aa.anchor_at - INTERVAL 730 DAY      THEN 4
            ELSE 5
        END                                                            AS activity_class,
        ar.saves_rank
    FROM activity_input ai
    CROSS JOIN activity_anchor aa
    JOIN activity_ranks ar
      ON ar.Object_Type = ai.Object_Type AND ar.saves = COALESCE(ai.Modifications, 0)
),
activity_groups AS (
    SELECT
        am.Group_Key,
        CAST(count(*) AS INTEGER)                                      AS members,
        CAST(COALESCE(min(an.activity_class),  7) AS INTEGER)          AS activity_class,
        [CAST(count(*) FILTER (WHERE an.activity_class = 1) AS INTEGER),
         CAST(count(*) FILTER (WHERE an.activity_class = 2) AS INTEGER),
         CAST(count(*) FILTER (WHERE an.activity_class = 3) AS INTEGER),
         CAST(count(*) FILTER (WHERE an.activity_class = 4) AS INTEGER),
         CAST(count(*) FILTER (WHERE an.activity_class = 5) AS INTEGER),
         CAST(count(*) FILTER (WHERE an.activity_class = 6) AS INTEGER),
         CAST(count(*) FILTER (WHERE an.activity_class IS NULL) AS INTEGER)] AS class_counts,
        strftime(max(an.Modified_At) FILTER (WHERE an.Age_Known), '%Y-%m-%d %H:%M:%S') AS newest_change,
        CAST(min(an.age_days) FILTER (WHERE an.Age_Known) AS INTEGER)  AS newest_age_days,
        CAST(count(*) FILTER (WHERE an.Age_Known AND an.activity_class <= 2) AS INTEGER) AS active_90,
        CAST(round(median(an.age_days) FILTER (WHERE an.Age_Known)) AS INTEGER) AS median_age_days,
        CAST(round(median(an.Modifications)) AS INTEGER)               AS median_saves,
        CAST(count(an.Object_UUID) AS INTEGER)                         AS stamped,
        CAST(count(*) FILTER (WHERE NOT an.Age_Known) AS INTEGER)      AS undated,
        CASE WHEN count(an.saves_rank) = 0 THEN NULL
             WHEN avg(an.saves_rank) > 0.6 THEN 5
             WHEN avg(an.saves_rank) > 0.5 THEN 4
             WHEN avg(an.saves_rank) > 0.4 THEN 3
             WHEN avg(an.saves_rank) > 0.3 THEN 2
             ELSE 1 END                                                AS saves_level,
        sum(an.saves_rank)                                             AS saves_sum,
        CAST(count(an.saves_rank) AS INTEGER)                          AS saves_n
    FROM activity_members am
    LEFT JOIN activity_nodes an
           ON an.Object_UUID = am.Object_UUID AND an.File_Name = am.File_Name
    GROUP BY am.Group_Key
)
-- <<< shared activity block
,
-- >>> shared module rows block — identical in every dataset of this bundle that
-- lists or counts modules (unit test dashboard-changelog-blocks guards it); change
-- it in all files at once.
--   ma_params     state (all (default) | active | aging | resting | unknown | none),
--                 module (the selected module key), mq (search over the module
--                 names), sort (activity (default) | saves | changes)
--   touched       modules with an object matching the filters other than time and
--                 mass events (type, file, person, technical authors, search)
--   period_people per module and person: the changes in the period (filtered)
--   period_stats  per module: changes, persons and their names, most active first
--   module_all    one row per module: name, class (activity_groups) as label and
--                 state, shares, changes and persons in the period
--   module_rows   module_all narrowed to the touched modules once type, file,
--                 person or search narrow the stamps; otherwise every module
ma_params AS (
    SELECT
        COALESCE(NULLIF(CAST(getvariable('state') AS VARCHAR), ''), 'all')     AS state,
        NULLIF(CAST(getvariable('module') AS VARCHAR), '')                     AS module_key,
        lower(NULLIF(trim(CAST(getvariable('mq') AS VARCHAR)), ''))            AS mq,
        COALESCE(NULLIF(CAST(getvariable('sort') AS VARCHAR), ''), 'activity') AS sort_by
),
touched AS (
    SELECT DISTINCT am.Group_Key
    FROM base b
    JOIN activity_members am ON am.Object_UUID = b.Object_UUID AND am.File_Name = b.File_Name
),
period_people AS (
    SELECT am.Group_Key, f.Person_Key,
           any_value(f.Person_Name) AS person_name,
           count(*)                 AS n
    FROM filtered f
    JOIN activity_members am ON am.Object_UUID = f.Object_UUID AND am.File_Name = f.File_Name
    GROUP BY am.Group_Key, f.Person_Key
),
period_stats AS (
    SELECT pp.Group_Key,
           sum(pp.n)                                                  AS changes,
           count(*)                                                   AS persons,
           list(pp.person_name ORDER BY pp.n DESC, pp.person_name)    AS person_names
    FROM period_people pp
    GROUP BY pp.Group_Key
),
module_all AS (
    SELECT
        ag.Group_Key                                                        AS module_key,
        CASE WHEN ps.has_partition THEN COALESCE(mn.module_name, '#' || ag.Group_Key)
             ELSE ag.Group_Key END                                          AS module_name,
        ag.members, ag.activity_class, ag.class_counts, ag.newest_change, ag.newest_age_days,
        ag.active_90, ag.median_age_days, ag.median_saves, ag.stamped, ag.undated,
        ag.saves_level, ag.saves_sum, ag.saves_n,
        CASE ag.activity_class
            WHEN 1 THEN '≤ 30 days' WHEN 2 THEN '≤ 90 days' WHEN 3 THEN '≤ 1 year'
            WHEN 4 THEN '≤ 2 years' WHEN 5 THEN '> 2 years' WHEN 6 THEN 'Unknown'
            ELSE 'No stamp' END                                             AS activity,
        CASE WHEN ag.activity_class <= 2 THEN 'active'
             WHEN ag.activity_class <= 4 THEN 'aging'
             WHEN ag.activity_class = 5 THEN 'resting'
             WHEN ag.activity_class = 6 THEN 'unknown'
             ELSE 'none' END                                                AS state,
        round(100.0 * ag.active_90 / ag.members, 1)                         AS active_90_pct,
        round(100.0 * ag.undated / NULLIF(ag.stamped, 0), 1)                AS undated_pct,
        CAST(COALESCE(pst.changes, 0) AS INTEGER)                           AS changes,
        CAST(COALESCE(pst.persons, 0) AS INTEGER)                           AS persons,
        pst.person_names
    FROM activity_groups ag
    CROSS JOIN partition_state ps
    LEFT JOIN period_stats pst ON pst.Group_Key = ag.Group_Key
    LEFT JOIN engine e ON true
    LEFT JOIN module_names mn
           ON ps.has_partition AND mn.Engine = e.Engine
          AND CAST(mn.Community AS VARCHAR) = ag.Group_Key
),
module_rows AS (
    SELECT ma.*
    FROM module_all ma, params p
    WHERE (p.types IS NULL AND p.files IS NULL AND p.person IS NULL AND p.q IS NULL)
       OR ma.module_key IN (SELECT t.Group_Key FROM touched t)
)
-- <<< shared module rows block
,
module_files AS (
    SELECT am.Group_Key,
           array_to_string(list(DISTINCT am.File_Name ORDER BY am.File_Name), ',') AS files,
           CAST(count(DISTINCT am.File_Name) AS INTEGER)                       AS file_count
    FROM activity_members am
    CROSS JOIN ma_params mp
    WHERE am.Group_Key = mp.module_key AND am.File_Name IS NOT NULL
    GROUP BY am.Group_Key
)
SELECT
    ma.module_key                                                   AS module_key,
    ma.module_name                                                  AS module_name,
    ma.members                                                      AS members,
    ma.activity                                                     AS activity,
    ma.activity_class                                               AS activity_class,
    left(ma.newest_change, 10)                                      AS newest_date,
    ma.newest_age_days                                              AS newest_age_days,
    ma.active_90_pct                                                AS active_90_pct,
    ma.median_age_days                                              AS median_age_days,
    ma.median_saves                                                 AS median_saves,
    ma.undated_pct                                                  AS undated_pct,
    ma.changes                                                      AS changes,
    ma.persons                                                      AS persons,
    COALESCE(mf.file_count, 0)                                      AS file_count,
    '/atlas?segment_by=' || CASE WHEN ps.has_partition THEN 'community' ELSE 'file' END
        || '&seg=' || url_encode(ma.module_key)
        || '&seg_label=' || url_encode(ma.module_name)
        || '&color=recency'                                         AS atlas_path,
    mf.files                                                        AS module_files,
    p.days                                                          AS days,
    p.anchor                                                        AS anchor,
    p.technical                                                     AS technical,
    p.bulk                                                          AS bulk
FROM module_all ma
CROSS JOIN ma_params mp
CROSS JOIN partition_state ps
CROSS JOIN params p
LEFT JOIN module_files mf ON mf.Group_Key = ma.module_key
WHERE ma.module_key = mp.module_key;
