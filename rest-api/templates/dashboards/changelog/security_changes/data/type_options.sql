-- Options of the type filter: the four security object types, as far as they
-- carry stamps.
SELECT m.Object_Type AS value, m.Object_Type AS label
FROM ObjectChangeMeta m
WHERE m.Modified_At IS NOT NULL
  AND m.Object_Type IN ('Account', 'Authorization', 'ExtendedPrivilege', 'PrivilegeSet')
GROUP BY m.Object_Type
ORDER BY m.Object_Type;
