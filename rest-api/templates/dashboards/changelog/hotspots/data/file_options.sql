-- Options of the file filter: every file with stamped objects of the nine types.
SELECT m.File_Name AS value, m.File_Name AS label
FROM ObjectChangeMeta m
WHERE m.Modified_At IS NOT NULL
  AND m.Object_Type IN ('Script', 'Field', 'Layout', 'TableOccurrence', 'BaseTable',
                        'ValueList', 'CustomFunction', 'ExternalDataSource', 'Theme')
GROUP BY m.File_Name
ORDER BY lower(m.File_Name);
