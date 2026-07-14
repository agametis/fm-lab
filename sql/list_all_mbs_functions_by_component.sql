-- Liste aller MBS-Funktionsaufrufe in der FileMaker-Datei (nach Component)
--
-- Dieses Template durchsucht alle Custom Functions, Script Steps und Script Parameter
-- nach MBS-Funktionsaufrufen und kategorisiert diese nach Funktionsbereichen.
-- Die Kategoriezuordnung erfolgt gemäß der offiziellen MBS-Dokumentation
-- unter Verwendung der Component-Ausnahmen-Tabelle.
--
-- Ausnahme-Tabelle:
--   reference/mbs_component_exceptions.csv
--
-- Verwendung:
--   duckdb db/fm_catalog.duckdb < sql/list_all_mbs_functions_by_component.sql

WITH MBS_Calls AS (
  -- MBS-Funktionen in benutzerdefinierten Funktionen
  SELECT
    'Custom Function' AS Objekttyp,
    CF_Name AS Objektname,
    regexp_extract_all(Calculation_Code, 'MBS\s*\(\s*"([^"]+)"', 1) AS MBS_Funktionen
  FROM CalcsForCustomFunctions
  WHERE Calculation_Code LIKE '%MBS%'

  UNION ALL

  -- MBS-Funktionen in Script-Schritten (Calculation_Text)
  SELECT
    'Script Step' AS Objekttyp,
    s.Script_Name AS Objektname,
    regexp_extract_all(st.Calculation_Text, 'MBS\s*\(\s*"([^"]+)"', 1) AS MBS_Funktionen
  FROM StepsForScripts st
  JOIN ScriptCatalog s ON st.Script_UUID = s.Script_UUID
  WHERE st.Calculation_Text IS NOT NULL
    AND st.Calculation_Text LIKE '%MBS%'

  UNION ALL

  -- MBS-Funktionen in Script-Parametern (Parameters_XML)
  SELECT
    'Script Parameter' AS Objekttyp,
    s.Script_Name AS Objektname,
    regexp_extract_all(st.Parameters_XML, 'MBS\s*\(\s*"([^"]+)"', 1) AS MBS_Funktionen
  FROM StepsForScripts st
  JOIN ScriptCatalog s ON st.Script_UUID = s.Script_UUID
  WHERE st.Parameters_XML IS NOT NULL
    AND st.Parameters_XML LIKE '%MBS%'
),
Flattened AS (
  -- Expandiere Arrays zu einzelnen Zeilen
  SELECT
    Objekttyp,
    Objektname,
    unnest(MBS_Funktionen) AS MBS_Funktion
  FROM MBS_Calls
  WHERE len(MBS_Funktionen) > 0
),
ComponentExceptions AS (
  -- Lade Component-Ausnahmen aus CSV
  -- 1.020 Ausnahmen (13,1% aller Funktionen)
  SELECT
    Funktionsname,
    Component
  FROM read_csv_auto('reference/mbs_component_exceptions.csv')
),
Summary AS (
  -- Aggregiere und kategorisiere die MBS-Funktionen
  -- Kategorie wird entweder aus der Ausnahmen-Tabelle oder per Prefix-Extraktion ermittelt
  SELECT
    MBS_Funktion,
    COUNT(*) AS Anzahl_Verwendungen,
    COUNT(DISTINCT Objektname) AS Anzahl_Objekte,
    COALESCE(
      ce.Component,                        -- Aus Ausnahmen-Tabelle (falls vorhanden)
      split_part(MBS_Funktion, '.', 1)     -- Fallback: Text vor dem ersten Punkt
    ) AS Kategorie
  FROM Flattened f
  LEFT JOIN ComponentExceptions ce ON f.MBS_Funktion = ce.Funktionsname
  GROUP BY MBS_Funktion, ce.Component
)
SELECT
  Kategorie,
  MBS_Funktion,
  Anzahl_Verwendungen,
  Anzahl_Objekte
FROM Summary
ORDER BY Kategorie, Anzahl_Verwendungen DESC;
