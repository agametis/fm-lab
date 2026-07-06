SELECT 'account-with-full-access' AS rule_id, 'warning' AS severity,
    acc.File_Name AS file_name, acc.Object_UUID AS nav_uuid, acc.Object_Name AS account_name,
    'Account has the [Full Access] privilege set' AS message,
    row_number() OVER (ORDER BY acc.File_Name, acc.Object_Name) AS row_key
FROM ObjectLinks ol
JOIN ObjectCatalog p ON p.Object_UUID = ol.Target_UUID AND p.Object_Name = '[Full Access]'
JOIN ObjectCatalog acc ON acc.Object_UUID = ol.Source_UUID AND acc.Object_Type = 'Account'
WHERE ol.Link_Role = 'privilege_set'
  AND (getvariable('file') IS NULL OR acc.File_Name = getvariable('file'))
ORDER BY acc.File_Name, acc.Object_Name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
