-- KPI row and chip counts of the dashboard "Security changes".
--   changes … authorizations  stamps of the chosen author kind, per object type
--   by_developer / by_runtime / by_tool  stamps per author kind (chip counts,
--                 before the author-kind filter)
--   mass_events   mass events with security objects in the period
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
-- >>> shared security block — identical in every dataset of this bundle that lists
-- or counts stamps (unit test dashboard-changelog-blocks guards it); change it in
-- all files at once.
--   sec_params  actor: all (default) | developer | runtime | tool
--   sec_stamps  the filtered stamps of the security objects (accounts, privilege
--               sets, extended privileges, authorizations) with the kind of their
--               author: developer (a person), runtime (an end user at runtime,
--               e.g. a WebDirect session changing a password) or tool (a migration
--               or another tool, and authors marked technical in the aliases)
--   sec_shown   sec_stamps of the chosen author kind
sec_params AS (
    SELECT COALESCE(NULLIF(CAST(getvariable('actor') AS VARCHAR), ''), 'all') AS actor
),
sec_stamps AS (
    SELECT
        f.Object_UUID, f.File_Name, f.Object_Type, f.Object_Name, f.Modified_At,
        f.Modified_Account, f.Modifications, f.Burst_ID, f.Bulk_Event_ID,
        f.Person_Key, f.Person_Name,
        CASE WHEN NOT f.Is_Technical THEN 'developer'
             WHEN m.Author_Kind = 'runtime' THEN 'runtime'
             ELSE 'tool' END                                       AS actor_kind
    FROM filtered f
    LEFT JOIN ObjectChangeMeta m ON m.Object_UUID = f.Object_UUID AND m.File_Name = f.File_Name
    WHERE f.Object_Type IN ('Account', 'Authorization', 'ExtendedPrivilege', 'PrivilegeSet')
),
sec_shown AS (
    SELECT
        s.Object_UUID, s.File_Name, s.Object_Type, s.Object_Name, s.Modified_At,
        s.Modified_Account, s.Modifications, s.Burst_ID, s.Bulk_Event_ID,
        s.Person_Key, s.Person_Name, s.actor_kind
    FROM sec_stamps s, sec_params sp
    WHERE sp.actor = 'all' OR s.actor_kind = sp.actor
)
-- <<< shared security block
SELECT
    (SELECT count(*) FROM sec_shown)                                              AS changes,
    (SELECT count(*) FROM sec_shown s WHERE s.Object_Type = 'Account')            AS accounts,
    (SELECT count(*) FROM sec_shown s WHERE s.Object_Type = 'PrivilegeSet')       AS privilege_sets,
    (SELECT count(*) FROM sec_shown s WHERE s.Object_Type = 'ExtendedPrivilege')  AS extended_privileges,
    (SELECT count(*) FROM sec_shown s WHERE s.Object_Type = 'Authorization')      AS authorizations,
    (SELECT count(*) FROM sec_stamps s)                                           AS by_all,
    (SELECT count(*) FROM sec_stamps s WHERE s.actor_kind = 'developer')          AS by_developer,
    (SELECT count(*) FROM sec_stamps s WHERE s.actor_kind = 'runtime')            AS by_runtime,
    (SELECT count(*) FROM sec_stamps s WHERE s.actor_kind = 'tool')               AS by_tool,
    (SELECT count(DISTINCT sc.Bulk_Event_ID) FROM scoped sc
      WHERE sc.Object_Type IN ('Account', 'Authorization', 'ExtendedPrivilege', 'PrivilegeSet')) AS mass_events;
