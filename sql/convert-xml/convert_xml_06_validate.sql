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

-- Verwaiste Same-File-Link-Ziele: ObjectLinks-Ziele ohne ObjectCatalog-Eintrag.
-- Cross-File-Links sind ausgenommen (die lösen sauber auf). Ziel: ECHTE Zahl,
-- KEIN Cap — der frühere `LIMIT 100` machte aus einem realen 1.877 ein "100"
-- und verschleierte die Größenordnung.
--
-- Wichtige Unterscheidung (Schweregrad macht die Shell): Auf einem UNVOLLSTÄNDIGEN
-- Mehrdatei-Korpus sind solche Orphans ERWARTBAR — Referenzen (Relationship-
-- Prädikatfelder, displays_field, calls_script, Import-/Export-Mappings) zeigen in
-- externe Dateien, die nicht mit-importiert wurden; deren Objekte stehen in keinem
-- Katalog. `missing_ext_files` liefert genau diesen Kontext: referenzierte externe
-- FileMaker-Dateien (ExternalDataSourceCatalog), die nicht in FilesCatalog sind.
-- Erst wenn missing_ext_files = 0 (Korpus vollständig) deuten Orphans auf echte
-- tote Referenzen / ein Integritätsproblem. (Nicht primär ein --split-Effekt.)
CREATE OR REPLACE VIEW v_check_orphan_links AS
SELECT
    (SELECT COUNT(*) FROM (
        SELECT DISTINCT Target_UUID
        FROM ObjectLinks
        WHERE Target_UUID IS NOT NULL AND Target_UUID <> ''
          AND COALESCE(Is_Cross_File, FALSE) = FALSE
          AND Target_UUID NOT IN (SELECT Object_UUID FROM ObjectCatalog)
    )) AS orphan_n,
    (SELECT COUNT(*) FROM (
        SELECT DISTINCT regexp_replace(DS_Name, '\.fmp12$', '') AS ref_file
        FROM ExternalDataSourceCatalog
        WHERE (DS_Type ILIKE '%FileMaker%' OR DS_Type IS NULL)
          AND DS_Name IS NOT NULL AND DS_Name <> ''
    ) ref WHERE ref.ref_file NOT IN (SELECT File_Name FROM FilesCatalog)) AS missing_ext_files;

-- Schema-Stand der DB (aktuellste SchemaInfo-Zeile). Die Shell vergleicht die
-- Version gegen die Template-Version (@SCHEMA_VERSION) — die liegt nur im Shell-
-- Kontext vor, daher findet der Vergleich dort statt.
CREATE OR REPLACE VIEW v_check_schema AS
SELECT Schema_Version AS db_version
FROM SchemaInfo
ORDER BY Schema_Built_At DESC
LIMIT 1;
