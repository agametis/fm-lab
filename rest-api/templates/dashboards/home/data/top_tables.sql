-- @template_type: report
-- @description: Basis-Tabellen mit den meisten Feldern.
-- @params: limit (optional, default 10), file (optional)

SELECT
    bt.BT_UUID                AS uuid,
    bt.BT_Name                AS name,
    bt.File_Name              AS file,
    COUNT(f.Field_UUID)       AS field_count
FROM BaseTableCatalog bt
LEFT JOIN FieldsForTables f
       ON f.Table_Name = bt.BT_Name AND f.File_Name = bt.File_Name
WHERE (getvariable('file') IS NULL OR bt.File_Name = getvariable('file'))
GROUP BY ALL
ORDER BY field_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '10') AS INTEGER);
