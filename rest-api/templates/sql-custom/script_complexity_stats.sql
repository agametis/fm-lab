-- @template_type: report
-- @title: Script-Komplexität pro Datei
-- @description: Aggregierte Script-Statistiken (Anzahl, durchschn./max. Schritte).
-- @icon: chart
-- @category: Scripts
-- @display: table
-- @params: none
-- @output_format: file_name, script_count, avg_steps, max_steps, total_steps
-- @author: Marcel
-- @version: 1.1
-- @tags: scripts, statistics, complexity

SELECT
    sc.File_Name as file_name,
    COUNT(DISTINCT sc.Script_ID) as script_count,
    CAST(AVG(step_counts.step_count) AS INTEGER) as avg_steps,
    MAX(step_counts.step_count) as max_steps,
    SUM(step_counts.step_count) as total_steps
FROM ScriptCatalog sc
LEFT JOIN (
    SELECT Script_ID, COUNT(*) as step_count
    FROM StepsForScripts
    GROUP BY Script_ID
) step_counts ON sc.Script_ID = step_counts.Script_ID
WHERE sc.Folder_Type IS NULL OR sc.Folder_Type = 'False'
GROUP BY sc.File_Name
ORDER BY total_steps DESC;
