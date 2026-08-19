-- @template_type: report
-- @title: Table width ranking (record width risk)
-- @description: Base tables ranked by record width risk — total fields plus the expensive kinds: unstored calculations, container (Binary) fields, summary and global fields. Wide records raise the payload of every record transfer; the DevCon WAN-first guidance recommends narrower records and partitioning rarely used data. A metric, not a defect list — the min_fields parameter sets the floor, default 50.
-- @icon: table-2
-- @category: Schema
-- @display: table
-- @params: file (optional), limit (optional, default 500), min_fields (optional, default 50)
-- @click_action: openObject
-- @click_args: uuid={{_nav_uuid}}&type=BaseTable&file={{file_name}}
-- @output_format: file_name, table_name, field_count, unstored_calcs, containers, summaries, globals, stored_calcs, _message
-- @object_types: BaseTable
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "wide_tables", "meaning": "Base tables at or above the field-count floor (inventory — a metric, not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: schema, tables, performance, wan, community-patterns
--
-- Containers are Data_Type = 'Binary' in the catalog — there is no
-- 'Container' vocabulary. Unstored calculations are Field_Type = 'Calculated'
-- with Storage_StoreCalcResults = FALSE.
SELECT
    f.File_Name AS file_name,
    any_value(f.Table_UUID) AS _nav_uuid,
    f.Table_Name AS table_name,
    CAST(count(*) AS INTEGER) AS field_count,
    CAST(count(*) FILTER (WHERE f.Field_Type = 'Calculated'
                          AND COALESCE(f.Storage_StoreCalcResults, FALSE) = FALSE) AS INTEGER) AS unstored_calcs,
    CAST(count(*) FILTER (WHERE f.Data_Type = 'Binary') AS INTEGER) AS containers,
    CAST(count(*) FILTER (WHERE f.Field_Type = 'Summary') AS INTEGER) AS summaries,
    CAST(count(*) FILTER (WHERE f.Is_Global) AS INTEGER) AS globals,
    CAST(count(*) FILTER (WHERE f.Field_Type = 'Calculated'
                          AND COALESCE(f.Storage_StoreCalcResults, FALSE) = TRUE) AS INTEGER) AS stored_calcs,
    count(*) || ' fields, of which '
      || count(*) FILTER (WHERE f.Field_Type = 'Calculated' AND COALESCE(f.Storage_StoreCalcResults, FALSE) = FALSE)
      || ' unstored calculation(s), ' || count(*) FILTER (WHERE f.Data_Type = 'Binary') || ' container(s), '
      || count(*) FILTER (WHERE f.Field_Type = 'Summary') || ' summary field(s)' AS _message
FROM FieldsForTables f
WHERE (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR f.Table_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
GROUP BY f.File_Name, f.Table_Name
HAVING count(*) >= CAST(COALESCE(getvariable('min_fields'), '50') AS INTEGER)
ORDER BY field_count DESC, unstored_calcs DESC, file_name, table_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
