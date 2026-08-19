-- Unstored calculation fields whose formula calls Get(CurrentHostTimestamp)
-- AND that are placed on at least one layout. Claris documents the cost as
-- per-display: each render of the field asks the host for its clock.
--
-- Only the field's own calculation slot is checked — auto-enter and
-- validation formulas evaluate on write, not on render, so the documented
-- per-display cost does not apply to them.
--
-- The match covers the English function name and its German display name
-- (SystemuhrzeitstempelHost); which one the catalog carries depends on the
-- export locale of the file.
WITH hot_fields AS (
    SELECT f.File_Name, f.Field_UUID, f.Table_Name, f.Field_Name
    FROM FieldsForTables f
    WHERE f.Field_Type = 'Calculated'
      AND COALESCE(f.Storage_StoreCalcResults, FALSE) = FALSE
      AND regexp_matches(lower(f.Calculation_Text), 'currenthosttimestamp|systemuhrzeitstempelhost')
),
placements AS (
    SELECT h.File_Name, h.Field_UUID, h.Table_Name, h.Field_Name,
           CAST(count(*) AS INTEGER) AS placement_count,
           CAST(count(*) FILTER (WHERE l.Default_View = 'List') AS INTEGER) AS on_list_layouts,
           CAST(count(DISTINCT l.L_UUID) AS INTEGER) AS layout_count
    FROM hot_fields h
    JOIN ObjectLinks ol ON ol.Target_UUID = h.Field_UUID AND ol.Link_Role = 'displays_field'
    JOIN ObjectCatalog src ON ol.Source_UUID = src.Object_UUID AND src.Object_Type = 'LayoutObject'
    JOIN LayoutObjects lo ON src.Object_UUID = lo.Object_UUID
    JOIN Layouts l ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
    GROUP BY 1, 2, 3, 4
)
SELECT
    'unstored-calc-network-function' AS rule_id,
    'warning' AS severity,
    p.File_Name AS file_name,
    p.Field_UUID AS nav_uuid,
    p.Table_Name AS table_name,
    p.Field_Name AS field_name,
    p.layout_count,
    p.placement_count,
    p.on_list_layouts,
    'Unstored calculation calls Get(CurrentHostTimestamp) and is placed ' || p.placement_count
      || ' time(s) on ' || p.layout_count || ' layout(s) — every render asks the host for its clock' AS message,
    row_number() OVER (ORDER BY p.File_Name, p.Table_Name, p.Field_Name) AS row_key
FROM placements p
WHERE (getvariable('file') IS NULL OR p.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR p.Field_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY p.File_Name, p.Table_Name, p.Field_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
