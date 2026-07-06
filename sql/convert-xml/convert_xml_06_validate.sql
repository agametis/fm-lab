/*
-- convert_xml_06_validate.sql — Phase 6 der XML-Konvertierungs-Pipeline.
-- Plausibilitäts-/Konsistenz-Checks als
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

-- Synthetik-Regression: „abgeleitete Rolle X darf nicht leer sein, wenn Quelle Y
-- befüllt ist". Fängt die gefährlichste Fehlerklasse der Pipeline — stumme
-- 0-Zeilen-INSERTs nach Pattern-/Namenskonventions-Drift (z.B. die
-- PluginComponent-Regression 'MBS::%' vs. 'MBS:%'). Eine Zeile pro Regel;
-- Verletzung = source_n > 0 AND derived_n = 0 (Bewertung in der Shell).
-- Hinweis contains_menu: Quelle sind Menü-Sets mit Member-Liste; ein Korpus,
-- dessen Sets ausschließlich Built-in-Menüs referenzieren, würde die Regel
-- formal verletzen (Built-ins erzeugen bewusst keine Links) — dann Regel prüfen,
-- nicht blind fixen.
CREATE OR REPLACE VIEW v_check_synthetic AS
SELECT 'plugincomponent_objects' AS rule,
       (SELECT COUNT(*) FROM ObjectCatalog WHERE Object_Type = 'PluginFunction') AS source_n,
       (SELECT COUNT(*) FROM ObjectCatalog WHERE Object_Type = 'PluginComponent') AS derived_n
UNION ALL
SELECT 'groups_into_links',
       (SELECT COUNT(*) FROM ObjectCatalog WHERE Object_Type = 'PluginFunction'),
       (SELECT COUNT(*) FROM ObjectLinks WHERE Link_Role = 'groups_into')
UNION ALL
SELECT 'contains_menu_links',
       (SELECT COUNT(*) FROM CustomMenuSetCatalog
         WHERE Member_Menu_IDs IS NOT NULL AND len(Member_Menu_IDs) > 0),
       (SELECT COUNT(*) FROM ObjectLinks WHERE Link_Role = 'contains_menu')
UNION ALL
SELECT 'parent_script_links',
       (SELECT COUNT(*) FROM StepsForScripts),
       (SELECT COUNT(*) FROM ObjectLinks WHERE Link_Role = 'parent_script')
UNION ALL
SELECT 'parent_layout_links',
       (SELECT COUNT(*) FROM LayoutObjects),
       (SELECT COUNT(*) FROM ObjectLinks WHERE Link_Role = 'parent_layout')
UNION ALL
SELECT 'grants_privilege_links',
       (SELECT COUNT(*) FROM ExtendedPrivilegesCatalog
         WHERE PrivilegeSet_IDs IS NOT NULL AND len(PrivilegeSet_IDs) > 0),
       (SELECT COUNT(*) FROM ObjectLinks WHERE Link_Role = 'grants_privilege')
UNION ALL
SELECT 'uses_theme_links',
       (SELECT COUNT(*) FROM Layouts WHERE L_Theme_UUID IS NOT NULL
         AND (Folder_Type IS NULL OR Folder_Type = 'False')),
       (SELECT COUNT(*) FROM ObjectLinks WHERE Link_Role = 'uses_theme');

-- Rollen-Registry-Vollständigkeit: jede in ObjectLinks aktive Rolle muss
-- in LinkRoleRegistry klassifiziert sein (usage/containment/restriction) — sonst
-- arbeiten Where-used-/Graph-Konsumenten mit undokumentierter Semantik. Fängt
-- „neue Rolle eingeführt, Registry vergessen".
CREATE OR REPLACE VIEW v_check_link_roles AS
SELECT COUNT(*) AS unregistered_roles,
       string_agg(Link_Role, ', ') AS role_list
FROM (
    SELECT DISTINCT ol.Link_Role
    FROM ObjectLinks ol
    LEFT JOIN LinkRoleRegistry r ON r.Link_Role = ol.Link_Role
    WHERE r.Link_Role IS NULL
);

-- Duplikat-Wächter ObjectCatalog — (Object_UUID, File_Name) muss eindeutig
-- sein (heute 0, genau deshalb billig). Ein Treffer = Composite-UUID-Kollision
-- (B-C4-Klasse: synthetische UUIDs ohne/mit falschem Namespace-Präfix) oder ein
-- Katalog-Block, der dasselbe Objekt doppelt registriert.
CREATE OR REPLACE VIEW v_check_catalog_dups AS
SELECT COUNT(*) AS dup_n,
       string_agg(Object_UUID || ' (' || File_Name || ' ×' || cnt || ')', ', ') AS sample
FROM (
    SELECT Object_UUID, File_Name, COUNT(*) AS cnt
    FROM ObjectCatalog
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
);

-- Kardinalitäts-Wächter (Klon-Fan-out) — strukturelle 1:1-Beziehungen,
-- die durch UUID-Mehrdeutigkeit (Klon-Korpora) auffächern würden:
--   TableOccurrence → base_table  genau 1
--   LayoutObject    → parent_layout (operational, Block 9)  genau 1
--   ScriptStep      → parent_script  genau 1
--   Layout          → context_table  ≤ 1
CREATE OR REPLACE VIEW v_check_cardinality AS
SELECT rule, COUNT(*) AS violation_n FROM (
    SELECT 'to_base_table' AS rule, Source_UUID
    FROM ObjectLinks WHERE Link_Role = 'base_table' AND Source_Type = 'TableOccurrence'
    GROUP BY Source_UUID, Source_File HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'lo_parent_layout', Source_UUID
    FROM ObjectLinks WHERE Link_Role = 'parent_layout' AND Source_Type = 'LayoutObject'
    GROUP BY Source_UUID, Source_File HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'step_parent_script', Source_UUID
    FROM ObjectLinks WHERE Link_Role = 'parent_script' AND Source_Type = 'ScriptStep'
    GROUP BY Source_UUID, Source_File HAVING COUNT(*) > 1
    UNION ALL
    SELECT 'layout_context_table', Source_UUID
    FROM ObjectLinks WHERE Link_Role = 'context_table' AND Source_Type = 'Layout'
    GROUP BY Source_UUID, Source_File HAVING COUNT(*) > 1
)
GROUP BY rule;

-- XML-Zählung vs. Katalog-Zeilen — Sequence_ID ist ROW_NUMBER() in
-- XML-Reihenfolge (+seq_offset, je Datei ab 1): MAX(Sequence_ID) = Zahl der im
-- XML gesehenen Records. COUNT(*) < MAX ⇒ der UPSERT hat UUID-Dubletten still
-- kollabiert (B-K3-Klasse, stiller Datenverlust).
CREATE OR REPLACE VIEW v_check_xml_counts AS
SELECT catalog, File_Name, rows_n, max_seq FROM (
    SELECT 'ScriptCatalog' AS catalog, File_Name,
           COUNT(*) AS rows_n, MAX(Sequence_ID) AS max_seq
    FROM ScriptCatalog GROUP BY File_Name
    UNION ALL
    SELECT 'Layouts', File_Name, COUNT(*), MAX(Sequence_ID)
    FROM Layouts GROUP BY File_Name
)
WHERE rows_n <> max_seq;

-- Generischer Dup-Absorption-Zensus — absorbierte UUID-Dubletten je Katalog/Datei.
-- Source_Records kommt aus dem P1-Zensus (DuplicateAbsorptions, je Chunk eine Zeile →
-- SUM je Katalog/Datei; grenz-robust beim Sub-Chunking). Stored_Rows wird LIVE aus den
-- Katalogtabellen gezählt (nicht persistiert → nie stale, kein Nach-Zensus-Schritt).
-- ScriptCatalog/Layouts brauchen keinen P1-Zensus: MAX(Sequence_ID) IST der Record-
-- Zähler in XML-Reihenfolge — dadurch für diese beiden deckungsgleich mit dem XML-Zähl-Wächter
-- (Selbsttest des Mechanismus). Absorbed > 0 ⇒ stiller Zeilenverlust durch
-- Quelldefekt (doppelte UUIDs im FileMaker-Export, Klasse B-K3).
CREATE TABLE IF NOT EXISTS DuplicateAbsorptions (
    File_Name VARCHAR NOT NULL,
    Catalog VARCHAR NOT NULL,
    PK_Columns VARCHAR,
    Chunk_Seq BIGINT NOT NULL DEFAULT 0,
    Source_Records BIGINT,
    PRIMARY KEY (Catalog, File_Name, Chunk_Seq)
);
CREATE OR REPLACE VIEW v_check_absorbed_dups AS
WITH source_counts AS (
    SELECT Catalog, File_Name, SUM(Source_Records) AS Source_Records
    FROM DuplicateAbsorptions GROUP BY Catalog, File_Name
    UNION ALL
    SELECT 'ScriptCatalog', File_Name, MAX(Sequence_ID) FROM ScriptCatalog GROUP BY File_Name
    UNION ALL
    SELECT 'Layouts', File_Name, MAX(Sequence_ID) FROM Layouts GROUP BY File_Name
),
stored_counts AS (
              SELECT 'ExternalDataSourceCatalog' AS Catalog, File_Name, COUNT(*) AS Stored_Rows FROM ExternalDataSourceCatalog GROUP BY File_Name
    UNION ALL SELECT 'BaseTableCatalog',        File_Name, COUNT(*) FROM BaseTableCatalog        GROUP BY File_Name
    UNION ALL SELECT 'TableOccurrenceCatalog',  File_Name, COUNT(*) FROM TableOccurrenceCatalog  GROUP BY File_Name
    UNION ALL SELECT 'RelationshipCatalog',     File_Name, COUNT(*) FROM RelationshipCatalog     GROUP BY File_Name
    UNION ALL SELECT 'FieldsForTables',         File_Name, COUNT(*) FROM FieldsForTables         GROUP BY File_Name
    UNION ALL SELECT 'ValueListCatalog',        File_Name, COUNT(*) FROM ValueListCatalog        GROUP BY File_Name
    UNION ALL SELECT 'OptionsForValueLists',    File_Name, COUNT(*) FROM OptionsForValueLists    GROUP BY File_Name
    UNION ALL SELECT 'CustomFunctionsCatalog',  File_Name, COUNT(*) FROM CustomFunctionsCatalog  GROUP BY File_Name
    UNION ALL SELECT 'AccountsCatalog',         File_Name, COUNT(*) FROM AccountsCatalog         GROUP BY File_Name
    UNION ALL SELECT 'StepsForScripts',         File_Name, COUNT(*) FROM StepsForScripts         GROUP BY File_Name
    UNION ALL SELECT 'LayoutObjects',           File_Name, COUNT(*) FROM LayoutObjects           GROUP BY File_Name
    UNION ALL SELECT 'ScriptCatalog',           File_Name, COUNT(*) FROM ScriptCatalog           GROUP BY File_Name
    UNION ALL SELECT 'Layouts',                 File_Name, COUNT(*) FROM Layouts                 GROUP BY File_Name
)
SELECT
    s.Catalog,
    s.File_Name,
    s.Source_Records,
    COALESCE(t.Stored_Rows, 0) AS Stored_Rows,
    s.Source_Records - COALESCE(t.Stored_Rows, 0) AS Absorbed
FROM source_counts s
LEFT JOIN stored_counts t ON t.Catalog = s.Catalog AND t.File_Name = s.File_Name
WHERE s.Source_Records - COALESCE(t.Stored_Rows, 0) > 0
ORDER BY Absorbed DESC;

-- External-Wertelisten-Auflösung: Wrapper-VLs (Source_Type='External') sollen in P4
-- einen source_valuelist-Link auf die Ziel-VL der Quelldatei erhalten. Nicht auflösbare
-- Ziele (Zieldatei nicht im Korpus, VL-ID/Name dort unbekannt, Datenquelle fehlt) werden
-- hier ausgewiesen statt still verschluckt. Auf einem Teil-Korpus sind Treffer erwartbar
-- (fehlende Zieldatei) — auf dem Voll-Korpus deutet jeder Treffer auf einen toten
-- External-Verweis im FileMaker-Quellbestand oder eine Resolver-Lücke.
CREATE OR REPLACE VIEW v_check_external_vl_unresolved AS
SELECT
    ovl.File_Name,
    ovl.VL_Name        AS Wrapper_VL,
    ovl.External_DS_Name,
    ovl.External_VL_ID,
    ovl.External_VL_Name
FROM OptionsForValueLists ovl
WHERE ovl.Source_Type = 'External'
  AND NOT EXISTS (
      SELECT 1 FROM ObjectLinks ol
      WHERE ol.Source_UUID = ovl.VL_UUID
        AND ol.Source_File = ovl.File_Name
        AND ol.Link_Role = 'source_valuelist'
  );

-- §F-3: Submenu-Ziel-Auflösung — ein Submenu-Item (isSubMenuItem="True") referenziert
-- sein Ziel-Menü nur per @id (ohne UUID); P4 löst es per (File_Name, Menu_ID) zu einem
-- opens_menu-Link auf. Items ohne Link haben eine nicht auflösbare Ziel-ID (kein Custom-
-- Menu-Katalog-Treffer — z.B. Verweis auf ein Built-in-Menü) und dürfen nicht still
-- verschluckt werden (Akzeptanzkriterium). Der Rest wird hier ausgewiesen.
CREATE OR REPLACE VIEW v_check_submenu_unresolved AS
SELECT
    COUNT(*) AS unresolved_n,
    string_agg(DISTINCT cmi.File_Name, ', ') AS files
FROM CustomMenuItemCatalog cmi
WHERE cmi.Is_SubMenuItem
  AND NOT EXISTS (
      SELECT 1 FROM ObjectLinks ol
      WHERE ol.Source_UUID = cmi.Item_UUID
        AND ol.Source_File = cmi.File_Name
        AND ol.Link_Role = 'opens_menu'
  );

-- Chunk_Type-NULL-Wächter — der P3-Backfill für Chunk_Type läuft NACH
-- seinem P2-Konsumenten (toter Verteidigungscode); taucht hier je ein NULL auf,
-- hat sich der P1-Extraktionspfad geändert und die P2-Chunk-Logik arbeitet blind.
CREATE OR REPLACE VIEW v_check_chunk_type_null AS
SELECT COUNT(*) AS null_n FROM DDR_Calculations WHERE Chunk_Type IS NULL;

-- Step-Rollen-Kuration (Step-ID-Mapping): field-Referenzen, deren Step-Typ
-- nicht in ScriptStepRoleMap kuratiert ist, landen im references_field-Fallback —
-- Where-used bleibt erhalten, aber ohne differenzierte Rolle (sets/reads/…).
-- Meldet die betroffenen Step-IDs samt Korpus-Namen (ggf. lokalisiert) zur
-- Nachkuration; greift locale-unabhängig auch für neue Steps künftiger
-- FileMaker-Versionen.
CREATE OR REPLACE VIEW v_check_step_roles AS
SELECT COUNT(*) AS unmapped_types,
       COALESCE(SUM(cnt), 0) AS unmapped_refs,
       string_agg('id=' || Step_ID || ' (' || any_name || ') ×' || cnt, ', ' ORDER BY cnt DESC) AS detail
FROM (
    SELECT sfs.Step_ID, any_value(xsr.Step_Name) AS any_name, COUNT(*) AS cnt
    FROM XMLStepReferences xsr
    JOIN (SELECT DISTINCT Step_UUID, Script_UUID, File_Name, Step_ID
          FROM StepsForScripts) sfs
      ON sfs.Step_UUID = xsr.Step_UUID
     AND sfs.Script_UUID = xsr.Script_UUID
     AND sfs.File_Name = xsr.File_Name
    LEFT JOIN ScriptStepRoleMap rm ON rm.Step_ID = sfs.Step_ID
    WHERE xsr.Ref_Type = 'field' AND rm.Step_ID IS NULL
    GROUP BY sfs.Step_ID
);

-- Orphan-QUELLEN + NULL-Ziel-Bestand: Gegenstück zu v_check_orphan_links (das
-- nur Targets prüft). Quellen sind per Konstruktion datei-lokal (der Link
-- entsteht beim Import der Quelldatei) — ein Orphan-Source ist daher AUCH auf
-- einem Teil-Korpus ein Integritätsproblem (Klasse B-C1: Quelle im Link-Block
-- nicht gefiltert, im Catalog-Block schon). NULL-Targets/NULL-Is_Cross_File
-- zwingen jeden direkten ObjectLinks-Konsumenten zu NULL-Safety (NOT-IN-Falle).
CREATE OR REPLACE VIEW v_check_orphan_sources AS
SELECT
    (SELECT COUNT(*) FROM (
        SELECT DISTINCT Source_UUID
        FROM ObjectLinks
        WHERE Source_UUID IS NOT NULL AND Source_UUID <> ''
          AND Source_UUID NOT IN (SELECT Object_UUID FROM ObjectCatalog)
    )) AS orphan_src_n,
    (SELECT COUNT(*) FROM ObjectLinks WHERE Target_UUID IS NULL) AS null_target_links,
    (SELECT COUNT(*) FROM ObjectLinks WHERE Is_Cross_File IS NULL) AS null_crossfile_links;

-- Auflösungsquote je Referenz-Typ nach Phase A (P2). Die Code-Kommentare
-- behaupten ≈97–99 % — bislang unüberwacht; ein Resolver-Drift (z.B. nach einem
-- Join-/Scoping-Umbau) würde sonst still Links verlieren. Nur Typen, deren
-- Ref_UUID in P2 aufgelöst wird: Step-/Layout-Referenzen (außer step/variable —
-- Variablen erhalten erst in P3/P4 synthetische UUIDs) und Calc-Feld-Referenzen
-- (function/customfunction/pluginfunction/variable lösen namensbasiert in P4 auf,
-- tragen hier konstruktionsbedingt kein Ref_UUID).
CREATE OR REPLACE VIEW v_check_resolution AS
SELECT
    'step' AS source,
    Ref_Type AS ref_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (Ref_UUID IS NOT NULL AND Ref_UUID <> '') AS resolved,
    ROUND(100.0 * COUNT(*) FILTER (Ref_UUID IS NOT NULL AND Ref_UUID <> '') / COUNT(*), 1) AS quote_pct
FROM XMLStepReferences
WHERE Ref_Type <> 'variable'
GROUP BY Ref_Type
UNION ALL
SELECT 'layout', Ref_Type, COUNT(*),
       COUNT(*) FILTER (Ref_UUID IS NOT NULL AND Ref_UUID <> ''),
       ROUND(100.0 * COUNT(*) FILTER (Ref_UUID IS NOT NULL AND Ref_UUID <> '') / COUNT(*), 1)
FROM XMLLayoutReferences
GROUP BY Ref_Type
UNION ALL
SELECT 'calc', Ref_Type, COUNT(*),
       COUNT(*) FILTER (Ref_UUID IS NOT NULL AND Ref_UUID <> ''),
       ROUND(100.0 * COUNT(*) FILTER (Ref_UUID IS NOT NULL AND Ref_UUID <> '') / COUNT(*), 1)
FROM XMLCalcReferences
WHERE Ref_Type = 'field'
GROUP BY Ref_Type;

-- F-1b: Auflösungsquote der Relationship-Prädikat-Felder (left_field/right_field).
-- Seit der strukturellen P1-Gültigkeitsprüfung tragen Prädikat-Felder auf externen
-- TO-Seiten eine leere (→NULL) Feld-UUID; P4 löst sie über (Field_TO_UUID, Field_ID)
-- auf die kanonische Feld-UUID auf. Unaufgelöst bleiben legitim nur die Fälle, deren
-- Zieldatei nicht im (Teil-)Korpus importiert ist — daher INFO, kein Fehler. Zähl-
-- einheit = ein Prädikat-Feld-Slot je (Rel_ID, File_Name, Predicate_Index, Seite).
CREATE OR REPLACE VIEW v_check_relationship_field_resolution AS
WITH slots AS (
    SELECT File_Name, 'left' AS side,
           Left_Field_ID AS field_id, Left_Field_UUID AS field_uuid
    FROM RelationshipCatalog WHERE Left_Field_ID IS NOT NULL
    UNION ALL
    SELECT File_Name, 'right',
           Right_Field_ID, Right_Field_UUID
    FROM RelationshipCatalog WHERE Right_Field_ID IS NOT NULL
)
SELECT
    'relationship' AS source,
    side AS ref_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (
        field_uuid IS NOT NULL
        AND field_uuid IN (SELECT Field_UUID FROM FieldsForTables WHERE Field_UUID IS NOT NULL)
    ) AS resolved,
    ROUND(100.0 * COUNT(*) FILTER (
        field_uuid IS NOT NULL
        AND field_uuid IN (SELECT Field_UUID FROM FieldsForTables WHERE Field_UUID IS NOT NULL)
    ) / NULLIF(COUNT(*), 0), 1) AS quote_pct
FROM slots
GROUP BY side;

-- „Function Missing"-Platzhalter — FileMaker schreibt bei einer beim EXPORT nicht
-- geladenen Plugin-Funktion <Chunk type="VariableReference">Function Missing</Chunk>.
-- P3 verwirft diese Chunks aus der Variablen-Extraktion (kein Scheinvariablen-Objekt),
-- die Roh-Chunks bleiben aber in DDR_Calculations. Diese View zählt sie, damit die
-- eigentliche Information (ein Plugin fehlte im Export → Referenzen unauflösbar) als
-- Info-Finding sichtbar wird statt still unterzugehen. > 0 ⇒ Export unvollständig
-- (Plugin auf dem exportierenden Client nicht installiert/aktiviert).
CREATE OR REPLACE VIEW v_check_function_missing AS
SELECT
    COUNT(*) AS chunk_n,
    string_agg(DISTINCT File_Name, ', ') AS files
FROM DDR_Calculations
WHERE Chunk_Type = 'VariableReference'
  AND regexp_extract(Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Function Missing';

-- unbekannte LayoutObject-Typen. `Object_Type` ist der lokalisierte
-- /LayoutObject/@type-String; die P4-Locale-Normalisierung bildet die bekannten dt.
-- Namen auf ihr englisches Kanon ab. Diese View listet jeden Object_Type, der NACH der
-- Normalisierung NICHT im kanonischen englischen Typ-Set liegt — also (a) ein neuer
-- Locale-Name eines künftigen Exports (Mapping in convert_xml_04_catalog.sql erweitern)
-- oder (b) ein echter neuer FileMaker-Typ (Kanon-Set hier ergänzen). > 0 ⇒ typ-gefilterte
-- Analysen/Dashboards zählen diese Objekte falsch. Das Kanon-Set ist die autoritative
-- Liste der gültigen englischen Typnamen (inkl. der real existierenden „Rounded Rectangle"/
-- „Concealed Edit Box", die in der CLAUDE.md-22er-Liste fehlen).
CREATE OR REPLACE VIEW v_check_unknown_object_types AS
SELECT
    Object_Type,
    COUNT(*)                              AS n,
    string_agg(DISTINCT File_Name, ', ')  AS files
FROM LayoutObjects
WHERE Object_Type IS NOT NULL
  AND Object_Type NOT IN (
      'Text', 'Edit Box', 'Grouped Button', 'Rectangle', 'Line', 'Graphic',
      'Group', 'Checkbox Set', 'Button', 'Container', 'Portal', 'Drop-down List',
      'Panel', 'Radio Button Set', 'Button Bar', 'PopoverPanel', 'Popover Button',
      'Pop-up Menu', 'Tab Control', 'Web Viewer', 'Oval', 'Rounded Rectangle',
      'Concealed Edit Box', 'Slide Control', 'Drop-down Calendar'
  )
GROUP BY Object_Type
ORDER BY n DESC;

-- unbekannte LayoutPart-Typen (nach der P4-Locale-Normalisierung). Analog
-- v_check_unknown_object_types: jeder Part_Type außerhalb des kanonischen englischen
-- Part-Sets ⇒ neuer Locale-Name (DE→EN-Mapping in convert_xml_04_catalog.sql erweitern)
-- oder echter neuer Part-Typ (Kanon-Set hier ergänzen). Ein verpasster Sub-summary-Locale-
-- Name kostet zudem breaks_on_field-Links (Filter `LIKE '%Sub-summary%'`).
CREATE OR REPLACE VIEW v_check_unknown_part_types AS
SELECT
    Part_Type,
    COUNT(*)                              AS n,
    string_agg(DISTINCT File_Name, ', ')  AS files
FROM LayoutParts
WHERE Part_Type IS NOT NULL
  AND Part_Type NOT IN (
      'Title Header', 'Header', 'Leading Grand Summary', 'Leading Sub-summary',
      'Body', 'Trailing Sub-summary', 'Trailing Grand Summary', 'Footer',
      'Title Footer', 'Top Navigation', 'Bottom Navigation'
  )
GROUP BY Part_Type
ORDER BY n DESC;
