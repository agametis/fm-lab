-- fmIDE per-file install scan.
--
-- For every file in the solution, determine whether the configured fmIDE target
-- script (parameter ?, default "fmIDE") exists, and verify it by its signature:
-- a `Set Variable [ $fmide_version ; … ]` step in the script header (also matched
-- loosely via the raw step XML). Returns one row per file.
--
-- Bind parameter:  1) script_name  (the configured fmIDE script name)
SELECT
  f.File_Name                          AS file_name,
  (t.Script_UUID IS NOT NULL)          AS script_present,
  COALESCE(v.has_signature, FALSE)     AS script_valid,
  v.version_raw                        AS version_raw
FROM FilesCatalog f
LEFT JOIN (
  SELECT File_Name, Script_UUID
  FROM ScriptCatalog
  WHERE Script_Name = ?
    AND (Folder_Type IS NULL OR Folder_Type = 'False')
    AND NOT COALESCE(Is_Separator, FALSE)
) t ON t.File_Name = f.File_Name
LEFT JOIN (
  SELECT
    Script_UUID,
    TRUE AS has_signature,
    MAX(CASE WHEN Variable_Name = '$fmide_version' THEN Calculation_Text END) AS version_raw
  FROM StepsForScripts
  WHERE Variable_Name = '$fmide_version'
     OR Step_XML ILIKE '%fmide_version%'
  GROUP BY Script_UUID
) v ON v.Script_UUID = t.Script_UUID
ORDER BY f.File_Name
