-- @template_type: object
-- @title: Fields without layout usage
-- @description: Every field that is not displayed or read on any layout.
-- @icon: field
-- @category: Fields
-- @display: list
-- @params: file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}
-- @output_format: uuid, name, type, table_name, field_type, file
-- @author: Marcel
-- @version: 1.2
-- @tags: fields, analysis, unused

-- Logik identisch zum Home-Health-Indikator „Felder ohne Layout-Verwendung":
-- ein Feld zählt als „unused", wenn es weder per `displays_field` noch
-- `reads_field` von einem LayoutObject referenziert wird.
WITH field_usage AS (
    SELECT DISTINCT Target_UUID
    FROM ObjectLinks
    WHERE Link_Role IN ('displays_field', 'reads_field')
)
SELECT
    oc.Object_UUID AS uuid,
    oc.Object_Name AS name,
    oc.Object_Type AS type,
    f.Table_Name   AS table_name,
    f.Field_Type   AS field_type,
    oc.File_Name   AS file
FROM ObjectCatalog oc
JOIN FieldsForTables f ON oc.Object_UUID = f.Field_UUID
LEFT JOIN field_usage fu ON f.Field_UUID = fu.Target_UUID
WHERE oc.Object_Type = 'Field'
  AND fu.Target_UUID IS NULL
  AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
ORDER BY oc.File_Name, f.Table_Name, oc.Object_Name;
