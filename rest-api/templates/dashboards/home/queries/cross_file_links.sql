-- @template_type: object
-- @title: Cross-file table occurrences
-- @description: Every TableOccurrence whose base table lives in another FileMaker file.
-- @icon: link
-- @category: Dependencies
-- @display: list
-- @params: file (optional)
-- @click_action: openObject
-- @click_args: uuid={{uuid}}
-- @output_format: uuid, name, type, source_file, target_file, base_table
-- @author: Marcel
-- @version: 4.0
-- @tags: files, dependencies, table-occurrences

SELECT
  to_oc.Object_UUID AS uuid,
  to_oc.Object_Name AS name,
  'TableOccurrence' AS type,
  to_oc.File_Name   AS source_file,
  bt_oc.File_Name   AS target_file,
  bt_oc.Object_Name AS base_table
FROM ObjectLinks ol
JOIN ObjectCatalog to_oc ON ol.Source_UUID = to_oc.Object_UUID
JOIN ObjectCatalog bt_oc ON ol.Target_UUID = bt_oc.Object_UUID
WHERE ol.Is_Cross_File   = TRUE
  AND ol.Link_Role       = 'base_table'
  AND to_oc.Object_Type  = 'TableOccurrence'
  AND bt_oc.Object_Type  = 'BaseTable'
  AND (getvariable('file') IS NULL OR to_oc.File_Name = getvariable('file'))
ORDER BY source_file, target_file, name;
