-- Options of the type filter: the nine object types the dashboard ranks — types
-- with a usage meaning in the where-used analysis — as far as they carry stamps.
SELECT m.Object_Type AS value, m.Object_Type AS label
FROM ObjectChangeMeta m
WHERE m.Modified_At IS NOT NULL
  AND m.Object_Type IN ('Script', 'Field', 'Layout', 'TableOccurrence', 'BaseTable',
                        'ValueList', 'CustomFunction', 'ExternalDataSource', 'Theme')
GROUP BY m.Object_Type
ORDER BY m.Object_Type;
