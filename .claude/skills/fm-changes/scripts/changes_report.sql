-- @title: Change report (C2) — everything that changed in a window
-- @description: Six read-only result sets for the report. Variables: from_at (TIMESTAMP, required), to_at (TIMESTAMP or NULL = up to the data state), person (Author_Key or NULL), files (comma-separated file names or NULL), technical ('include' or NULL), security ('include' or NULL), engine (from changes_window.sql #1, or NULL = modules are files), max_objects (row cap of #4).
-- @version: 1.0.0
-- @tags: changes, report, release-notes
-- @note: "Individual" = no mass event; technical authors (Data Migration Tool, runtime
--        sessions) only with technical='include'; accounts and authorizations only with
--        security='include'; folders never (organisation, no content). Only the LAST stamp of an object exists: with to_at NULL the
--        result is exactly "changed since from_at"; with a closed window, objects changed
--        again after to_at are missing.

CREATE OR REPLACE TEMP VIEW ch_scope AS
SELECT
    m.Object_UUID, m.File_Name, m.Object_Type, m.Object_Name, m.Modified_At, m.Modified_By,
    m.Modified_Account, m.Modifications, m.Author_Key, m.Author_Kind, m.Burst_ID, m.Bulk_Event_ID
FROM ObjectChangeMeta m
WHERE m.Modified_At IS NOT NULL
  AND m.Modified_At >= CAST(getvariable('from_at') AS TIMESTAMP)
  AND (getvariable('to_at') IS NULL OR m.Modified_At <= CAST(getvariable('to_at') AS TIMESTAMP))
  AND (getvariable('files') IS NULL
       OR list_contains(string_split(CAST(getvariable('files') AS VARCHAR), ','), m.File_Name))
  AND m.Object_Type <> 'Folder'
  AND (getvariable('security') = 'include' OR m.Object_Type NOT IN ('Account', 'Authorization'));

CREATE OR REPLACE TEMP VIEW ch_individual AS
SELECT s.*
FROM ch_scope s
WHERE s.Bulk_Event_ID IS NULL
  AND (getvariable('technical') = 'include' OR s.Author_Kind IS NULL)
  AND (getvariable('person') IS NULL OR s.Author_Key = getvariable('person'));

CREATE OR REPLACE TEMP VIEW ch_modules AS
SELECT oc.Object_UUID, oc.File_Name, oc.Community,
       COALESCE(NULLIF(trim(cn.Semantic_Name), ''),
                regexp_replace(cn.Heuristic_Name, ' \(\+[0-9]+\)$', ''),
                '#' || oc.Community) AS Module_Name
FROM ObjectClusters oc
LEFT JOIN CommunityNames cn ON cn.Community = oc.Community AND cn.Engine = oc.Engine
WHERE oc.Engine = getvariable('engine');

CREATE OR REPLACE TEMP VIEW ch_sessions AS
WITH steps AS (
    SELECT i.Author_Key, i.Modified_By, i.Modified_At, i.File_Name,
           CASE WHEN i.Modified_At - lag(i.Modified_At) OVER w <= INTERVAL 30 MINUTE
                THEN 0 ELSE 1 END AS is_start,
           row_number() OVER w AS seq
    FROM ch_individual i
    WINDOW w AS (PARTITION BY i.Author_Key ORDER BY i.Modified_At, i.File_Name, i.Object_Type, i.Object_UUID)
),
numbered AS (
    SELECT s.*, sum(s.is_start) OVER (PARTITION BY s.Author_Key ORDER BY s.seq ROWS UNBOUNDED PRECEDING) AS session_no
    FROM steps s
)
SELECT n.Author_Key, n.session_no,
       min(n.Modified_At) AS start_at, max(n.Modified_At) AS end_at,
       any_value(n.Modified_By) AS person, count(*) AS objects,
       string_agg(DISTINCT n.File_Name, ', ' ORDER BY n.File_Name) AS files
FROM numbered n
GROUP BY n.Author_Key, n.session_no;

-- #1 totals (new = counter 0 or 1: created and saved at most once since)
SELECT
    (SELECT count(*) FROM ch_individual)                                      AS changed_objects,
    (SELECT count(*) FROM ch_individual WHERE Modifications <= 1)             AS new_objects,
    (SELECT count(DISTINCT Author_Key) FROM ch_individual)                    AS persons,
    (SELECT count(DISTINCT File_Name) FROM ch_individual)                     AS files,
    (SELECT count(DISTINCT (File_Name, Burst_ID)) FROM ch_individual)         AS actions,
    (SELECT count(DISTINCT Bulk_Event_ID) FROM ch_scope WHERE Bulk_Event_ID IS NOT NULL) AS mass_events,
    (SELECT count(*) FROM ch_scope WHERE Bulk_Event_ID IS NOT NULL)           AS objects_in_mass_events,
    (SELECT count(*) FROM ch_sessions)                                        AS sessions;

-- #2 per object type
SELECT Object_Type, count(*) AS changed, count(*) FILTER (WHERE Modifications <= 1) AS new
FROM ch_individual
GROUP BY Object_Type
ORDER BY changed DESC, Object_Type;

-- #3 per file and module. module = the partition's module name; a heuristic name that
--    starts with the row's own file loses that prefix, a different prefix stays (the
--    module is centred in another file). NULL = no partition or no community.
SELECT i.File_Name,
       CASE WHEN starts_with(md.Module_Name, i.File_Name || ' · ')
            THEN substr(md.Module_Name, length(i.File_Name) + 4) ELSE md.Module_Name END AS module,
       count(*) AS changed,
       string_agg(DISTINCT i.Object_Type, ', ' ORDER BY i.Object_Type) AS types,
       strftime(max(i.Modified_At), '%Y-%m-%d') AS last_change
FROM ch_individual i
LEFT JOIN ch_modules md ON md.Object_UUID = i.Object_UUID AND md.File_Name = i.File_Name
GROUP BY ALL
ORDER BY i.File_Name, changed DESC, module NULLS LAST;

-- #4 the changed objects with short facts (capped by max_objects; #1.changed_objects
--    tells how many exist).
--   size         script: steps · layout: layout objects
--   info         field: type · data type; layout: table occurrence; custom function:
--                parameters; value list: source
--   note         script header comment or field comment, cut at a word boundary
--   used_by      distinct objects with a where-used link to it (self-references excluded)
--   calls        script: distinct scripts it calls
--   is_new       counter 0 or 1
--   detail_rank  order of the detail tier: scripts, custom functions, layouts, fields,
--                the rest; within a type new objects first, then most saves, then name
WITH steps AS (
    SELECT s.Script_UUID, s.File_Name, count(*) AS n_steps,
           arg_min(trim(s.Comment_Text), s.Step_Index)
               FILTER (WHERE s.Step_ID = 89 AND NULLIF(trim(s.Comment_Text), '') IS NOT NULL) AS header_comment
    FROM StepsForScripts s
    JOIN ch_individual i ON i.Object_UUID = s.Script_UUID AND i.File_Name = s.File_Name
    GROUP BY s.Script_UUID, s.File_Name
),
layout_objects AS (
    SELECT l.Target_UUID, l.Target_File, count(*) AS n
    FROM ObjectLinks l
    JOIN ch_individual i ON i.Object_UUID = l.Target_UUID AND i.File_Name = l.Target_File
    WHERE l.Link_Role = 'parent_layout' AND l.Source_Type = 'LayoutObject'
    GROUP BY l.Target_UUID, l.Target_File
),
facts AS (
    SELECT st.Script_UUID AS u, st.File_Name AS f, st.n_steps AS size, NULL AS info, st.header_comment AS note
    FROM steps st
    UNION ALL
    SELECT fl.Field_UUID, fl.File_Name, NULL, fl.Field_Type || ' · ' || fl.Data_Type, NULLIF(trim(fl.Field_Comment), '')
    FROM FieldsForTables fl
    JOIN ch_individual i ON i.Object_UUID = fl.Field_UUID AND i.File_Name = fl.File_Name
    UNION ALL
    SELECT l.L_UUID, l.File_Name, lo.n, l.L_TO_Name, NULL
    FROM Layouts l
    JOIN ch_individual i ON i.Object_UUID = l.L_UUID AND i.File_Name = l.File_Name
    LEFT JOIN layout_objects lo ON lo.Target_UUID = l.L_UUID AND lo.Target_File = l.File_Name
    UNION ALL
    SELECT c.CF_UUID, c.File_Name, NULL, array_to_string(c.Parameters, ', '), NULL
    FROM CustomFunctionsCatalog c
    JOIN ch_individual i ON i.Object_UUID = c.CF_UUID AND i.File_Name = c.File_Name
    UNION ALL
    SELECT v.VL_UUID, v.File_Name, NULL, v.Source_Type, NULL
    FROM ValueListCatalog v
    JOIN ch_individual i ON i.Object_UUID = v.VL_UUID AND i.File_Name = v.File_Name
),
used_by AS (
    SELECT l.Target_UUID, l.Target_File, count(DISTINCT (l.Source_UUID, l.Source_File)) AS n
    FROM ObjectLinks l
    JOIN LinkRoleRegistry r ON r.Link_Role = l.Link_Role AND r.Counts_For_Where_Used
    JOIN ch_individual i ON i.Object_UUID = l.Target_UUID AND i.File_Name = l.Target_File
    WHERE l.Source_UUID <> l.Target_UUID OR l.Source_File IS DISTINCT FROM l.Target_File
    GROUP BY l.Target_UUID, l.Target_File
),
calls AS (
    SELECT l.Source_UUID, l.Source_File, count(DISTINCT (l.Target_UUID, l.Target_File)) AS n
    FROM ObjectLinks l
    JOIN ch_individual i ON i.Object_UUID = l.Source_UUID AND i.File_Name = l.Source_File
    WHERE l.Link_Role = 'calls_script'
    GROUP BY l.Source_UUID, l.Source_File
),
rows AS (
    SELECT
        i.File_Name, md.Module_Name, i.Object_Type, i.Object_Name, i.Modified_At, i.Modified_By,
        i.Modifications, i.Object_UUID,
        any_value(fa.size) AS size, any_value(fa.info) AS info, any_value(fa.note) AS note
    FROM ch_individual i
    LEFT JOIN ch_modules md ON md.Object_UUID = i.Object_UUID AND md.File_Name = i.File_Name
    LEFT JOIN facts fa ON fa.u = i.Object_UUID AND fa.f = i.File_Name
    GROUP BY ALL
)
SELECT
    r.File_Name,
    CASE WHEN starts_with(r.Module_Name, r.File_Name || ' · ')
         THEN substr(r.Module_Name, length(r.File_Name) + 4) ELSE r.Module_Name END AS module,
    r.Object_Type, r.Object_Name,
    strftime(r.Modified_At, '%Y-%m-%d %H:%M')                      AS modified_at,
    r.Modified_By                                                  AS person,
    r.Modifications                                                AS saves,
    COALESCE(r.Modifications, 0) <= 1                              AS is_new,
    r.size, r.info,
    CASE WHEN length(r.note) > 120
         THEN regexp_replace(left(r.note, 120), '\s+\S*$', '') || ' …' ELSE r.note END AS note,
    COALESCE(ub.n, 0)                                              AS used_by,
    cl.n                                                           AS calls,
    row_number() OVER (ORDER BY
        CASE r.Object_Type WHEN 'Script' THEN 1 WHEN 'CustomFunction' THEN 2
                           WHEN 'Layout' THEN 3 WHEN 'Field' THEN 4 ELSE 5 END,
        COALESCE(r.Modifications, 0) <= 1 DESC, r.Modifications DESC NULLS LAST,
        r.Object_Name, r.File_Name)                                AS detail_rank,
    r.Object_UUID
FROM rows r
LEFT JOIN used_by ub ON ub.Target_UUID = r.Object_UUID AND ub.Target_File = r.File_Name
LEFT JOIN calls cl ON cl.Source_UUID = r.Object_UUID AND cl.Source_File = r.File_Name
ORDER BY r.File_Name, module NULLS LAST, r.Object_Type, r.Object_Name, r.Object_UUID
LIMIT CAST(COALESCE(getvariable('max_objects'), 400) AS INTEGER);

-- #5 mass events with objects in the window (their objects are not in #4)
SELECT strftime(b.Start_At, '%Y-%m-%d %H:%M') AS start_at,
       strftime(b.End_At, '%Y-%m-%d %H:%M')   AS end_at,
       b.Kind, b.Scope, b.Files, count(*) AS objects_in_window, b.Objects AS objects_total,
       string_agg(DISTINCT s.Object_Type, ', ' ORDER BY s.Object_Type) AS types
FROM ch_scope s
JOIN ChangeBulkEvents b ON b.Bulk_Event_ID = s.Bulk_Event_ID
GROUP BY b.Bulk_Event_ID, b.Start_At, b.End_At, b.Kind, b.Scope, b.Files, b.Objects
ORDER BY b.Start_At DESC;

-- #6 work sessions in the window (per person, gaps of at most 30 minutes, across files)
SELECT strftime(cs.start_at, '%Y-%m-%d %H:%M') AS start_at,
       strftime(cs.end_at, '%Y-%m-%d %H:%M')   AS end_at,
       cs.person, cs.objects, cs.files
FROM ch_sessions cs
ORDER BY cs.start_at DESC;
