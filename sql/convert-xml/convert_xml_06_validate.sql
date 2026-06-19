/*
-- convert_xml_06_validate.sql — Phase 6 der XML-Konvertierungs-Pipeline
-- (project/plan_xml_diff.md §7.3). Plausibilitäts-/Konsistenz-Checks als
-- wiederverwendbare, versionierte SQL-Views. TABLE-ONLY (liest nur die fertigen
-- Pipeline-Tabellen).
--
-- Abgrenzung zu postprocess_db() (Shell): Diese Datei liefert die Prüf-DATEN
-- (Views); die Shell ruft sie ab, bewertet die Befunde und reportet
-- (Schweregrad, Exit-Code). „Daten-Logik im SQL, Ablauf-/Reporting-Logik im
-- Shell." Vorteil: dieselben Checks sind auch außerhalb des Konvertierungslaufs
-- nutzbar (REST-API, Ad-hoc) und versioniert.
--
-- Wird NICHT in @SCHEMA_HASH_FILES gelistet: rein abgeleitete Prüf-Views,
-- ändern das Datenmodell nicht → sollen keinen Auto-Heal-Rebuild auslösen.
*/

-- Mengen-Plausibilität: eine Zeile mit allen relevanten Zählwerten.
-- Die Bewertung (welche Kombination ein Problem ist) macht die Shell.
CREATE OR REPLACE VIEW v_check_counts AS
SELECT
    (SELECT COUNT(*) FROM FilesCatalog)        AS files_n,
    (SELECT COUNT(*) FROM BaseTableCatalog)    AS basetables_n,
    (SELECT COUNT(*) FROM Layouts)             AS layouts_n,
    (SELECT COUNT(*) FROM LayoutObjects)       AS layoutobjects_n,
    (SELECT COUNT(*) FROM ScriptCatalog
       WHERE (Folder_Type IS NULL OR Folder_Type = 'False')
         AND NOT COALESCE(Is_Separator, FALSE)) AS scripts_n,
    (SELECT COUNT(*) FROM StepsForScripts)     AS steps_n;

-- C1 (primärer Regressions-Wächter): leere/NULL Calc_UUID in DDR_Calculations.
-- Per Slot-erhaltendem Regex in convert_xml_01_extract.sql per Konstruktion 0.
CREATE OR REPLACE VIEW v_check_calc_uuid AS
SELECT COUNT(*) AS bad_calc_uuid
FROM DDR_Calculations
WHERE Calc_UUID = '' OR Calc_UUID IS NULL;

-- Orphan-UUID-Stichprobe (≤100, same-file): ObjectLinks-Ziele ohne
-- ObjectCatalog-Eintrag. Cross-File-Links ausgenommen (Ziel kann legitim in
-- einer noch nicht importierten Datei liegen). Relevant v.a. bei --split.
CREATE OR REPLACE VIEW v_check_orphan_links AS
SELECT COUNT(*) AS orphan_n FROM (
    SELECT DISTINCT Target_UUID
    FROM ObjectLinks
    WHERE Target_UUID IS NOT NULL AND Target_UUID <> ''
      AND COALESCE(Is_Cross_File, FALSE) = FALSE
      AND Target_UUID NOT IN (SELECT Object_UUID FROM ObjectCatalog)
    LIMIT 100
);

-- Schema-Stand der DB (aktuellste SchemaInfo-Zeile). Die Shell vergleicht die
-- Version gegen die Template-Version (@SCHEMA_VERSION) — die liegt nur im Shell-
-- Kontext vor, daher findet der Vergleich dort statt.
CREATE OR REPLACE VIEW v_check_schema AS
SELECT Schema_Version AS db_version
FROM SchemaInfo
ORDER BY Schema_Built_At DESC
LIMIT 1;
