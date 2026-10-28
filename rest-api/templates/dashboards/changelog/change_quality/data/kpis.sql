-- One row with every check result of the chosen files.
--   integrity: missing, unreadable, duplicate, future, unassigned — 0 after a
--              healthy import
--   signals:   mass (+ mass_pct), technical, no_account, zero_counter, spelling
--              (persons with several user names or merged author keys) — they
--              tell how far the stamps speak for the individual object
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
-- >>> shared quality block — identical in every dataset of this bundle that counts
-- or lists check results (unit test dashboard-changelog-blocks guards it); change
-- it in all files at once.
--   q_params   issue: the check whose objects are listed (missing | unreadable |
--              duplicate | future | unassigned | mass | technical | no_account |
--              zero_counter; spelling has a list of its own)
--   q_scope    every stamp of the chosen files — all authors, mass events and
--              unreadable timestamps included
--   q_flags    one row per stamp with one flag per check:
--                unreadable    a timestamp that could not be read
--                duplicate     two stamps for one object (UUID and file)
--                future        newer than the file's import plus one day
--                unassigned    a readable stamp without burst
--                mass          part of a mass event
--                technical     written by a technical author (tool, runtime)
--                no_account    no account recorded
--                zero_counter  counter 0 — no save reported since creation
--   q_missing  objects of the stamped types without any stamp (ObjectCatalog)
--   q_persons  persons with several user names or merged author keys
q_params AS (
    SELECT COALESCE(NULLIF(CAST(getvariable('issue') AS VARCHAR), ''), '') AS chk
),
q_scope AS (
    SELECT
        m.Object_UUID, m.File_Name, m.Object_Type, m.Object_Name, m.Modified_At, m.Modified_At_Raw,
        m.Modified_By, m.Modified_Account, m.Modifications, m.Author_Key, m.Burst_ID, m.Bulk_Event_ID,
        COALESCE(a.Person_Key, m.Author_Key)                  AS Person_Key,
        COALESCE(a.Display_Name, m.Modified_By, m.Author_Key) AS Person_Name,
        COALESCE(a.Is_Technical, m.Author_Kind IS NOT NULL)   AS Is_Technical
    FROM ObjectChangeMeta m
    CROSS JOIN params p
    LEFT JOIN v_change_meta_authors a ON a.Author_Key = m.Author_Key
    WHERE p.files IS NULL OR list_contains(p.files, m.File_Name)
),
q_flags AS (
    SELECT
        q.Object_UUID, q.File_Name, q.Object_Type, q.Object_Name, q.Modified_At, q.Modified_At_Raw,
        q.Modified_Account, q.Modifications, q.Bulk_Event_ID, q.Person_Key, q.Person_Name, q.Is_Technical,
        q.Modified_At IS NULL AND q.Modified_At_Raw IS NOT NULL                    AS unreadable,
        count(*) OVER (PARTITION BY q.Object_UUID, q.File_Name) > 1                AS duplicate,
        COALESCE(q.Modified_At > fc.Import_Timestamp + INTERVAL 1 DAY, FALSE)      AS future,
        q.Modified_At IS NOT NULL AND q.Burst_ID IS NULL                           AS unassigned,
        q.Bulk_Event_ID IS NOT NULL                                                AS mass,
        q.Is_Technical                                                             AS technical,
        q.Modified_Account IS NULL                                                 AS no_account,
        COALESCE(q.Modifications = 0, FALSE)                                       AS zero_counter
    FROM q_scope q
    LEFT JOIN FilesCatalog fc ON fc.File_Name = q.File_Name
),
q_missing AS (
    SELECT oc.Object_UUID, oc.File_Name, oc.Object_Type, oc.Object_Name
    FROM ObjectCatalog oc
    CROSS JOIN params p
    WHERE oc.Source_Table IN ('ScriptCatalog', 'Layouts', 'CustomFunctionsCatalog', 'FieldsForTables',
                              'BaseTableCatalog', 'TableOccurrenceCatalog', 'RelationshipCatalog',
                              'ValueListCatalog', 'ExternalDataSourceCatalog', 'AccountsCatalog',
                              'PrivilegeSetsCatalog', 'ExtendedPrivilegesCatalog', 'CustomMenuCatalog',
                              'CustomMenuSetCatalog', 'ThemeCatalog', 'BaseDirectoryCatalog')
      AND (p.files IS NULL OR list_contains(p.files, oc.File_Name))
      AND (SELECT count(*) FROM ObjectChangeMeta) > 0
      AND NOT EXISTS (SELECT 1 FROM ObjectChangeMeta m
                      WHERE m.Object_UUID = oc.Object_UUID AND m.File_Name = oc.File_Name)
),
q_persons AS (
    SELECT q.Person_Key, any_value(q.Person_Name) AS person,
           count(DISTINCT q.Modified_By)  AS spellings,
           count(DISTINCT q.Author_Key)   AS author_keys
    FROM q_scope q
    WHERE q.Modified_By IS NOT NULL
    GROUP BY q.Person_Key
    HAVING count(DISTINCT q.Modified_By) > 1 OR count(DISTINCT q.Author_Key) > 1
)
-- <<< shared quality block
SELECT
    (SELECT count(*) FROM q_flags)                                               AS stamps,
    (SELECT count(*) FROM q_missing)                                             AS missing,
    (SELECT count(*) FROM q_flags f WHERE f.unreadable)                          AS unreadable,
    (SELECT count(*) FROM q_flags f WHERE f.duplicate)                           AS duplicate,
    (SELECT count(*) FROM q_flags f WHERE f.future)                              AS future,
    (SELECT count(*) FROM q_flags f WHERE f.unassigned)                          AS unassigned,
    (SELECT count(*) FROM q_flags f WHERE f.mass)                                AS mass,
    (SELECT round(100.0 * count(*) FILTER (WHERE f.mass) / NULLIF(count(*), 0), 1)
       FROM q_flags f)                                                           AS mass_pct,
    (SELECT count(*) FROM q_flags f WHERE f.technical)                           AS technical,
    (SELECT count(*) FROM q_flags f WHERE f.no_account)                          AS no_account,
    (SELECT count(*) FROM q_flags f WHERE f.zero_counter)                        AS zero_counter,
    (SELECT count(*) FROM q_persons)                                             AS spelling;
