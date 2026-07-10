-- Shared object-resolution queries (see ../resolve-object.md for the contract).
-- Not directly executable: substitute <PLACEHOLDER> tokens, then run each statement
-- individually via: duckdb db/fm_catalog.duckdb -c "…"

-- Q1 — UUID lookup (priority 1)
SELECT Object_UUID, Object_Type, Object_Name, File_Name
FROM ObjectCatalog
WHERE Object_UUID = '<UUID>'
ORDER BY File_Name;

-- Q1a — UUID lookup with clone disambiguation (--file / context file known)
SELECT Object_UUID, Object_Type, Object_Name, File_Name
FROM ObjectCatalog
WHERE Object_UUID = '<UUID>'
  AND File_Name = '<FILE>';

-- Q2 — exact name match, case-insensitive (priority 2)
SELECT Object_UUID, Object_Type, Object_Name, File_Name
FROM ObjectCatalog
WHERE LOWER(Object_Name) = LOWER('<NAME>')
ORDER BY Object_Type, File_Name;

-- Q3 — fuzzy fallback (only when Q2 is empty); noisy sub-object types excluded
SELECT Object_UUID, Object_Type, Object_Name, File_Name
FROM ObjectCatalog
WHERE Object_Name ILIKE '%<NAME>%'
  AND Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation', 'ScriptStep', 'LayoutObject', 'LayoutPart')
ORDER BY Object_Type, File_Name
LIMIT 15;
