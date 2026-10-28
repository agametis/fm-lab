-- The security change list: one row per stamp of an account, privilege set,
-- extended privilege or authorization, newest first, paged on the server (100
-- rows per page, URL param `page`).
--   assigned  account → its privilege set; extended privilege → the privilege
--             sets that hold it; privilege set → its description; authorization
--             → the authorized file
--   enabled   accounts only: yes / no
--   marker    'Mass event', 'Runtime change' (an end user at runtime) or
--             'Technical author'
--   uuid      NULL for authorizations (no detail view)
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
,
details AS (
    SELECT a.Account_UUID AS d_uuid, a.File_Name AS d_file, a.PrivilegeSet_Name AS assigned, a.Is_Enabled AS enabled
    FROM AccountsCatalog a
    UNION ALL
    SELECT e.EP_UUID, e.File_Name, array_to_string(e.PrivilegeSet_Names, ', '), NULL
    FROM ExtendedPrivilegesCatalog e
    UNION ALL
    SELECT p.PrivilegeSet_UUID, p.File_Name, NULLIF(trim(p.Description), ''), NULL
    FROM PrivilegeSetsCatalog p
    UNION ALL
    SELECT z.Auth_UUID, z.File_Name, z.Authorized_Name, NULL
    FROM FileAccessAuthorizations z
),
numbered AS MATERIALIZED (
    SELECT
           s.Object_UUID,
           s.File_Name,
           s.Object_Type,
           s.Object_Name,
           s.Modified_At,
           s.Modified_Account,
           s.Modifications,
           s.Bulk_Event_ID,
           s.Person_Name,
           s.actor_kind,
           d.assigned,
           d.enabled,
           row_number() OVER (ORDER BY s.Modified_At DESC, s.File_Name, s.Object_Type,
                                    s.Object_Name, s.Object_UUID)  AS rn,
           s.Modified_At AS _ord_1,
           s.File_Name AS _ord_2,
           s.Object_Type AS _ord_3,
           s.Object_Name AS _ord_4,
           s.Object_UUID AS _ord_5
    FROM sec_shown s
    LEFT JOIN details d ON d.d_uuid = s.Object_UUID AND d.d_file = s.File_Name
),
-- The list rows; the keys of the default order travel along as hidden
-- columns.
unkeyed AS MATERIALIZED (
    SELECT
        strftime(n.Modified_At, '%Y-%m-%d %H:%M')                     AS at,
        n.Object_Type                                                  AS type,
        n.Object_Name                                                  AS name,
        n.File_Name                                                    AS file,
        n.Person_Name                                                  AS person,
        n.Modified_Account                                             AS account,
        n.Modifications                                                AS modifications,
        n.assigned                                                     AS assigned,
        CASE WHEN n.enabled THEN 'yes' WHEN NOT n.enabled THEN 'no' END AS enabled,
        CASE WHEN n.Bulk_Event_ID IS NOT NULL THEN 'Mass event'
         WHEN n.actor_kind = 'runtime' THEN 'Runtime change'
         WHEN n.actor_kind = 'tool' THEN 'Technical author' END    AS marker,
        CASE WHEN n.Object_Type <> 'Authorization' THEN n.Object_UUID END AS uuid,
        n.Object_UUID || '|' || n.File_Name                            AS row_key,
        n._ord_1 AS _ord_1,
        n._ord_2 AS _ord_2,
        n._ord_3 AS _ord_3,
        n._ord_4 AS _ord_4,
        n._ord_5 AS _ord_5
    FROM numbered n
),
-- _row_seq numbers the rows in the default order (row_key stays the row's
-- identity); the whole row breaks the remaining ties, so every request
-- assigns the same number.
result AS MATERIALIZED (
    SELECT u.* EXCLUDE (_ord_1, _ord_2, _ord_3, _ord_4, _ord_5),
           row_number() OVER (ORDER BY u._ord_1 DESC, u._ord_2, u._ord_3, u._ord_4, u._ord_5, u) AS _row_seq
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
