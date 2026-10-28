-- Options of the file filter: every file with stamped security objects.
SELECT m.File_Name AS value, m.File_Name AS label
FROM ObjectChangeMeta m
WHERE m.Modified_At IS NOT NULL
  AND m.Object_Type IN ('Account', 'Authorization', 'ExtendedPrivilege', 'PrivilegeSet')
GROUP BY m.File_Name
ORDER BY lower(m.File_Name);
