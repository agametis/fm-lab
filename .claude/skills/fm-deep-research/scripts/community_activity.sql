-- @title: Development activity (R1/R4, section "activity") — module classes by change age
-- @description: Three result sets for the report section "Development activity": (1) the
--               solution-wide state — data state, share of mass/technical stamps, individual
--               changes in 90/365 days, persons, module classes, mass dominance; (2) one row per
--               segment described in Appendix A — activity class, newest change, active members,
--               medians, mass share; (3) the timeline of the larger mass events.
--               The classes are the same as in the Graph Atlas, the Graph Explorer and the
--               dashboard "Module activity" (shared activity block below; the unit test
--               activity-block of the REST API keeps the copies identical).
-- @version: 1.0.0
-- @tags: change-meta, activity, cluster, report
-- @note: read-only (TEMP tables only). Variables: engine (required) · top (default 15: rows of
--        result set 2) · min_members (default 3) · include_formulaic (default false) — the
--        same selection as community_signals.sql, so set 2 matches Appendix A · activity_bulk
--        ('include' lets a mass stamp date the last change; default 'hide').
--        Technical authors come from ObjectChangeMeta.Author_Kind — the curated aliases of
--        the REST API (v_change_meta_authors) live in the annotation sidecar and are not
--        read here; a solution whose aliases mark further technical authors can differ
--        from the Atlas in a few classes (say so in the report when aliases exist).
--        A catalog without change stamps returns empty sets 2/3 and stamps = 0 in set 1.

CREATE OR REPLACE TEMP TABLE activity_community AS
WITH
activity_input AS (
    -- every stamp; individual = no mass event and no technical author (Author_Kind)
    SELECT m.Object_UUID, m.File_Name, m.Object_Type, m.Modified_At, m.Modifications,
           m.Bulk_Event_ID IS NULL AND m.Author_Kind IS NULL                    AS Is_Individual,
           COALESCE(CAST(getvariable('activity_bulk') AS VARCHAR), 'hide') = 'include'
             OR (m.Bulk_Event_ID IS NULL AND m.Author_Kind IS NULL)            AS Age_Known
    FROM ObjectChangeMeta m
    WHERE m.Modified_At IS NOT NULL
),
activity_members AS (
    -- the members of every community of the partition
    SELECT CAST(oc.Community AS VARCHAR) AS Group_Key, oc.Object_UUID, oc.File_Name
    FROM ObjectClusters oc
    WHERE oc.Engine = getvariable('engine')
),
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
SELECT ag.*, aa.anchor_at
FROM activity_groups ag, activity_anchor aa;

-- #1 solution-wide state (one row)
WITH st AS (
    SELECT
        count(*)                                                                AS stamps,
        count(*) FILTER (WHERE Bulk_Event_ID IS NOT NULL OR Author_Kind IS NOT NULL) AS undated,
        max(Modified_At) FILTER (WHERE Bulk_Event_ID IS NULL AND Author_Kind IS NULL) AS data_state
    FROM ObjectChangeMeta
    WHERE Modified_At IS NOT NULL
),
recent AS (
    SELECT
        count(*) FILTER (WHERE m.Modified_At > st.data_state - INTERVAL 90 DAY)  AS individual_90,
        count(*) FILTER (WHERE m.Modified_At > st.data_state - INTERVAL 365 DAY) AS individual_365,
        count(DISTINCT m.Author_Key) FILTER (WHERE m.Modified_At > st.data_state - INTERVAL 365 DAY) AS persons_365
    FROM ObjectChangeMeta m, st
    WHERE m.Bulk_Event_ID IS NULL AND m.Author_Kind IS NULL AND m.Modified_At IS NOT NULL
),
mods AS (
    SELECT
        count(*)                                              AS modules,
        count(*) FILTER (WHERE activity_class <= 2)           AS active_le_90d,
        count(*) FILTER (WHERE activity_class IN (3, 4))      AS aging_le_2y,
        count(*) FILTER (WHERE activity_class = 5)            AS resting_gt_2y,
        count(*) FILTER (WHERE activity_class = 6)            AS unknown,
        count(*) FILTER (WHERE activity_class = 7)            AS no_stamp,
        sum(class_counts[6])                                  AS nodes_unknown,
        sum(members)                                          AS nodes
    FROM activity_community
)
SELECT
    strftime(st.data_state, '%Y-%m-%d')                                      AS data_state,
    st.stamps,
    round(100.0 * st.undated / NULLIF(st.stamps, 0), 1)                      AS mass_or_technical_pct,
    r.individual_90, r.individual_365, r.persons_365,
    m.modules, m.active_le_90d, m.aging_le_2y, m.resting_gt_2y, m.unknown, m.no_stamp,
    round(100.0 * m.nodes_unknown / NULLIF(m.nodes, 0), 1)                   AS nodes_unknown_pct,
    COALESCE(100.0 * m.nodes_unknown / NULLIF(m.nodes, 0) > 80, false)       AS mass_dominant
FROM st, recent r, mods m;

-- #2 one row per segment of Appendix A (same selection as community_signals.sql, top N)
WITH selected AS (
    SELECT Community, Member_Count,
           COALESCE(NULLIF(trim(Semantic_Name), ''),
                    regexp_replace(Heuristic_Name, ' \(\+[0-9]+\)$', ''))   AS Name
    FROM CommunityNames
    WHERE Engine = getvariable('engine')
      AND Member_Count >= COALESCE(getvariable('min_members'), 3)
      AND (COALESCE(getvariable('include_formulaic'), false)
           OR Dominant_Type NOT IN ('PrivilegeSet', 'Account', 'ExtendedPrivilege', 'CustomMenu', 'CustomMenuItem'))
    ORDER BY Member_Count DESC, Community
    LIMIT (COALESCE(getvariable('top'), 15))
)
SELECT
    s.Community,
    s.Name,
    a.members,
    CASE a.activity_class
        WHEN 1 THEN '<= 30 days' WHEN 2 THEN '<= 90 days' WHEN 3 THEN '<= 1 year'
        WHEN 4 THEN '<= 2 years' WHEN 5 THEN '> 2 years' WHEN 6 THEN 'unknown'
        ELSE 'no stamp' END                                                 AS activity,
    left(a.newest_change, 10)                                               AS newest_change,
    a.newest_age_days,
    a.active_90,
    a.median_age_days,
    a.median_saves,
    a.saves_level,
    round(100.0 * a.undated / NULLIF(a.stamped, 0), 0)                      AS mass_pct
FROM selected s
JOIN activity_community a ON a.Group_Key = CAST(s.Community AS VARCHAR)
ORDER BY s.Member_Count DESC, s.Community;

-- #3 timeline of the larger mass events (>= 25 objects), at most 15, oldest first
SELECT
    strftime(e.Start_At, '%Y-%m-%d')                                        AS date,
    e.Kind, e.Scope, e.Objects, e.Files,
    array_to_string(list_slice(e.File_Names, 1, 3), ', ')
      || CASE WHEN len(e.File_Names) > 3 THEN ' +' || CAST(len(e.File_Names) - 3 AS VARCHAR) ELSE '' END AS files
FROM (SELECT * FROM ChangeBulkEvents WHERE Objects >= 25 ORDER BY Objects DESC LIMIT 15) e
ORDER BY e.Start_At;
