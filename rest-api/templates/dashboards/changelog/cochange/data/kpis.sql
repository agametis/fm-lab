-- KPI row: work sessions with two or more objects, the object pairs in them, the
-- weighted share of pairs within one module against the random baseline, and the
-- large sessions. A pair of a session with n objects weighs 1/(n−1): every object
-- spreads the weight 1 over its partners, so large sessions do not dominate.
--   same_module_pct      weighted share of pairs in the same module, over the
--                        pairs whose two objects both have a module
--   random_pct           Σ p² over the module shares of all objects in the filter
--                        scope: the chance that a random pair shares a module
--   module_coverage_pct  session objects with a module (the rest are isolated
--                        nodes of the graph and count only in n)
--   _weight_known        total weight of the pairs with two modules (the coupling
--                        table adds up to it); _weight_all = Σ n/2, the weight of
--                        all pairs — each object spreads exactly 1
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
    -- individual changes only: a mass event is no work session
    SELECT
        f.Object_UUID, f.File_Name, f.Object_Type, f.Modified_At, f.Person_Key, f.Person_Name
    FROM filtered f
    WHERE f.Bulk_Event_ID IS NULL
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
-- >>> shared module block — identical in every dataset of this bundle (unit test
-- dashboard-changelog-blocks guards it); change it in all files at once.
--   members          session members with module key and name; module_key NULL =
--                    an object without community (an isolated node of the graph)
--   session_sizes    n, start, end and person per session
--   module_counts    per session and module: c = the members in that module
members AS (
    SELECT
        ns.Person_Key, ns.session_no, ns.Object_UUID, ns.File_Name, ns.Modified_At, ns.Person_Name,
        CASE WHEN ps.has_partition THEN CAST(cl.Community AS VARCHAR)
             ELSE ns.File_Name END                                      AS module_key,
        CASE WHEN NOT ps.has_partition THEN ns.File_Name
             WHEN cl.Community IS NOT NULL
             THEN COALESCE(mn.module_name, '#' || cl.Community) END     AS module_name
    FROM numbered_steps ns
    CROSS JOIN partition_state ps
    LEFT JOIN clusters cl     ON cl.Object_UUID = ns.Object_UUID AND cl.File_Name = ns.File_Name
    LEFT JOIN module_names mn ON mn.Community = cl.Community AND mn.Engine = cl.Engine
),
session_sizes AS (
    SELECT m.Person_Key, m.session_no,
           count(*)                AS n,
           min(m.Modified_At)      AS start_at,
           max(m.Modified_At)      AS end_at,
           any_value(m.Person_Name) AS person
    FROM members m
    GROUP BY m.Person_Key, m.session_no
),
module_counts AS (
    SELECT m.Person_Key, m.session_no, m.module_key,
           any_value(m.module_name) AS module_name,
           count(*)                 AS c
    FROM members m
    WHERE m.module_key IS NOT NULL
    GROUP BY m.Person_Key, m.session_no, m.module_key
)
-- <<< shared module block
,
session_pairs AS (
    SELECT ss.Person_Key, ss.session_no, ss.n,
           COALESCE(sum(mc.c), 0)                       AS k,
           COALESCE(sum(mc.c * (mc.c - 1) / 2.0), 0)    AS within_pairs
    FROM session_sizes ss
    LEFT JOIN module_counts mc ON mc.Person_Key = ss.Person_Key AND mc.session_no = ss.session_no
    WHERE ss.n >= 2
    GROUP BY ss.Person_Key, ss.session_no, ss.n
),
module_shares AS (
    SELECT count(*) * 1.0 / sum(count(*)) OVER () AS p
    FROM base b
    CROSS JOIN partition_state ps
    LEFT JOIN clusters cl ON cl.Object_UUID = b.Object_UUID AND cl.File_Name = b.File_Name
    WHERE NOT ps.has_partition OR cl.Community IS NOT NULL
    GROUP BY CASE WHEN ps.has_partition THEN CAST(cl.Community AS VARCHAR) ELSE b.File_Name END
),
coverage AS (
    SELECT count(*) AS members, count(m.module_key) AS with_module FROM members m
)
SELECT
    count(sp.n)                                                              AS sessions,
    CAST(COALESCE(sum(sp.n * (sp.n - 1) / 2), 0) AS BIGINT)                  AS pairs,
    round(100 * sum(sp.within_pairs / (sp.n - 1))
              / NULLIF(sum(sp.k * (sp.k - 1) / 2.0 / (sp.n - 1)), 0), 1)     AS same_module_pct,
    (SELECT round(100 * sum(ms.p * ms.p), 1) FROM module_shares ms)          AS random_pct,
    count(sp.n) FILTER (WHERE sp.n > 50)                                     AS large_sessions,
    (SELECT round(100.0 * cv.with_module / NULLIF(cv.members, 0), 1)
       FROM coverage cv)                                                     AS module_coverage_pct,
    COALESCE(sum(sp.k * (sp.k - 1) / 2.0 / (sp.n - 1)), 0)                   AS _weight_known,
    COALESCE(sum(sp.n / 2.0), 0)                                             AS _weight_all
FROM session_pairs sp;
