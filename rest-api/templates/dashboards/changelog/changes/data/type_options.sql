-- Options of the type filter: every object type with change stamps. Account and
-- Authorization are listed too — the list shows them only when chosen here.
SELECT m.Object_Type AS value, m.Object_Type AS label
FROM ObjectChangeMeta m
WHERE m.Modified_At IS NOT NULL
GROUP BY m.Object_Type
ORDER BY m.Object_Type;
