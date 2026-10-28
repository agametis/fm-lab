-- AC1 — age context of one object (fm-summarize, fm-analyze, fm-changes).
-- The object's own change stamp, else the stamp of its container: script steps,
-- layout objects and parts, calculations, script triggers and menu items carry no
-- stamp of their own (at most two hops, e.g. Calculation → ScriptStep → Script).
-- Adds the mass event the stamp belongs to and the solution's data state (the
-- newest individual change by a developer) — ages count from the data state,
-- never from today. Presentation rules: ../age-context.md.
-- No row → the type carries no stamp (variables, built-in and plug-in functions,
-- script-step types). A missing table ObjectChangeMeta → catalog older than
-- schema 1.36.0: skip the age context.
-- Variables: uuid, file — run as
--   duckdb db/fm_catalog.duckdb -readonly -markdown -c "SET VARIABLE uuid='…'; SET VARIABLE file='…';" \
--     -c ".read .claude/skills/_shared/scripts/age_context.sql"
WITH RECURSIVE up(uuid, file, hop) AS (
    SELECT CAST(getvariable('uuid') AS VARCHAR), CAST(getvariable('file') AS VARCHAR), 0
    UNION ALL
    SELECT CASE WHEN l.Link_Role = 'has_calculation' THEN l.Source_UUID ELSE l.Target_UUID END,
           CASE WHEN l.Link_Role = 'has_calculation' THEN l.Source_File ELSE l.Target_File END,
           up.hop + 1
    FROM up
    JOIN ObjectLinks l
      ON (l.Link_Role IN ('parent_script', 'parent_layout', 'parent_menu', 'trigger_owner')
          AND l.Source_UUID = up.uuid AND l.Source_File = up.file)
      OR (l.Link_Role = 'has_calculation'
          AND l.Target_UUID = up.uuid AND l.Target_File = up.file)
    WHERE up.hop < 2
      AND NOT EXISTS (SELECT 1 FROM ObjectChangeMeta m
                      WHERE m.Object_UUID = up.uuid AND m.File_Name = up.file)
),
anchor AS (
    SELECT max(Modified_At) FILTER (WHERE Bulk_Event_ID IS NULL AND Author_Kind IS NULL) AS data_state
    FROM ObjectChangeMeta
)
SELECT
    CASE WHEN up.hop = 0 THEN 'own' ELSE 'container' END     AS stamp_of,
    m.Object_Type                                            AS stamp_type,
    m.Object_Name                                            AS stamp_name,
    strftime(m.Modified_At, '%Y-%m-%d %H:%M')               AS modified_at,
    m.Modified_By                                            AS modified_by,
    m.Modified_Account                                       AS account,
    m.Modifications                                          AS saves,
    m.Author_Kind                                            AS author_kind,
    b.Kind                                                   AS mass_event_kind,
    b.Scope                                                  AS mass_event_scope,
    b.Objects                                                AS mass_event_objects,
    date_diff('day', m.Modified_At, a.data_state)            AS days_before_data_state,
    strftime(a.data_state, '%Y-%m-%d')                       AS data_state
FROM up
JOIN ObjectChangeMeta m ON m.Object_UUID = up.uuid AND m.File_Name = up.file
LEFT JOIN ChangeBulkEvents b ON b.Bulk_Event_ID = m.Bulk_Event_ID
CROSS JOIN anchor a
ORDER BY up.hop
LIMIT 1;
