-- @template_type: object
-- @title: Fields without comment
-- @description: Every field with an empty Field_Comment — candidates for documentation.
-- @icon: comment
-- @category: Fields
-- @display: list
-- @params: file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}
-- @output_format: uuid, name, type, table_name, field_type, file
-- @author: Marcel
-- @version: 1.0
-- @tags: fields, analysis, documentation

SELECT
    oc.Object_UUID  AS uuid,
    oc.Object_Name  AS name,
    oc.Object_Type  AS type,
    f.Table_Name    AS table_name,
    f.Field_Type    AS field_type,
    oc.File_Name    AS file
FROM ObjectCatalog oc
JOIN FieldsForTables f ON oc.Object_UUID = f.Field_UUID
WHERE oc.Object_Type = 'Field'
  AND (f.Field_Comment IS NULL OR trim(f.Field_Comment) = '')
  AND (getvariable('file') IS NULL OR oc.File_Name = getvariable('file'))
ORDER BY oc.File_Name, f.Table_Name, oc.Object_Name;
