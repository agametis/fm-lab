-- Window opener (New Window, or Go to Related Record with its "New window" option —
-- StepsForScripts.Opens_Window, derived at import) with NO enabled Close Window
-- later in the same script. Heuristic by design: a callee script may close the
-- window, and a Close Window that exists in some branch does not guarantee every
-- exit path closes it. Numeric-ID join includes File_Name (FM IDs are per-file).
SELECT 'window-opened-without-close' AS rule_id, 'warning' AS severity,
    o.File_Name AS file_name, o.Script_UUID AS nav_uuid, o.Script_Name AS script_name,
    o.Step_Index + 1 AS step_no, o.Step_UUID AS step_uuid,
    o.Step_Name AS opener,
    o.Step_Name || ' at step ' || (o.Step_Index + 1) || ' opens a window, but no Close Window follows in this script (a callee may close it — verify)' AS message,
    row_number() OVER (ORDER BY o.File_Name, o.Script_Name, o.Step_Index) AS row_key
FROM StepsForScripts o
WHERE o.Opens_Window AND o.Is_Enabled
  AND NOT EXISTS (
      SELECT 1 FROM StepsForScripts c
      WHERE c.File_Name = o.File_Name AND c.Script_ID = o.Script_ID
        AND c.Step_ID = 121 AND c.Is_Enabled AND c.Step_Index > o.Step_Index)
  AND (getvariable('file') IS NULL OR o.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR o.Script_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY file_name, script_name, step_no
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
