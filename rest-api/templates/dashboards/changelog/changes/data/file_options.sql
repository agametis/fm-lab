-- Options of the file filter: every file with change stamps.
SELECT m.File_Name AS value, m.File_Name AS label
FROM ObjectChangeMeta m
WHERE m.Modified_At IS NOT NULL
GROUP BY m.File_Name
ORDER BY lower(m.File_Name);
