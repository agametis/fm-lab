/*
-- convert_xml_01_extract.sql — Phase 1 der XML-Konvertierungs-Pipeline
-- (project/plan_xml_diff.md §4). EINZIGE XML-lesende Phase: überführt die
-- Roh-Kataloge 1:1 aus der XML in DuckDB-Tabellen und speichert Roh-XML-
-- Fragmente (Parameters_XML, Object_XML, Step_XML, …) für die nachgelagerten
-- Phasen. Die Referenz-Auflösung liegt in convert_xml_02_resolve.sql (Phase 2).
-- Chunk-fähig: jede Sektion ist bei einem Chunk ohne ihren Katalog ein No-Op
-- (UPSERT bzw. branch-guarded DELETE bei PrivilegeSet*, §4.3).
--
-- DuckDB SQL Script to parse FileMaker XML Catalog
-- and extract various catalog information into tables.

-- XML File must be converted to UTF-8 encoding beforehand!

-- Version 0.4
-- Date: 2026-01-14

-- Schema-Versionierung (siehe project/prd_schema_versioning_auto_heal.md):
--   @SCHEMA_VERSION wird vom Shell-Skript per grep ausgewertet und gegen den
--   Wert in der DB-Tabelle SchemaInfo verglichen. Bei Mismatch löst der
--   Auto-Heal-Mechanismus einen Force-Rebuild aus.
--
--   @SCHEMA_HASH_FILES listet die SQL-Files, deren MD5-Summe als sekundärer
--   Drift-Indikator herangezogen wird. build_resolutions.sql bewusst NICHT
--   enthalten, weil es nur abgeleitete Tabellen anlegt.

-- @SCHEMA_VERSION 1.4.1
-- @SCHEMA_VERSION_DATE 2026-06-23
-- @SCHEMA_CHANGELOG 1.4.1: CalcsForCustomFunctions auch für SaXML v2.3.0.0 (FM 26+),
--   wo <Calculation> in <CustomFunction> eingebettet ist statt in einer separaten
--   <CalcsForCustomFunctions>-Sektion. Struktur-tolerante Doppel-Extraktion (Legacy +
--   Embedded) aus EINEM CustomFunctionsCatalog-Parse; keine Versions-Weiche. Additiv.
--   Siehe project/bugreports/2026-06-23_Philipp-Puls_CustomFunctions_v26.md.
-- @SCHEMA_CHANGELOG 1.4.0: Paket A (v4) — neue Tabellen FileAccessAuthorizations,
--   CustomMenuSetCatalog, LibraryReferences (additiv; bestehende 41 Tabellen unverändert).
--   + CustomMenuSet im ObjectCatalog + CustomMenuSet→CustomMenu (contains_menu) in ObjectLinks.
-- @SCHEMA_HASH_FILES sql/convert-xml/convert_xml_01_extract.sql sql/convert-xml/convert_xml_02_resolve.sql sql/convert-xml/convert_xml_03_details.sql sql/convert-xml/convert_xml_04_catalog.sql
*/


-- webbed (XML-Reader) laden. Stock/Manual/öffentliches Repo: das signierte
-- Community-webbed aus dem Extension-Home (im Image gebacken — kein INSTALL/
-- Netzwerk nötig). Der Convert-Pipeline-Treiber (convert_fm_xml.sh) ERSETZT diese
-- Zeile im Patched-Modus per sed durch  LOAD '<abs-Pfad>'  und startet duckdb mit
-- -unsigned (das gepatchte webbed mit dem nested-attr-SAX-Fix ist lokal gebaut →
-- unsigniert). Siehe project/plan_xml_diff_streaming.md §3b/§3c.
LOAD webbed;

-- xml_unescape(): dekodiert die gängigen XML-Entities in TEXT, der aus ATTRIBUTwerten
-- gelesen wird (These 1b / Entity-Residual). Hintergrund: webbeds SAX-Pfad dekodiert
-- numerische/benannte Entities in Attributen NICHT (DOM schon) → derselbe Name kommt
-- je nach Chunk-Größe (SAX bei großem Chunk vs DOM bei kleinem) als 'Copy &#38; Paste'
-- ODER 'Copy & Paste' → chunk-abhängig (bricht --split/--subchunk-Bit-Identität).
-- Anwendung auf die betroffenen Namens-Spalten macht beide Pfade konsistent.
-- IDEMPOTENT für DOM-Werte: ein bereits dekodiertes literales '&' enthält kein
-- Entity-Muster und bleibt unverändert. '&amp;' MUSS zuletzt ersetzt werden, sonst
-- würde '&amp;lt;' fälschlich zu '<' statt '&lt;'.
CREATE OR REPLACE MACRO xml_unescape(s) AS
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        s,
        '&#38;','&'), '&#60;','<'), '&#62;','>'), '&#34;','"'), '&#39;',''''),
        '&lt;','<'), '&gt;','>'), '&quot;','"'), '&apos;',''''),
        '&amp;','&');

-- json_escape() Macro entfernt: xml_to_json() wird nicht mehr verwendet.
-- Stattdessen speichern wir rohes XML (Object_XML, Parameters_XML, Menu_XML, Theme_XML)
-- und extrahieren Werte direkt per xml_extract_text().

-- Pfad zur XML-Datei. Env-Variable FM_XML_DIR überschreibt den Default
-- 'xml' (relativ zum aktuellen Arbeitsverzeichnis). Das convert-xml-Skill-
-- Skript setzt FM_XML_DIR auf ein temporäres Verzeichnis.
SET file_search_path = COALESCE(NULLIF(getenv('FM_XML_DIR'), ''), 'xml');
SET VARIABLE fm_xml = 'Test.xml';  -- Wird durch Skill-Script ersetzt

-- Schema-Marker (werden vom Shell-Skript zur Build-Zeit ersetzt; siehe
-- Header-Kommentar @SCHEMA_VERSION / @SCHEMA_HASH_FILES und §5.2 des PRD).
-- Die SchemaInfo-Tabelle (s. u.) wird am Ende des Imports mit diesen Werten
-- befüllt, sodass folgende Läufe Drift detektieren können.
SET VARIABLE schema_version = '1.1.0';   -- Wird durch Skill-Script ersetzt
SET VARIABLE schema_hash = 'pending';    -- Wird durch Skill-Script ersetzt
SET VARIABLE schema_notes = 'convert_xml.sql import';

-- Sub-Chunk-Offset für Sequence_ID (These 1b, plan_xml_diff_streaming_optimization.md).
-- Default 0 = unsplit/coarse unverändert. Beim Sub-Chunking eines Sequence_ID-Katalogs
-- (LayoutCatalog/ScriptCatalog) injiziert das Skript pro Sub-Chunk den globalen
-- Record-Offset (= Σ Records vorheriger Sub-Chunks), damit ROW_NUMBER() pro Chunk +
-- Offset die globale XML-Reihenfolge rekonstruiert (Sequence_ID wird nur als ORDER-BY
-- konsumiert → Ordnung genügt, Kontiguität egal).
SET VARIABLE seq_offset = 0;   -- Wird beim Sub-Chunking pro Chunk ersetzt

-- maximale Speichergröße für read_xml erhöhen (Standard: 16MB)
SET VARIABLE max_filesize TO 256000000; -- 256 MB

-- ============================================================================
-- SAX-Streaming-Aktuatoren (project/plan_xml_diff_streaming.md §4, Pfad 1)
-- ----------------------------------------------------------------------------
-- Empirisch ermittelte webbed-Mechanik: NICHT der streaming-Flag, sondern
-- `maximum_file_size` ist der Aktuator. Datei > maximum_file_size + streaming=true
-- → SAX (O(beschränkt) RAM). Datei ≤ maximum_file_size → DOM (egal welcher Flag).
-- streaming=false + Datei > Cap → harter Fehler (KEIN stilles Korrumpieren).
--
-- Darum zwei Variablen, von jedem typisierten read_xml gemeinsam genutzt:
--   dom_threshold  — der maximum_file_size-Wert pro Read (klein ⇒ erzwingt SAX)
--   use_streaming  — der streaming-Flag (nur true, wenn der SAX-nested-attr-Fix da ist)
--
-- SAFE-BY-DEFAULT: Default = DOM (dom_threshold = max_filesize, use_streaming=false).
-- So bleibt Stock-/öffentliches-webbed unverändert sicher (256-MB-DOM, Fehler erst
-- bei >256 MB statt stiller Stream-Korruption). NUR der Patched-Modus des Treibers
-- (convert_fm_xml.sh) ersetzt den Marker unten durch einen Capability-Self-Test,
-- der use_streaming/dom_threshold scharf schaltet.
SET VARIABLE dom_threshold = getvariable('max_filesize');
SET VARIABLE use_streaming = false;
-- @WEBBED_SELFTEST@  (Treiber ersetzt diese Zeile im Patched-Modus; sonst No-Op)

-- Performance (P1, project/plan_xml_performance.md §6): File_Name EINMAL aus der XML
-- ableiten und als Variable bereitstellen. Bislang baute jede der ~28 Katalog-
-- Sektionen über eine `filename_normalized`-CTE einen ZUSÄTZLICHEN read_xml nur für
-- den (datei-weit konstanten) File_Name auf — DuckDB dedupliziert die zwei
-- read_xml-Scans pro Statement NICHT, was die Parse-Last je Sektion verdoppelte
-- (~2,3 s → ~1,05 s ohne den Zweit-Scan). filename_normalized liest jetzt diese
-- Variable; das Ergebnis ist bit-identisch (gleiche Ableitung, nur einmal berechnet).
-- KONSOLIDIERTER ROOT-READ (project/plan_xml_diff_streaming_preprocess.md): die
-- Root-Attribute (`/FMSaveAsXML/@…`) wurden zuvor von DREI read_xml_objects-Aufrufen
-- separat gelesen (fm_file-Ableitung, XMLMetadata, FilesCatalog) — je ein Whole-Doc-
-- DOM-Parse. Da Root-Attribute strukturell NICHT per record_element streambar sind
-- (Root = ganzes Dokument), werden sie hier EINMAL in eine Temp-Tabelle gelesen und
-- von allen drei Konsumenten genutzt → 3 → 1 Whole-Doc-Parse, bit-identisch.
CREATE OR REPLACE TEMP TABLE _root_attrs AS
SELECT
    xml_extract_text(xml, '/FMSaveAsXML/@File')[1] AS file_full,
    regexp_replace(xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', '') AS file_name,
    xml_extract_text(xml, '/FMSaveAsXML/@UUID')[1] AS file_uuid,
    xml_extract_text(xml, '/FMSaveAsXML/@version')[1] AS xml_version,
    xml_extract_text(xml, '/FMSaveAsXML/@Source')[1] AS fm_version,
    COALESCE(xml_extract_text(xml, '/FMSaveAsXML/@Has_DDR_INFO')[1], 'False') AS has_ddr_info,
    xml_extract_text(xml, '/FMSaveAsXML/@locale')[1] AS locale
FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'));

SET VARIABLE fm_file = (SELECT file_name FROM _root_attrs);


-- ========================================
-- SchemaInfo (Versions-Persistenz)
-- ========================================
-- Speichert den Schema-Stand (Version + Content-Hash + Timestamp) nach jedem
-- erfolgreichen Import. Wird vom convert_fm_xml.sh-Skript zur Drift-Detection
-- gelesen. Historie bleibt erhalten — aktueller Stand =
-- arg_max(SchemaInfo.* ORDER BY Schema_Built_At).
CREATE TABLE IF NOT EXISTS SchemaInfo (
    Schema_Version VARCHAR NOT NULL,
    Schema_Hash VARCHAR NOT NULL,
    Schema_Built_At TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Builder_Notes VARCHAR,
    PRIMARY KEY (Schema_Version, Schema_Hash, Schema_Built_At)
);


-- ========================================
-- XML Metadata (Root-Attribut-Informationen)
-- ========================================
-- Tabelle für XML-Metadaten aller importierten Dateien
-- HINWEIS: Diese Daten sind auch in FilesCatalog verfügbar,
-- XMLMetadata wird aus historischen Gründen beibehalten
CREATE TABLE IF NOT EXISTS XMLMetadata (
    Has_DDR_INFO VARCHAR,
    XML_Version VARCHAR,
    FileMaker_Version VARCHAR,
    Filename VARCHAR,
    File_UUID VARCHAR,
    Locale VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (File_UUID, File_Name)
);

-- XMLMetadata befüllen — aus dem konsolidierten _root_attrs (kein eigener Root-Read).
INSERT INTO XMLMetadata
SELECT
    has_ddr_info as Has_DDR_INFO,
    xml_version as XML_Version,
    fm_version as FileMaker_Version,
    file_full as Filename,
    file_uuid as File_UUID,
    locale as Locale,
    getvariable('fm_file') as File_Name
FROM _root_attrs
ON CONFLICT (File_UUID, File_Name) DO UPDATE SET
    Has_DDR_INFO = EXCLUDED.Has_DDR_INFO,
    XML_Version = EXCLUDED.XML_Version,
    FileMaker_Version = EXCLUDED.FileMaker_Version,
    Filename = EXCLUDED.Filename,
    Locale = EXCLUDED.Locale;


-- ========================================
-- FilesCatalog (Multi-File Support)
-- ========================================
-- Tabelle für Metadaten aller importierten FileMaker-Dateien
-- Wird bei jedem Import aktualisiert (UPSERT)
CREATE TABLE IF NOT EXISTS FilesCatalog (
    File_Name VARCHAR PRIMARY KEY,          -- Dateiname ohne .fmp12 Suffix
    File_FullName VARCHAR,                  -- Dateiname mit .fmp12 Suffix
    File_UUID VARCHAR,                      -- UUID der Datei (aus XML); KEIN UNIQUE: geklonte
                                            -- FileMaker-Dateien ("Kopie speichern unter…") teilen
                                            -- dieselbe interne UUID. Identität liegt auf File_Name (PK).
                                            -- Siehe project/bugreports/2026-06-18_Michael-Heider_Clon-Duplikate.md
    FileMaker_Version VARCHAR,              -- FileMaker Version (z.B. "ProAdvanced 21.0.2.206")
    Has_DDR_INFO BOOLEAN DEFAULT FALSE,     -- DDR-Info verfügbar?
    Import_Timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Zeitpunkt des letzten Imports
    XML_Path VARCHAR                        -- Pfad zur XML-Quelldatei
);

-- FilesCatalog befüllen (UPSERT bei wiederholten Importen)
INSERT INTO FilesCatalog (File_Name, File_FullName, File_UUID, FileMaker_Version, Has_DDR_INFO, Import_Timestamp, XML_Path)
SELECT
    file_name as File_Name,
    file_full as File_FullName,
    file_uuid as File_UUID,
    fm_version as FileMaker_Version,
    has_ddr_info = 'True' as Has_DDR_INFO,
    (now() AT TIME ZONE 'UTC') as Import_Timestamp,   -- explizit UTC (TZ-unabhängig, s. devcontainer Etc/UTC)
    getvariable('fm_xml') as XML_Path
FROM _root_attrs
ON CONFLICT (File_Name) DO UPDATE SET
    Import_Timestamp = EXCLUDED.Import_Timestamp,
    FileMaker_Version = EXCLUDED.FileMaker_Version,
    Has_DDR_INFO = EXCLUDED.Has_DDR_INFO,
    XML_Path = EXCLUDED.XML_Path;


-- ExternalDataSourceCatalog
CREATE TABLE IF NOT EXISTS ExternalDataSourceCatalog (
    DS_ID BIGINT,
    DS_Name VARCHAR,
    DS_Type VARCHAR,
    Path VARCHAR,
    DS_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (DS_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO ExternalDataSourceCatalog
SELECT
    id AS DS_ID,
    name AS DS_Name,
    type AS DS_Type,
    File.UniversalPathList AS Path,
    UUID->>'#text' AS DS_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='ExternalDataSourceCatalog',
    record_element='ExternalDataSource',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'type': 'VARCHAR',
        'File': 'STRUCT(UniversalPathList VARCHAR)',
        'UUID': 'STRUCT("#text" VARCHAR, "accountName" VARCHAR, "modifications" BIGINT, "timestamp" VARCHAR, "userName" VARCHAR)'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (DS_UUID, File_Name) DO UPDATE SET
    DS_ID = EXCLUDED.DS_ID,
    DS_Name = EXCLUDED.DS_Name,
    DS_Type = EXCLUDED.DS_Type,
    Path = EXCLUDED.Path;


-- BaseTableCatalog
CREATE TABLE IF NOT EXISTS BaseTableCatalog (
    BT_ID BIGINT,
    BT_Name VARCHAR,
    BT_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (BT_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO BaseTableCatalog
SELECT
    id AS BT_ID,
    name AS BT_Name,
    UUID->>'#text' AS BT_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='BaseTableCatalog',
    record_element='BaseTable',
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'UUID': 'STRUCT("#text" VARCHAR, "modifications" BIGINT, "userName" VARCHAR, "accountName" VARCHAR, "timestamp" VARCHAR)'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (BT_UUID, File_Name) DO UPDATE SET
    BT_ID = EXCLUDED.BT_ID,
    BT_Name = EXCLUDED.BT_Name;


-- TableOccurrenceCatalog
CREATE TABLE IF NOT EXISTS TableOccurrenceCatalog (
    TO_ID BIGINT,
    TO_Name VARCHAR,
    TO_Type VARCHAR,
    TO_UUID VARCHAR,
    DS_ID BIGINT,
    DS_Name VARCHAR,
    DS_UUID VARCHAR,
    BT_ID BIGINT,
    BT_Name VARCHAR,
    BT_UUID VARCHAR,
    View_State VARCHAR,
    Box_Height INTEGER,
    Coord_Top INTEGER,
    Coord_Left INTEGER,
    Coord_Bottom INTEGER,
    Coord_Right INTEGER,
    Color_R INTEGER,
    Color_G INTEGER,
    Color_B INTEGER,
    Color_Alpha DOUBLE,
    File_Name VARCHAR,
    PRIMARY KEY (TO_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO TableOccurrenceCatalog (
    TO_ID, TO_Name, TO_Type, TO_UUID,
    DS_ID, DS_Name, DS_UUID,
    BT_ID, BT_Name, BT_UUID,
    View_State, Box_Height,
    Coord_Top, Coord_Left, Coord_Bottom, Coord_Right,
    Color_R, Color_G, Color_B, Color_Alpha,
    File_Name
)
SELECT
    id AS TO_ID,
    name AS TO_Name,
    type AS TO_Type,
    UUID->>'#text' AS TO_UUID,
    BaseTableSourceReference.DataSourceReference.id AS DS_ID,
    BaseTableSourceReference.DataSourceReference.name AS DS_Name,
    BaseTableSourceReference.DataSourceReference.UUID AS DS_UUID,
    BaseTableSourceReference.BaseTableReference.id AS BT_ID,
    BaseTableSourceReference.BaseTableReference.name AS BT_Name,
    BaseTableSourceReference.BaseTableReference.UUID AS BT_UUID,
    View AS View_State,
    height AS Box_Height,
    CoordRect.top AS Coord_Top,
    CoordRect."left" AS Coord_Left,
    CoordRect.bottom AS Coord_Bottom,
    CoordRect."right" AS Coord_Right,
    Color.red AS Color_R,
    Color.green AS Color_G,
    Color.blue AS Color_B,
    Color.alpha AS Color_Alpha,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='TableOccurrenceCatalog',
    record_element='TableOccurrence',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'type': 'VARCHAR',
        'View': 'VARCHAR',
        'height': 'INTEGER',
        'UUID': 'STRUCT("#text" VARCHAR, "accountName" VARCHAR, "modifications" BIGINT, "timestamp" VARCHAR, "userName" VARCHAR)',
        'BaseTableSourceReference': 'STRUCT(
            "DataSourceReference" STRUCT(
                "id" BIGINT,
                "name" VARCHAR,
                "UUID" VARCHAR
            ),
            "BaseTableReference" STRUCT(
                "id" BIGINT,
                "name" VARCHAR,
                "UUID" VARCHAR
            )
        )',
        'CoordRect': 'STRUCT("top" INTEGER, "left" INTEGER, "bottom" INTEGER, "right" INTEGER)',
        'Color': 'STRUCT("red" INTEGER, "green" INTEGER, "blue" INTEGER, "alpha" DOUBLE)'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (TO_UUID, File_Name) DO UPDATE SET
    TO_ID = EXCLUDED.TO_ID,
    TO_Name = EXCLUDED.TO_Name,
    TO_Type = EXCLUDED.TO_Type,
    DS_ID = EXCLUDED.DS_ID,
    DS_Name = EXCLUDED.DS_Name,
    DS_UUID = EXCLUDED.DS_UUID,
    BT_ID = EXCLUDED.BT_ID,
    BT_Name = EXCLUDED.BT_Name,
    BT_UUID = EXCLUDED.BT_UUID,
    View_State = EXCLUDED.View_State,
    Box_Height = EXCLUDED.Box_Height,
    Coord_Top = EXCLUDED.Coord_Top,
    Coord_Left = EXCLUDED.Coord_Left,
    Coord_Bottom = EXCLUDED.Coord_Bottom,
    Coord_Right = EXCLUDED.Coord_Right,
    Color_R = EXCLUDED.Color_R,
    Color_G = EXCLUDED.Color_G,
    Color_B = EXCLUDED.Color_B,
    Color_Alpha = EXCLUDED.Color_Alpha;


-- RelationshipCatalog
CREATE TABLE IF NOT EXISTS RelationshipCatalog (
    Rel_ID BIGINT,
    Left_TO_Name VARCHAR,
    Left_TO_ID BIGINT,
    Left_TO_UUID VARCHAR,
    Left_Delete BOOLEAN,
    Left_Create BOOLEAN,
    Right_TO_Name VARCHAR,
    Right_TO_ID BIGINT,
    Right_TO_UUID VARCHAR,
    Right_Delete BOOLEAN,
    Right_Create BOOLEAN,
    Operator VARCHAR,
    -- Predicate_Index: 1-basierter Index des Join-Prädikats innerhalb der Relation.
    -- Mehrfeld-Joins (FileMaker JoinPredicateList membercount > 1) erzeugen pro
    -- Prädikat eine eigene Zeile; ohne diesen Schlüssel-Bestandteil kollabierte das
    -- ON CONFLICT (Rel_ID, File_Name) frühere Prädikate auf nur eines (zuletzt gewinnt).
    Predicate_Index BIGINT,
    Left_Field_Name VARCHAR,
    Left_Field_ID BIGINT,
    Left_Field_UUID VARCHAR,
    Left_Field_TO_Name VARCHAR,
    Left_Field_TO_UUID VARCHAR,
    Right_Field_Name VARCHAR,
    Right_Field_ID BIGINT,
    Right_Field_UUID VARCHAR,
    Right_Field_TO_Name VARCHAR,
    Right_Field_TO_UUID VARCHAR,
    -- Sortier-Konfiguration je TO-Seite (FileMaker „Datensätze sortieren").
    -- Pro Relation/Seite konstant → über alle Predicate_Index-Zeilen wiederholt
    -- (wie Left_TO_Name). _Enabled = SortSpecification@value; _Fields = kommaseparierte
    -- Sortierfelder (mit „(absteigend)"-Marker bei Descending), NULL wenn deaktiviert.
    -- _Field_UUIDs = Feld-UUIDs der Sortierfolge (PrimaryField) → speisen in P4 die
    -- Relationship→Field-Graph-Links (Link_Role='sort_field'), damit die Sort-Abhängigkeit
    -- in der Where-used-Analyse des Felds auftaucht.
    Left_Sort_Enabled BOOLEAN,
    Left_Sort_Fields VARCHAR,
    Left_Sort_Field_UUIDs VARCHAR[],
    Right_Sort_Enabled BOOLEAN,
    Right_Sort_Fields VARCHAR,
    Right_Sort_Field_UUIDs VARCHAR[],
    File_Name VARCHAR,
    PRIMARY KEY (Rel_ID, File_Name, Predicate_Index)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO RelationshipCatalog
SELECT
    id AS Rel_ID,
    LeftTable.TableOccurrenceReference.name AS Left_TO_Name,
    LeftTable.TableOccurrenceReference.id AS Left_TO_ID,
    LeftTable.TableOccurrenceReference.UUID AS Left_TO_UUID,
    LeftTable.cascadeDelete AS Left_Delete,
    LeftTable.cascadeCreate AS Left_Create,
    RightTable.TableOccurrenceReference.name AS Right_TO_Name,
    RightTable.TableOccurrenceReference.id AS Right_TO_ID,
    RightTable.TableOccurrenceReference.UUID AS Right_TO_UUID,
    RightTable.cascadeDelete AS Right_Delete,
    RightTable.cascadeCreate AS Right_Create,
    pe.jp.type AS Operator,
    pe.idx AS Predicate_Index,
    pe.jp.LeftField.FieldReference.name AS Left_Field_Name,
    pe.jp.LeftField.FieldReference.id AS Left_Field_ID,
    pe.jp.LeftField.FieldReference.UUID AS Left_Field_UUID,
    pe.jp.LeftField.FieldReference.TableOccurrenceReference.name AS Left_Field_TO_Name,
    pe.jp.LeftField.FieldReference.TableOccurrenceReference.UUID AS Left_Field_TO_UUID,
    pe.jp.RightField.FieldReference.name AS Right_Field_Name,
    pe.jp.RightField.FieldReference.id AS Right_Field_ID,
    pe.jp.RightField.FieldReference.UUID AS Right_Field_UUID,
    pe.jp.RightField.FieldReference.TableOccurrenceReference.name AS Right_Field_TO_Name,
    pe.jp.RightField.FieldReference.TableOccurrenceReference.UUID AS Right_Field_TO_UUID,
    -- Sortierfelder je Seite (konstant über die Prädikat-Zeilen einer Relation):
    LeftTable.SortSpecification.value AS Left_Sort_Enabled,
    CASE WHEN LeftTable.SortSpecification.value
         THEN array_to_string(list_transform(LeftTable.SortSpecification.SortList.Sort,
                lambda s, i: s.PrimaryField.FieldReference.name
                  || CASE WHEN s.type = 'Descending' THEN ' (absteigend)' ELSE '' END), ', ')
         ELSE NULL END AS Left_Sort_Fields,
    CASE WHEN LeftTable.SortSpecification.value
         THEN list_filter(list_transform(LeftTable.SortSpecification.SortList.Sort,
                lambda s, i: s.PrimaryField.FieldReference.UUID), lambda u: u IS NOT NULL)
         ELSE NULL END AS Left_Sort_Field_UUIDs,
    RightTable.SortSpecification.value AS Right_Sort_Enabled,
    CASE WHEN RightTable.SortSpecification.value
         THEN array_to_string(list_transform(RightTable.SortSpecification.SortList.Sort,
                lambda s, i: s.PrimaryField.FieldReference.name
                  || CASE WHEN s.type = 'Descending' THEN ' (absteigend)' ELSE '' END), ', ')
         ELSE NULL END AS Right_Sort_Fields,
    CASE WHEN RightTable.SortSpecification.value
         THEN list_filter(list_transform(RightTable.SortSpecification.SortList.Sort,
                lambda s, i: s.PrimaryField.FieldReference.UUID), lambda u: u IS NOT NULL)
         ELSE NULL END AS Right_Sort_Field_UUIDs,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='RelationshipCatalog',
    record_element='Relationship',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'id': 'BIGINT',
        'LeftTable': 'STRUCT(
            cascadeCreate BOOLEAN,
            cascadeDelete BOOLEAN,
            "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR),
            "SortSpecification" STRUCT(
                value BOOLEAN,
                "SortList" STRUCT(
                    "Sort" STRUCT(
                        type VARCHAR,
                        "PrimaryField" STRUCT(FieldReference STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR))
                    )[]
                )
            )
        )',
        'RightTable': 'STRUCT(
            cascadeCreate BOOLEAN,
            cascadeDelete BOOLEAN,
            "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR),
            "SortSpecification" STRUCT(
                value BOOLEAN,
                "SortList" STRUCT(
                    "Sort" STRUCT(
                        type VARCHAR,
                        "PrimaryField" STRUCT(FieldReference STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR))
                    )[]
                )
            )
        )',
        'JoinPredicateList': 'STRUCT(
            "JoinPredicate" STRUCT(
                type VARCHAR,
                "LeftField" STRUCT(
                    FieldReference STRUCT(
                        id BIGINT, name VARCHAR, UUID VARCHAR,
                        "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)
                    )
                ),
                "RightField" STRUCT(
                    FieldReference STRUCT(
                        id BIGINT, name VARCHAR, UUID VARCHAR,
                        "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)
                    )
                )
            )[]
        )'
    }
)
-- list_transform hängt jedem Prädikat seinen 1-basierten Listenindex an, bevor
-- UNNEST die Liste in Zeilen auflöst → ein Mehrfeld-Join (membercount > 1) liefert
-- jetzt N Zeilen mit eindeutigem Predicate_Index statt einer (vgl. Schema-PK).
CROSS JOIN UNNEST(list_transform(JoinPredicateList.JoinPredicate, lambda jp, i: {idx: i, jp: jp})) AS t(pe)
CROSS JOIN filename_normalized fn
WHERE pe.jp.LeftField.FieldReference.UUID IS NOT NULL
  AND pe.jp.RightField.FieldReference.UUID IS NOT NULL
ON CONFLICT (Rel_ID, File_Name, Predicate_Index) DO UPDATE SET
    Left_TO_Name = EXCLUDED.Left_TO_Name,
    Left_TO_ID = EXCLUDED.Left_TO_ID,
    Left_TO_UUID = EXCLUDED.Left_TO_UUID,
    Left_Delete = EXCLUDED.Left_Delete,
    Left_Create = EXCLUDED.Left_Create,
    Right_TO_Name = EXCLUDED.Right_TO_Name,
    Right_TO_ID = EXCLUDED.Right_TO_ID,
    Right_TO_UUID = EXCLUDED.Right_TO_UUID,
    Right_Delete = EXCLUDED.Right_Delete,
    Right_Create = EXCLUDED.Right_Create,
    Operator = EXCLUDED.Operator,
    Left_Field_Name = EXCLUDED.Left_Field_Name,
    Left_Field_ID = EXCLUDED.Left_Field_ID,
    Left_Field_TO_Name = EXCLUDED.Left_Field_TO_Name,
    Left_Field_TO_UUID = EXCLUDED.Left_Field_TO_UUID,
    Right_Field_Name = EXCLUDED.Right_Field_Name,
    Right_Field_ID = EXCLUDED.Right_Field_ID,
    Right_Field_TO_Name = EXCLUDED.Right_Field_TO_Name,
    Right_Field_TO_UUID = EXCLUDED.Right_Field_TO_UUID,
    Left_Sort_Enabled = EXCLUDED.Left_Sort_Enabled,
    Left_Sort_Fields = EXCLUDED.Left_Sort_Fields,
    Left_Sort_Field_UUIDs = EXCLUDED.Left_Sort_Field_UUIDs,
    Right_Sort_Enabled = EXCLUDED.Right_Sort_Enabled,
    Right_Sort_Fields = EXCLUDED.Right_Sort_Fields,
    Right_Sort_Field_UUIDs = EXCLUDED.Right_Sort_Field_UUIDs;


-- FieldsForTables
CREATE TABLE IF NOT EXISTS FieldsForTables (
    Table_ID BIGINT,
    Table_Name VARCHAR,
    Table_UUID VARCHAR,
    Field_ID BIGINT,
    Field_Name VARCHAR,
    Field_Type VARCHAR,
    Data_Type VARCHAR,
    Field_Comment VARCHAR,
    Field_UUID VARCHAR,
    Is_Global BOOLEAN,
    Max_Repetitions INTEGER,
    DDR_Hash VARCHAR,  -- DDR-Hash für Calculated Fields (ab FM21+)
    Calculation_Text VARCHAR,  -- Klartext-Formel aus <Text> CDATA (vollständiger als ChunkList)
    -- AutoEnter-Basisattribute (alle Typen)
    AutoEnter_Type VARCHAR,              -- 'Looked_up', 'SerialNumber', 'Calculated', 'ConstantData', etc.
    AutoEnter_ProhibitMod BOOLEAN,       -- Benutzer darf überschreiben?
    -- Lookup-Details (nur für AutoEnter_Type = 'Looked_up')
    Lookup_Field_Name VARCHAR,           -- Name des Quellfeldes
    Lookup_Field_UUID VARCHAR,           -- UUID des Quellfeldes
    Lookup_TO_Name VARCHAR,              -- Name der Beziehungs-TO
    Lookup_TO_UUID VARCHAR,              -- UUID der Beziehungs-TO
    Lookup_DontCopyIfEmpty BOOLEAN,      -- Leerwerte nicht übernehmen?
    Lookup_NoMatchOption VARCHAR,        -- 'DoNotCopy' oder 'ConstantData'
    -- AutoEnter Calculated-Details (nur für AutoEnter_Type = 'Calculated')
    AE_Calc_Text VARCHAR,               -- Klartext-Formel (komplementär zu Calculation_Text)
    AE_Calc_Hash VARCHAR,               -- DDR-Hash (komplementär zu DDR_Hash)
    AE_Calc_OverwriteExisting BOOLEAN,  -- Vorhandene Werte überschreiben?
    AE_Calc_AlwaysEvaluate BOOLEAN,     -- Bei jeder Änderung neu berechnen?
    -- ConstantData (nur für AutoEnter_Type = 'ConstantData')
    AE_ConstantData VARCHAR,            -- Fester Standardwert
    File_Name VARCHAR,
    PRIMARY KEY (Field_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO FieldsForTables
SELECT
    BaseTableReference.id AS Table_ID,
    BaseTableReference.name AS Table_Name,
    BaseTableReference.UUID AS Table_UUID,
    f.id AS Field_ID,
    f.name AS Field_Name,
    f.fieldtype AS Field_Type,
    f.datatype AS Data_Type,
    f.comment AS Field_Comment,
    f.UUID."#text" AS Field_UUID,
    f.Storage.global AS Is_Global,
    f.Storage.maxRepetitions AS Max_Repetitions,
    f.Calculation.DDRREF.hash AS DDR_Hash,  -- DDR-Hash für Calculated Fields (ab FM21+)
    -- chr(127) -> chr(10): Preprocessing-Sentinel für CR zurück zu LF
    replace(f.Calculation.Text, chr(127), chr(10)) AS Calculation_Text,
    -- AutoEnter-Basisattribute
    CASE WHEN f.AutoEnter.type = '' THEN NULL ELSE f.AutoEnter.type END AS AutoEnter_Type,
    f.AutoEnter.prohibitModification AS AutoEnter_ProhibitMod,
    -- Lookup-Details
    f.AutoEnter.Looked_up.FieldReference.name AS Lookup_Field_Name,
    f.AutoEnter.Looked_up.FieldReference.UUID AS Lookup_Field_UUID,
    f.AutoEnter.Looked_up.FieldReference.TableOccurrenceReference.name AS Lookup_TO_Name,
    f.AutoEnter.Looked_up.FieldReference.TableOccurrenceReference.UUID AS Lookup_TO_UUID,
    f.AutoEnter.Looked_up.dontCopyIfEmpty AS Lookup_DontCopyIfEmpty,
    f.AutoEnter.Looked_up.noMatchCopyOption AS Lookup_NoMatchOption,
    -- AutoEnter Calculated-Details
    replace(f.AutoEnter.Calculated.Calculation.Text, chr(127), chr(10)) AS AE_Calc_Text,
    f.AutoEnter.Calculated.Calculation.DDRREF.hash AS AE_Calc_Hash,
    f.AutoEnter.overwriteExisting AS AE_Calc_OverwriteExisting,
    f.AutoEnter.alwaysEvaluate AS AE_Calc_AlwaysEvaluate,
    -- ConstantData
    f.AutoEnter.ConstantData AS AE_ConstantData,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='FieldsForTables',
    record_element='FieldCatalog',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'BaseTableReference': 'STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)',
        'ObjectList': 'STRUCT(
            "Field" STRUCT(
                "id" BIGINT,
                "name" VARCHAR,
                "fieldtype" VARCHAR,
                "datatype" VARCHAR,
                "comment" VARCHAR,
                "UUID" STRUCT("#text" VARCHAR),
                "Storage" STRUCT("global" BOOLEAN, "maxRepetitions" INTEGER),
                "Calculation" STRUCT("DDRREF" STRUCT("hash" VARCHAR), "Text" VARCHAR),
                "AutoEnter" STRUCT(
                    "type" VARCHAR,
                    "prohibitModification" BOOLEAN,
                    "overwriteExisting" BOOLEAN,
                    "alwaysEvaluate" BOOLEAN,
                    "ConstantData" VARCHAR,
                    "Looked_up" STRUCT(
                        "dontCopyIfEmpty" BOOLEAN,
                        "noMatchCopyOption" VARCHAR,
                        "FieldReference" STRUCT(
                            "id" BIGINT,
                            "name" VARCHAR,
                            "UUID" VARCHAR,
                            "TableOccurrenceReference" STRUCT(
                                "id" BIGINT,
                                "name" VARCHAR,
                                "UUID" VARCHAR
                            )
                        )
                    ),
                    "Calculated" STRUCT(
                        "Calculation" STRUCT(
                            "DDRREF" STRUCT("hash" VARCHAR),
                            "Text" VARCHAR
                        )
                    )
                )
            )[]
        )'
    }
)
CROSS JOIN UNNEST(ObjectList.Field) AS t(f)
CROSS JOIN filename_normalized fn
WHERE f.id IS NOT NULL
  AND f.UUID."#text" IS NOT NULL
ON CONFLICT (Field_UUID, File_Name) DO UPDATE SET
    Table_ID = EXCLUDED.Table_ID,
    Table_Name = EXCLUDED.Table_Name,
    Table_UUID = EXCLUDED.Table_UUID,
    Field_ID = EXCLUDED.Field_ID,
    Field_Name = EXCLUDED.Field_Name,
    Field_Type = EXCLUDED.Field_Type,
    Data_Type = EXCLUDED.Data_Type,
    Field_Comment = EXCLUDED.Field_Comment,
    Is_Global = EXCLUDED.Is_Global,
    Max_Repetitions = EXCLUDED.Max_Repetitions,
    DDR_Hash = EXCLUDED.DDR_Hash,
    Calculation_Text = EXCLUDED.Calculation_Text,
    AutoEnter_Type = EXCLUDED.AutoEnter_Type,
    AutoEnter_ProhibitMod = EXCLUDED.AutoEnter_ProhibitMod,
    Lookup_Field_Name = EXCLUDED.Lookup_Field_Name,
    Lookup_Field_UUID = EXCLUDED.Lookup_Field_UUID,
    Lookup_TO_Name = EXCLUDED.Lookup_TO_Name,
    Lookup_TO_UUID = EXCLUDED.Lookup_TO_UUID,
    Lookup_DontCopyIfEmpty = EXCLUDED.Lookup_DontCopyIfEmpty,
    Lookup_NoMatchOption = EXCLUDED.Lookup_NoMatchOption,
    AE_Calc_Text = EXCLUDED.AE_Calc_Text,
    AE_Calc_Hash = EXCLUDED.AE_Calc_Hash,
    AE_Calc_OverwriteExisting = EXCLUDED.AE_Calc_OverwriteExisting,
    AE_Calc_AlwaysEvaluate = EXCLUDED.AE_Calc_AlwaysEvaluate,
    AE_ConstantData = EXCLUDED.AE_ConstantData;


-- ValueListCatalog
CREATE TABLE IF NOT EXISTS ValueListCatalog (
    VL_ID BIGINT,
    VL_Name VARCHAR,
    Source_Type VARCHAR,
    VL_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (VL_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO ValueListCatalog
SELECT
    id AS VL_ID,
    name AS VL_Name,
    Source.value AS Source_Type,
    UUID."#text" AS VL_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='ValueListCatalog',
    record_element='ValueList',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'UUID': 'STRUCT("#text" VARCHAR, "modifications" BIGINT, "userName" VARCHAR, "accountName" VARCHAR, "timestamp" VARCHAR)',
        'Source': 'STRUCT(value VARCHAR)'
    }
)
CROSS JOIN filename_normalized fn
WHERE id IS NOT NULL
ON CONFLICT (VL_UUID, File_Name) DO UPDATE SET
    VL_ID = EXCLUDED.VL_ID,
    VL_Name = EXCLUDED.VL_Name,
    Source_Type = EXCLUDED.Source_Type;


-- OptionsForValueLists (Details und Werte)
CREATE TABLE IF NOT EXISTS OptionsForValueLists (
    VL_ID BIGINT,
    VL_Name VARCHAR,
    VL_UUID VARCHAR,
    Source_Type VARCHAR,
    Custom_Values VARCHAR[],
    Field_ID BIGINT,
    Field_Name VARCHAR,
    Field_UUID VARCHAR,
    TO_ID BIGINT,
    TO_Name VARCHAR,
    TO_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (VL_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO OptionsForValueLists
SELECT
    ValueListReference.id AS VL_ID,
    ValueListReference.name AS VL_Name,
    ValueListReference.UUID AS VL_UUID,
    Source.value AS Source_Type,
    [v."#text" for v in CustomValues.Text] AS Custom_Values,
    Source.FieldReference.id AS Field_ID,
    Source.FieldReference.name AS Field_Name,
    Source.FieldReference.UUID AS Field_UUID,
    Source.FieldReference.TableOccurrenceReference.id AS TO_ID,
    Source.FieldReference.TableOccurrenceReference.name AS TO_Name,
    Source.FieldReference.TableOccurrenceReference.UUID AS TO_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='OptionsForValueLists',
    record_element='ValueList',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'ValueListReference': 'STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)',
        'Source': 'STRUCT(
            value VARCHAR,
            "FieldReference" STRUCT(
                id BIGINT,
                name VARCHAR,
                UUID VARCHAR,
                "TableOccurrenceReference" STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)
            )
        )',
        'CustomValues': 'STRUCT("Text" STRUCT("#text" VARCHAR)[])'
    }
)
CROSS JOIN filename_normalized fn
WHERE ValueListReference.id IS NOT NULL
ON CONFLICT (VL_UUID, File_Name) DO UPDATE SET
    VL_ID = EXCLUDED.VL_ID,
    VL_Name = EXCLUDED.VL_Name,
    Source_Type = EXCLUDED.Source_Type,
    Custom_Values = EXCLUDED.Custom_Values,
    Field_ID = EXCLUDED.Field_ID,
    Field_Name = EXCLUDED.Field_Name,
    Field_UUID = EXCLUDED.Field_UUID,
    TO_ID = EXCLUDED.TO_ID,
    TO_Name = EXCLUDED.TO_Name,
    TO_UUID = EXCLUDED.TO_UUID;


-- CustomFunctionsCatalog
CREATE TABLE IF NOT EXISTS CustomFunctionsCatalog (
    CF_ID BIGINT,
    CF_Name VARCHAR,
    CF_Display VARCHAR,
    CF_UUID VARCHAR,
    Parameters VARCHAR[],
    DDR_Hash VARCHAR,  -- DDR-Hash für Custom Functions (ab FM21+)
    File_Name VARCHAR,
    PRIMARY KEY (CF_UUID, File_Name)
);

-- Ein einziger Parse des CustomFunctionsCatalog-Zweigs, einmal materialisiert und
-- unten doppelt genutzt: für den Katalog UND (ab SaXML v2.3.0.0 / FM 26+) für die
-- eingebetteten Formelkörper. So kostet der Embedded-Pfad keinen zusätzlichen XML-Parse.
-- Die Spalte `Calculation` ist NULL für SaXML ≤ v2.2.x (FM ≤ 22) — dort liegen die
-- Formeln in einer separaten Top-Level-Sektion <CalcsForCustomFunctions> (weiter unten).
CREATE OR REPLACE TEMP TABLE _cf_catalog_raw AS
SELECT
    id AS CF_ID,
    name AS CF_Name,
    Display AS CF_Display,
    UUID->>'#text' AS CF_UUID,
    [p.name for p in ObjectList.Parameter] AS Parameters,
    Calculation,
    getvariable('fm_file') AS File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='CustomFunctionsCatalog',
    record_element='CustomFunction',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'id': 'BIGINT',
        'name': 'VARCHAR',
        'Display': 'VARCHAR',
        'UUID': 'STRUCT("#text" VARCHAR, "modifications" BIGINT, "userName" VARCHAR, "timestamp" VARCHAR)',
        'ObjectList': 'STRUCT(Parameter STRUCT(name VARCHAR)[])',
        'Calculation': 'STRUCT("Text" VARCHAR, "DDRREF" STRUCT("kind" VARCHAR, "hash" VARCHAR, "#text" VARCHAR))'
    }
);

INSERT INTO CustomFunctionsCatalog
SELECT
    CF_ID,
    CF_Name,
    CF_Display,
    CF_UUID,
    Parameters,
    NULL AS DDR_Hash,  -- Wird später von CalcsForCustomFunctions aktualisiert
    File_Name
FROM _cf_catalog_raw
ON CONFLICT (CF_UUID, File_Name) DO UPDATE SET
    CF_ID = EXCLUDED.CF_ID,
    CF_Name = EXCLUDED.CF_Name,
    CF_Display = EXCLUDED.CF_Display,
    Parameters = EXCLUDED.Parameters,
    DDR_Hash = EXCLUDED.DDR_Hash;


-- CalcsForCustomFunctions
CREATE TABLE IF NOT EXISTS CalcsForCustomFunctions (
    CF_ID BIGINT,
    CF_Name VARCHAR,
    CF_UUID VARCHAR,
    Calculation_Code VARCHAR,
    Code_Chunks STRUCT(type VARCHAR, content VARCHAR)[],
    DDR_Hash VARCHAR,
    DDR_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (CF_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO CalcsForCustomFunctions
SELECT
    CustomFunctionReference.id AS CF_ID,
    CustomFunctionReference.name AS CF_Name,
    CustomFunctionReference.UUID AS CF_UUID,
    replace(Calculation.Text, chr(127), chr(10)) AS Calculation_Code,
    [ {'type': c.type, 'content': c."#text"} for c in Calculation.ChunkList.Chunk ] AS Code_Chunks,
    Calculation.DDRREF.hash AS DDR_Hash,
    regexp_replace(
        Calculation.DDRREF."#text",
        '^_',
        ''
    ) AS DDR_UUID,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='CalcsForCustomFunctions',
    record_element='CustomFunctionCalc',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'CustomFunctionReference': 'STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)',
        'Calculation': 'STRUCT(
            "Text" VARCHAR,
            "ChunkList" STRUCT(
                "Chunk" STRUCT(type VARCHAR, "#text" VARCHAR)[]
            ),
            "DDRREF" STRUCT(
                "kind" VARCHAR,
                "hash" VARCHAR,
                "#text" VARCHAR
            )
        )'
    }
)
CROSS JOIN filename_normalized fn
ON CONFLICT (CF_UUID, File_Name) DO UPDATE SET
    CF_ID = EXCLUDED.CF_ID,
    CF_Name = EXCLUDED.CF_Name,
    Calculation_Code = EXCLUDED.Calculation_Code,
    Code_Chunks = EXCLUDED.Code_Chunks,
    DDR_Hash = EXCLUDED.DDR_Hash,
    DDR_UUID = EXCLUDED.DDR_UUID;


-- Embedded-Pfad SaXML v2.3.0.0 (FM 26+): <Calculation> ist direkt in jedes
-- <CustomFunction> eingebettet; die separate <CalcsForCustomFunctions>-Sektion entfällt.
-- Quelle ist das oben bereits geparste _cf_catalog_raw → KEIN zusätzlicher XML-Parse.
-- Code_Chunks = NULL: das eingebettete <Calculation> trägt keine <ChunkList> (verifiziert
-- an xml-test/v26/Ooe.xml) — die Chunks bleiben über DDR_Hash → DDR_Calculations erreichbar.
-- ON CONFLICT DO NOTHING: trägt eine Datei je beide Formen, gewinnt der Legacy-Pfad oben
-- (kein Datenverlust). Bei FM ≤ 22 ist Calculation NULL → 0 Zeilen, also ein No-Op.
INSERT INTO CalcsForCustomFunctions
SELECT
    CF_ID,
    CF_Name,
    CF_UUID,
    replace(Calculation.Text, chr(127), chr(10)) AS Calculation_Code,
    NULL::STRUCT(type VARCHAR, content VARCHAR)[] AS Code_Chunks,
    Calculation.DDRREF.hash AS DDR_Hash,
    regexp_replace(Calculation.DDRREF."#text", '^_', '') AS DDR_UUID,
    File_Name
FROM _cf_catalog_raw
WHERE Calculation IS NOT NULL AND Calculation.Text IS NOT NULL
ON CONFLICT (CF_UUID, File_Name) DO NOTHING;


-- Update CustomFunctionsCatalog with DDR_Hash from CalcsForCustomFunctions
UPDATE CustomFunctionsCatalog cf
SET DDR_Hash = calc.DDR_Hash
FROM CalcsForCustomFunctions calc
WHERE cf.CF_UUID = calc.CF_UUID
  AND cf.File_Name = calc.File_Name
  AND calc.DDR_Hash IS NOT NULL;


-- ScriptCatalog
-- Sequence_ID: laufende Nummer in der XML-Reihenfolge (kritisch für Folder-Hierarchie!).
-- Script_ID ist NICHT die UI-Reihenfolge — FileMaker numeriert Scripts sequentiell beim
-- Anlegen, nicht beim Ordnen. Für korrekte Stack-Berechnung der Folder muss die echte
-- XML-Reihenfolge erhalten bleiben.
CREATE TABLE IF NOT EXISTS ScriptCatalog (
    Script_ID BIGINT,
    Script_Name VARCHAR,
    Folder_Type VARCHAR,
    Is_Separator BOOLEAN,
    Script_UUID VARCHAR,
    Modifications BIGINT,
    Last_Modified_By VARCHAR,
    Last_Modified_At VARCHAR,
    Option_Bitmask INTEGER,
    Is_Hidden BOOLEAN,
    Full_Access BOOLEAN,
    Sequence_ID BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (Script_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
script_records AS (
    -- Pro Datei: ROW_NUMBER() in der read_xml-Reihenfolge (= XML-Reihenfolge).
    SELECT
        ROW_NUMBER() OVER () + getvariable('seq_offset')::BIGINT AS Sequence_ID,
        id, name, isFolder, isSeparatorItem, UUID, Options
    FROM read_xml(
        getvariable('fm_xml'),
        root_element='ScriptCatalog',
        record_element='Script',
        max_depth=10,
        maximum_file_size=getvariable('dom_threshold'),
        streaming=getvariable('use_streaming'),
        columns={
            'id': 'BIGINT',
            'name': 'VARCHAR',
            'isFolder': 'VARCHAR',
            'isSeparatorItem': 'BOOLEAN',
            'UUID': 'STRUCT("#text" VARCHAR, modifications BIGINT, userName VARCHAR, accountName VARCHAR, timestamp VARCHAR)',
            'Options': 'STRUCT("#text" INTEGER, hidden BOOLEAN, access VARCHAR, SiriShortcutVisible BOOLEAN, runwithfullaccess BOOLEAN, compatibility INTEGER)'
        }
    )
    WHERE id IS NOT NULL
)
INSERT INTO ScriptCatalog
SELECT
    sr.id AS Script_ID,
    xml_unescape(sr.name) AS Script_Name,
    sr.isFolder AS Folder_Type,
    COALESCE(sr.isSeparatorItem, False) AS Is_Separator,
    sr.UUID."#text" AS Script_UUID,
    sr.UUID.modifications AS Modifications,
    sr.UUID.userName AS Last_Modified_By,
    sr.UUID.timestamp AS Last_Modified_At,
    sr.Options."#text" AS Option_Bitmask,
    sr.Options.hidden AS Is_Hidden,
    sr.Options.runwithfullaccess AS Full_Access,
    sr.Sequence_ID,
    fn.File_Name as File_Name
FROM script_records sr
CROSS JOIN filename_normalized fn
ON CONFLICT (Script_UUID, File_Name) DO UPDATE SET
    Script_ID = EXCLUDED.Script_ID,
    Script_Name = EXCLUDED.Script_Name,
    Folder_Type = EXCLUDED.Folder_Type,
    Is_Separator = EXCLUDED.Is_Separator,
    Modifications = EXCLUDED.Modifications,
    Last_Modified_By = EXCLUDED.Last_Modified_By,
    Last_Modified_At = EXCLUDED.Last_Modified_At,
    Option_Bitmask = EXCLUDED.Option_Bitmask,
    Is_Hidden = EXCLUDED.Is_Hidden,
    Full_Access = EXCLUDED.Full_Access,
    Sequence_ID = EXCLUDED.Sequence_ID;


-- StepsForScripts
CREATE TABLE IF NOT EXISTS StepsForScripts (
    Script_ID BIGINT,
    Script_Name VARCHAR,
    Script_UUID VARCHAR,
    Step_Index INTEGER,
    Step_ID INTEGER,
    Step_Name VARCHAR,
    Is_Enabled BOOLEAN,
    Step_UUID VARCHAR,
    DDR_Hash VARCHAR,
    DDR_UUID VARCHAR,
    Parameters_XML VARCHAR,
    Step_XML VARCHAR,
    Parameter_Type VARCHAR,
    Variable_Name VARCHAR,
    Calculation_Text VARCHAR,
    Boolean_Type VARCHAR,
    Boolean_Value VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Step_UUID, File_Name)
);

-- Step_XML: vollständiges <Step>-Element (project/plan_xml_diff.md §12.3-Fallback).
-- Parameters_XML deckt nur /Step/ParameterValues ab; manche Step-Typen (z.B.
-- "Unknown external script step from missing plug-in") legen Referenzen AUSSERHALB
-- von ParameterValues ab. Phase 2 (XMLStepReferences) liest daher aus Step_XML.
-- ADD COLUMN für inkrementelle DBs ohne Force-Rebuild.
ALTER TABLE StepsForScripts ADD COLUMN IF NOT EXISTS Step_XML VARCHAR;

-- @STREAMIFY_BLOCK:stepsforscripts@
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_scripts AS (
    SELECT
        unnest(xml_extract_elements(xml, '//StepsForScripts/Script')) as script_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
-- Performance (B-1, project/plan_xml_performance.md §3): Script-Level-Felder
-- EINMAL pro Script auflösen, BEVOR die Steps unnested werden. Stehen scalar-
-- xml_extract auf dem großen script_xml-Fragment im SELBEN SELECT wie unnest(),
-- wertet DuckDB sie pro expandierter Step-Zeile aus (O(steps × script_größe)) und
-- re-parst script_xml je Step. Eigene CTE-Ebene davor → ~48× schneller, bit-
-- identische Ausgabe (verifiziert: Zeilenzahl + Content-Hash).
scripts_resolved AS (
    SELECT
        xml_extract_text(script_xml, '/Script/ScriptReference/@id')[1]::BIGINT as Script_ID,
        xml_extract_text(script_xml, '/Script/ScriptReference/@name')[1] as Script_Name,
        xml_extract_text(script_xml, '/Script/ScriptReference/@UUID')[1] as Script_UUID,
        script_xml
    FROM raw_scripts
),
script_steps AS (
    SELECT
        Script_ID,
        Script_Name,
        Script_UUID,
        unnest(xml_extract_elements(script_xml, '/Script/ObjectList/Step')) as step_xml
    FROM scripts_resolved
)
INSERT INTO StepsForScripts
SELECT
    Script_ID,
    Script_Name,
    Script_UUID,
    xml_extract_text(step_xml, '/Step/@index')[1]::INTEGER as Step_Index,
    xml_extract_text(step_xml, '/Step/@id')[1]::INTEGER as Step_ID,
    xml_extract_text(step_xml, '/Step/@name')[1] as Step_Name,
    xml_extract_text(step_xml, '/Step/@enable')[1] = 'True' as Is_Enabled,
    xml_extract_text(step_xml, '/Step/UUID')[1] as Step_UUID,
    xml_extract_text(step_xml, '/Step/DDRREF[@kind="StepText"]/@hash')[1] as DDR_Hash,
    regexp_replace(
        xml_extract_text(step_xml, '/Step/DDRREF[@kind="StepText"]')[1],
        '^_',
        ''
    ) as DDR_UUID,
    xml_extract_elements(step_xml, '/Step/ParameterValues')[1]::VARCHAR as Parameters_XML,
    step_xml::VARCHAR as Step_XML,
    xml_extract_text(step_xml, '//Parameter/@type')[1] as Parameter_Type,
    xml_extract_text(step_xml, '//Parameter[@type="Variable"]/Name/@value')[1] as Variable_Name,
    replace(xml_extract_text(step_xml, '//Calculation/Text')[1], chr(127), chr(10)) as Calculation_Text,
    xml_extract_text(step_xml, '//Boolean/@type')[1] as Boolean_Type,
    xml_extract_text(step_xml, '//Boolean/@value')[1] as Boolean_Value,
    fn.File_Name as File_Name
FROM script_steps
CROSS JOIN filename_normalized fn
ON CONFLICT (Step_UUID, File_Name) DO UPDATE SET
    Script_ID = EXCLUDED.Script_ID,
    Script_Name = EXCLUDED.Script_Name,
    Script_UUID = EXCLUDED.Script_UUID,
    Step_Index = EXCLUDED.Step_Index,
    Step_ID = EXCLUDED.Step_ID,
    Step_Name = EXCLUDED.Step_Name,
    Is_Enabled = EXCLUDED.Is_Enabled,
    DDR_Hash = EXCLUDED.DDR_Hash,
    DDR_UUID = EXCLUDED.DDR_UUID,
    Parameters_XML = EXCLUDED.Parameters_XML,
    Step_XML = EXCLUDED.Step_XML,
    Parameter_Type = EXCLUDED.Parameter_Type,
    Variable_Name = EXCLUDED.Variable_Name,
    Calculation_Text = EXCLUDED.Calculation_Text,
    Boolean_Type = EXCLUDED.Boolean_Type,
    Boolean_Value = EXCLUDED.Boolean_Value;
-- @END_STREAMIFY_BLOCK@




-- Layouts
-- Folder_Type / Is_Separator analog zu ScriptCatalog: Layouts können im
-- "Manage Layouts"-Dialog Ordner und Trennlinien enthalten (isFolder="True"/"Marker").
-- Sequence_ID: laufende Nummer in der XML-Reihenfolge (siehe Hinweis bei ScriptCatalog).
CREATE TABLE IF NOT EXISTS Layouts (
    L_ID BIGINT,
    L_Name VARCHAR,
    L_UUID VARCHAR,
    L_TO_Name VARCHAR,
    Folder_Type VARCHAR,
    Is_Separator BOOLEAN,
    Sequence_ID BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (L_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
layout_records AS (
    SELECT
        ROW_NUMBER() OVER () + getvariable('seq_offset')::BIGINT AS Sequence_ID,
        id, name, isFolder, isSeparatorItem, UUID, TableOccurrenceReference
    FROM read_xml(
        getvariable('fm_xml'),
        root_element='LayoutCatalog',
        record_element='Layout',
        maximum_file_size=getvariable('dom_threshold'),
        streaming=getvariable('use_streaming'),
        columns={
            'id': 'BIGINT',
            'name': 'VARCHAR',
            'isFolder': 'VARCHAR',
            'isSeparatorItem': 'BOOLEAN',
            'UUID': 'STRUCT("#text" VARCHAR)',
            'TableOccurrenceReference': 'STRUCT(name VARCHAR)'
        }
    )
    -- Folder-Records (isFolder='True'/'Marker') haben keine TableOccurrenceReference;
    -- daher nur auf id filtern, sonst werden Ordner und Trennlinien ausgeschlossen.
    WHERE id IS NOT NULL
)
INSERT INTO Layouts
SELECT
    lr.id AS L_ID,
    xml_unescape(lr.name) AS L_Name,
    lr.UUID."#text" AS L_UUID,
    lr.TableOccurrenceReference.name AS L_TO_Name,
    lr.isFolder AS Folder_Type,
    COALESCE(lr.isSeparatorItem, False) AS Is_Separator,
    lr.Sequence_ID,
    fn.File_Name as File_Name
FROM layout_records lr
CROSS JOIN filename_normalized fn
ON CONFLICT (L_UUID, File_Name) DO UPDATE SET
    L_ID = EXCLUDED.L_ID,
    L_Name = EXCLUDED.L_Name,
    L_TO_Name = EXCLUDED.L_TO_Name,
    Folder_Type = EXCLUDED.Folder_Type,
    Is_Separator = EXCLUDED.Is_Separator,
    Sequence_ID = EXCLUDED.Sequence_ID;


-- LayoutParts
CREATE TABLE IF NOT EXISTS LayoutParts (
    Layout_ID BIGINT,
    Layout_Name VARCHAR,
    Part_Type VARCHAR,
    Part_Kind INTEGER,
    Definition_Type VARCHAR,
    Definition_Kind INTEGER,
    Part_Size INTEGER,
    Part_Absolute INTEGER,
    Part_Options INTEGER,
    Object_Count BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (Layout_ID, Part_Kind, File_Name)
);

-- @STREAMIFY_BLOCK:layoutparts@
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_layouts AS (
    SELECT
        unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
-- Performance (B-2, project/plan_xml_performance.md §3): Layout-Level-Felder
-- EINMAL pro Layout auflösen, BEVOR die Parts unnested werden (Anti-Pattern wie
-- B-1: scalar-xml_extract auf layout_xml im selben SELECT wie unnest() → pro Part
-- re-evaluiert). Eigene CTE-Ebene davor.
layouts_resolved AS (
    SELECT
        xml_extract_text(layout_xml, '/Layout/@id')[1]::BIGINT as Layout_ID,
        xml_extract_text(layout_xml, '/Layout/@name')[1] as Layout_Name,
        layout_xml
    FROM raw_layouts
    WHERE xml_extract_text(layout_xml, '/Layout/@id')[1] IS NOT NULL
),
layout_parts AS (
    SELECT
        Layout_ID,
        Layout_Name,
        unnest(xml_extract_elements(layout_xml, '/Layout/PartsList/Part')) as part_xml
    FROM layouts_resolved
)
INSERT INTO LayoutParts
SELECT
    Layout_ID,
    Layout_Name,
    xml_extract_text(part_xml, '/Part/@type')[1] as Part_Type,
    xml_extract_text(part_xml, '/Part/@kind')[1]::INTEGER as Part_Kind,
    xml_extract_text(part_xml, '/Part/Definition/@type')[1] as Definition_Type,
    xml_extract_text(part_xml, '/Part/Definition/@kind')[1]::INTEGER as Definition_Kind,
    xml_extract_text(part_xml, '/Part/Definition/@size')[1]::INTEGER as Part_Size,
    xml_extract_text(part_xml, '/Part/Definition/@absolute')[1]::INTEGER as Part_Absolute,
    xml_extract_text(part_xml, '/Part/Definition/@Options')[1]::INTEGER as Part_Options,
    list_count(xml_extract_elements(part_xml, '/Part/ObjectList/LayoutObject')) as Object_Count,
    fn.File_Name as File_Name
FROM layout_parts
CROSS JOIN filename_normalized fn
ON CONFLICT (Layout_ID, Part_Kind, File_Name) DO UPDATE SET
    Layout_Name = EXCLUDED.Layout_Name,
    Part_Type = EXCLUDED.Part_Type,
    Definition_Type = EXCLUDED.Definition_Type,
    Definition_Kind = EXCLUDED.Definition_Kind,
    Part_Size = EXCLUDED.Part_Size,
    Part_Absolute = EXCLUDED.Part_Absolute,
    Part_Options = EXCLUDED.Part_Options,
    Object_Count = EXCLUDED.Object_Count;
-- @END_STREAMIFY_BLOCK@


-- ========================================
-- LayoutObjects
-- ========================================
-- Alle Layout-Objekte mit rekursiver Verschachtelung
-- (Portal, Group, Tab Control, Panel, Container, etc.)
--
-- Verwendet WITH RECURSIVE für verschachtelte Objekte:
-- - Level 0: Root-Objekte direkt in Parts
-- - Level 1+: Verschachtelte Objekte in Portals, Groups, Tab Controls, etc.
-- ========================================

CREATE TABLE IF NOT EXISTS LayoutObjects (
    Layout_ID BIGINT,
    Part_Type VARCHAR,
    Object_ID BIGINT,
    Object_Type VARCHAR,
    Object_Name VARCHAR,
    Object_Kind INTEGER,
    Object_Hash VARCHAR,
    Object_UUID VARCHAR,
    Bounds_Top INTEGER,
    Bounds_Left INTEGER,
    Bounds_Bottom INTEGER,
    Bounds_Right INTEGER,
    Parent_Object_ID BIGINT,
    Nesting_Level INTEGER,
    Z_Order INTEGER,
    Hide_Calculation_Text VARCHAR,
    Tooltip_Calculation_Text VARCHAR,
    Label_Calculation_Text VARCHAR,
    ScriptTrigger_Parameter_Text VARCHAR,
    Text_Content VARCHAR,
    Object_XML VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Object_UUID, File_Name)
);

-- @STREAMIFY_BLOCK:layoutobjects@
WITH RECURSIVE filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_layouts AS (
    SELECT
        unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
-- Performance (B-2, project/plan_xml_performance.md §3): Layout- und Part-Level-
-- Felder jeweils EINMAL auflösen, BEVOR genested wird (Anti-Pattern wie B-1).
-- layout_xml bzw. part_xml sind große Fragmente; scalar-xml_extract im selben
-- SELECT wie das unnest würde pro Part bzw. pro Objekt re-evaluiert.
layouts_resolved AS (
    SELECT
        xml_extract_text(layout_xml, '/Layout/@id')[1]::BIGINT as Layout_ID,
        xml_extract_text(layout_xml, '/Layout/@name')[1] as Layout_Name,
        xml_extract_text(layout_xml, '/Layout/UUID/@*')[1] as Layout_UUID,
        layout_xml
    FROM raw_layouts
),
layout_parts AS (
    SELECT
        Layout_ID,
        Layout_Name,
        Layout_UUID,
        unnest(xml_extract_elements(layout_xml, '/Layout/PartsList/Part')) as part_xml
    FROM layouts_resolved
),
parts_resolved AS (
    SELECT
        Layout_ID,
        xml_extract_text(part_xml, '/Part/@type')[1] as Part_Type,
        part_xml
    FROM layout_parts
),
root_objects AS (
    SELECT
        Layout_ID,
        Part_Type,
        xml_extract_text(object_xml, '/LayoutObject/@id')[1]::BIGINT as Object_ID,
        xml_extract_text(object_xml, '/LayoutObject/@type')[1] as Object_Type,
        xml_extract_text(object_xml, '/LayoutObject/@name')[1] as Object_Name,
        xml_extract_text(object_xml, '/LayoutObject/@kind')[1]::INTEGER as Object_Kind,
        xml_extract_text(object_xml, '/LayoutObject/@hash')[1] as Object_Hash,
        xml_extract_text(object_xml, '/LayoutObject/UUID')[1] as Object_UUID,
        xml_extract_text(object_xml, '/LayoutObject/Bounds/@top')[1]::INTEGER as Bounds_Top,
        xml_extract_text(object_xml, '/LayoutObject/Bounds/@left')[1]::INTEGER as Bounds_Left,
        xml_extract_text(object_xml, '/LayoutObject/Bounds/@bottom')[1]::INTEGER as Bounds_Bottom,
        xml_extract_text(object_xml, '/LayoutObject/Bounds/@right')[1]::INTEGER as Bounds_Right,
        NULL::BIGINT as Parent_Object_ID,
        0 as Nesting_Level,
        t.z_order::INTEGER as Z_Order,
        -- Calculation Text Extraction (CDATA aus XML)
        xml_extract_text(object_xml, '/LayoutObject/Conditions/Hide/Calculation/Text')[1] as Hide_Calculation_Text,
        xml_extract_text(object_xml, '/LayoutObject/Tooltip/Calculation/Text')[1] as Tooltip_Calculation_Text,
        COALESCE(
            xml_extract_text(object_xml, '/LayoutObject/Button/Label/Calculation/Text')[1],
            xml_extract_text(object_xml, '/LayoutObject/GroupedButton/Label/Calculation/Text')[1],
            xml_extract_text(object_xml, '/LayoutObject/PopoverButton/Label/Calculation/Text')[1]
        ) as Label_Calculation_Text,
        array_to_string(
            xml_extract_text(object_xml, '/LayoutObject/ScriptTriggers/ScriptTrigger/ScriptReference/Calculation/Text'),
            E'\n'
        ) as ScriptTrigger_Parameter_Text,
        xml_extract_text(object_xml, '/LayoutObject/Text/StyledText/Data')[1] as Text_Content,
        object_xml
    FROM parts_resolved
    CROSS JOIN LATERAL unnest(
        xml_extract_elements(part_xml, '/Part/ObjectList/LayoutObject')
    ) WITH ORDINALITY AS t(object_xml, z_order)
),
nested_objects AS (
    SELECT
        Layout_ID,
        Part_Type,
        Object_ID,
        Object_Type,
        Object_Name,
        Object_Kind,
        Object_Hash,
        Object_UUID,
        Bounds_Top,
        Bounds_Left,
        Bounds_Bottom,
        Bounds_Right,
        Parent_Object_ID,
        Nesting_Level,
        Z_Order,
        Hide_Calculation_Text,
        Tooltip_Calculation_Text,
        Label_Calculation_Text,
        ScriptTrigger_Parameter_Text,
        Text_Content,
        object_xml
    FROM root_objects

    UNION ALL

    SELECT
        parent.Layout_ID,
        parent.Part_Type,
        xml_extract_text(child_xml, '/LayoutObject/@id')[1]::BIGINT as Object_ID,
        xml_extract_text(child_xml, '/LayoutObject/@type')[1] as Object_Type,
        xml_extract_text(child_xml, '/LayoutObject/@name')[1] as Object_Name,
        xml_extract_text(child_xml, '/LayoutObject/@kind')[1]::INTEGER as Object_Kind,
        xml_extract_text(child_xml, '/LayoutObject/@hash')[1] as Object_Hash,
        xml_extract_text(child_xml, '/LayoutObject/UUID')[1] as Object_UUID,
        xml_extract_text(child_xml, '/LayoutObject/Bounds/@top')[1]::INTEGER as Bounds_Top,
        xml_extract_text(child_xml, '/LayoutObject/Bounds/@left')[1]::INTEGER as Bounds_Left,
        xml_extract_text(child_xml, '/LayoutObject/Bounds/@bottom')[1]::INTEGER as Bounds_Bottom,
        xml_extract_text(child_xml, '/LayoutObject/Bounds/@right')[1]::INTEGER as Bounds_Right,
        parent.Object_ID as Parent_Object_ID,
        parent.Nesting_Level + 1 as Nesting_Level,
        t.z_order::INTEGER as Z_Order,
        -- Calculation Text Extraction (CDATA aus XML)
        xml_extract_text(child_xml, '/LayoutObject/Conditions/Hide/Calculation/Text')[1] as Hide_Calculation_Text,
        xml_extract_text(child_xml, '/LayoutObject/Tooltip/Calculation/Text')[1] as Tooltip_Calculation_Text,
        COALESCE(
            xml_extract_text(child_xml, '/LayoutObject/Button/Label/Calculation/Text')[1],
            xml_extract_text(child_xml, '/LayoutObject/GroupedButton/Label/Calculation/Text')[1],
            xml_extract_text(child_xml, '/LayoutObject/PopoverButton/Label/Calculation/Text')[1]
        ) as Label_Calculation_Text,
        array_to_string(
            xml_extract_text(child_xml, '/LayoutObject/ScriptTriggers/ScriptTrigger/ScriptReference/Calculation/Text'),
            E'\n'
        ) as ScriptTrigger_Parameter_Text,
        -- PopoverPanel-Titel (Feldreferenzen, §3.3) per Title/Text-Fallback
        -- mitführen; reguläre Objekte haben nur StyledText/Data.
        COALESCE(
            xml_extract_text(child_xml, '/LayoutObject/Text/StyledText/Data')[1],
            xml_extract_text(child_xml, '/LayoutObject/Title/Text')[1]
        ) as Text_Content,
        child_xml as object_xml
    FROM nested_objects parent
    CROSS JOIN LATERAL unnest(
        -- Achsen-Wahl pro Parent-Typ (ein einziger rekursiver Term, da
        -- WITH RECURSIVE nur einen rekursiven Term erlaubt):
        --   * 'Popover Button': exakter Kind-Pfad zum PopoverPanel, das
        --     direktes Kind von <PopoverButton> ist (NICHT unter <ObjectList>).
        --     Damit wird das Panel als eigene Zeile emittiert (Parent = Button,
        --     Nesting +1). Der Button greift bewusst NICHT die Descendant-Achse,
        --     sonst würde der Panel-Inhalt eine Ebene zu hoch direkt am Button
        --     hängen (§2.3).
        --   * alle anderen Container: unveränderte Descendant-Achse
        --     '//ObjectList/LayoutObject'. Das emittierte PopoverPanel ist
        --     selbst Whitelist-Parent und nimmt hierüber seine ObjectList-
        --     Inhalte als direkte Kinder auf -> korrektes Re-Parenting.
        CASE
            WHEN parent.Object_Type = 'Popover Button'
                THEN xml_extract_elements(parent.object_xml, '/LayoutObject/PopoverButton/LayoutObject')
            ELSE xml_extract_elements(parent.object_xml, '//ObjectList/LayoutObject')
        END
    ) WITH ORDINALITY AS t(child_xml, z_order)
    WHERE parent.Object_Type IN (
        'Portal',
        'Group',
        'Tab Control',
        'Panel',
        'Container',
        'Button Bar',
        'Slide Control',
        'Grouped Button',
        'PopoverPanel',
        'Popover Button'
    )
)
INSERT INTO LayoutObjects
SELECT
    Layout_ID,
    Part_Type,
    Object_ID,
    Object_Type,
    Object_Name,
    Object_Kind,
    Object_Hash,
    Object_UUID,
    Bounds_Top,
    Bounds_Left,
    Bounds_Bottom,
    Bounds_Right,
    Parent_Object_ID,
    Nesting_Level,
    Z_Order,
    -- chr(127) -> chr(10): Preprocessing-Sentinel für CR zurück zu LF
    replace(Hide_Calculation_Text, chr(127), chr(10)) as Hide_Calculation_Text,
    replace(Tooltip_Calculation_Text, chr(127), chr(10)) as Tooltip_Calculation_Text,
    replace(Label_Calculation_Text, chr(127), chr(10)) as Label_Calculation_Text,
    replace(ScriptTrigger_Parameter_Text, chr(127), chr(10)) as ScriptTrigger_Parameter_Text,
    replace(Text_Content, chr(127), chr(10)) as Text_Content,
    object_xml::VARCHAR as Object_XML,
    fn.File_Name as File_Name
-- DETERMINISTISCHES DEDUP (Chunk-Invarianz, plan_xml_diff_streaming_optimization.md
-- These 1b): Die Descendant-Achse '//ObjectList/LayoutObject' im rekursiven Term
-- emittiert tief verschachtelte Objekte MEHRFACH (einmal pro Container-Vorfahre, je
-- mit anderem Nesting_Level/Parent). Das ON-CONFLICT-„last writer" war reihenfolge-
-- abhängig und damit chunk-zusammensetzungs-sensitiv (Sub-Chunking eines Layout-
-- Katalogs verschob 51 Objekte um +1). Wir wählen pro (Layout_ID, Object_UUID)
-- deterministisch die FLACHSTE Emission (min Nesting_Level) — reproduziert das bisher
-- de-facto-stabile Verhalten (rekursiver CTE emittiert level-aufsteigend) und ist
-- jetzt reihenfolge-/chunk-invariant. NULL-UUID-Objekte (kein Conflict-Key) bleiben
-- alle erhalten (sie werden nie per UPSERT zusammengeführt).
FROM (
    SELECT *,
        ROW_NUMBER() OVER (PARTITION BY Layout_ID, Object_UUID
                           ORDER BY Nesting_Level ASC, Parent_Object_ID NULLS FIRST, Z_Order DESC) AS _dedup_rn
    FROM nested_objects
) nested_objects
CROSS JOIN filename_normalized fn
WHERE Object_UUID IS NULL OR _dedup_rn = 1
ON CONFLICT (Object_UUID, File_Name) DO UPDATE SET
    Layout_ID = EXCLUDED.Layout_ID,
    Part_Type = EXCLUDED.Part_Type,
    Object_ID = EXCLUDED.Object_ID,
    Object_Type = EXCLUDED.Object_Type,
    Object_Name = EXCLUDED.Object_Name,
    Object_Kind = EXCLUDED.Object_Kind,
    Object_Hash = EXCLUDED.Object_Hash,
    Bounds_Top = EXCLUDED.Bounds_Top,
    Bounds_Left = EXCLUDED.Bounds_Left,
    Bounds_Bottom = EXCLUDED.Bounds_Bottom,
    Bounds_Right = EXCLUDED.Bounds_Right,
    Parent_Object_ID = EXCLUDED.Parent_Object_ID,
    Nesting_Level = EXCLUDED.Nesting_Level,
    Z_Order = EXCLUDED.Z_Order,
    Hide_Calculation_Text = EXCLUDED.Hide_Calculation_Text,
    Tooltip_Calculation_Text = EXCLUDED.Tooltip_Calculation_Text,
    Label_Calculation_Text = EXCLUDED.Label_Calculation_Text,
    ScriptTrigger_Parameter_Text = EXCLUDED.ScriptTrigger_Parameter_Text,
    Text_Content = EXCLUDED.Text_Content,
    Object_XML = EXCLUDED.Object_XML;
-- @END_STREAMIFY_BLOCK@




-- AccountsCatalog
CREATE TABLE IF NOT EXISTS AccountsCatalog (
    Account_ID BIGINT,
    Account_Kind INTEGER,
    Account_Type VARCHAR,
    Is_Enabled BOOLEAN,
    Account_UUID VARCHAR,
    Description VARCHAR,
    Account_Name VARCHAR,
    Password_Encrypted VARCHAR,
    PrivilegeSet_ID BIGINT,
    PrivilegeSet_Name VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Account_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
)
INSERT INTO AccountsCatalog
SELECT
    a.id AS Account_ID,
    a.kind AS Account_Kind,
    a.type AS Account_Type,
    a.enable AS Is_Enabled,
    a.UUID."#text" AS Account_UUID,
    a.Description AS Description,
    a.Authentication.AccountName AS Account_Name,
    a.Authentication.PasswordEncrypted AS Password_Encrypted,
    a.PrivilegeSetReference.id AS PrivilegeSet_ID,
    a.PrivilegeSetReference.name AS PrivilegeSet_Name,
    fn.File_Name as File_Name
FROM read_xml(
    getvariable('fm_xml'),
    root_element='AccountsCatalog',
    record_element='ObjectList',
    max_depth=10,
    maximum_file_size=getvariable('dom_threshold'),
    streaming=getvariable('use_streaming'),
    columns={
        'Account': 'STRUCT(
            id BIGINT,
            kind INTEGER,
            type VARCHAR,
            enable BOOLEAN,
            "UUID" STRUCT("#text" VARCHAR, modifications BIGINT, userName VARCHAR, accountName VARCHAR, timestamp VARCHAR),
            "Description" VARCHAR,
            "Authentication" STRUCT(
                "AccountName" VARCHAR,
                "PasswordEncrypted" VARCHAR
            ),
            "PrivilegeSetReference" STRUCT(
                id BIGINT,
                name VARCHAR
            )
        )[]'
    }
)
CROSS JOIN UNNEST(Account) AS t(a)
CROSS JOIN filename_normalized fn
WHERE a.id IS NOT NULL
ON CONFLICT (Account_UUID, File_Name) DO UPDATE SET
    Account_ID = EXCLUDED.Account_ID,
    Account_Kind = EXCLUDED.Account_Kind,
    Account_Type = EXCLUDED.Account_Type,
    Is_Enabled = EXCLUDED.Is_Enabled,
    Description = EXCLUDED.Description,
    Account_Name = EXCLUDED.Account_Name,
    Password_Encrypted = EXCLUDED.Password_Encrypted,
    PrivilegeSet_ID = EXCLUDED.PrivilegeSet_ID,
    PrivilegeSet_Name = EXCLUDED.PrivilegeSet_Name;


-- PrivilegeSetsCatalog
CREATE TABLE IF NOT EXISTS PrivilegeSetsCatalog (
    PrivilegeSet_ID BIGINT,
    PrivilegeSet_Name VARCHAR,
    PrivilegeSet_UUID VARCHAR,
    Description VARCHAR,
    Is_Default_Access BOOLEAN,
    Records_Create BOOLEAN,
    Records_Edit BOOLEAN,
    Records_Delete BOOLEAN,
    Records_View VARCHAR,
    Layouts_Create BOOLEAN,
    Layouts_Edit BOOLEAN,
    Layouts_Delete BOOLEAN,
    Layouts_View VARCHAR,
    Layouts_Custom BOOLEAN,
    ValueLists_Create BOOLEAN,
    ValueLists_Edit BOOLEAN,
    ValueLists_Delete BOOLEAN,
    ValueLists_View VARCHAR,
    Scripts_Create BOOLEAN,
    Scripts_Edit BOOLEAN,
    Scripts_Delete BOOLEAN,
    Scripts_View VARCHAR,
    Other_Value INTEGER,
    Allow_Print BOOLEAN,
    Allow_Export BOOLEAN,
    Manage_Database BOOLEAN,
    Manage_Custom_Menus BOOLEAN,
    Manage_Accounts BOOLEAN,
    Manage_Ext_Privs BOOLEAN,
    Allow_Override BOOLEAN,
    Allow_Open_Quickly BOOLEAN,
    Disconnect_Idle BOOLEAN,
    Commands VARCHAR,
    Password_Prohibit_Modification BOOLEAN,
    File_Name VARCHAR,
    PRIMARY KEY (PrivilegeSet_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
privilege_sets AS (
    SELECT
        unnest(xml_extract_elements(xml, '//PrivilegeSetsCatalog/ObjectList/PrivilegeSet')) as ps_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO PrivilegeSetsCatalog
SELECT
    xml_extract_text(ps_xml, '/PrivilegeSet/@id')[1]::BIGINT as PrivilegeSet_ID,
    xml_extract_text(ps_xml, '/PrivilegeSet/@name')[1] as PrivilegeSet_Name,
    xml_extract_text(ps_xml, '/PrivilegeSet/UUID')[1] as PrivilegeSet_UUID,
    xml_extract_text(ps_xml, '/PrivilegeSet/Description')[1] as Description,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/@default')[1] = 'True' as Is_Default_Access,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Records/@Create')[1] = 'True' as Records_Create,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Records/@Edit')[1] = 'True' as Records_Edit,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Records/@Delete')[1] = 'True' as Records_Delete,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Records/@View')[1] as Records_View,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@Create')[1] = 'True' as Layouts_Create,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@Edit')[1] = 'True' as Layouts_Edit,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@Delete')[1] = 'True' as Layouts_Delete,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@View')[1] as Layouts_View,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/@Custom')[1] = 'True' as Layouts_Custom,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/@Create')[1] = 'True' as ValueLists_Create,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/@Edit')[1] = 'True' as ValueLists_Edit,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/@Delete')[1] = 'True' as ValueLists_Delete,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/@View')[1] as ValueLists_View,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/@Create')[1] = 'True' as Scripts_Create,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/@Edit')[1] = 'True' as Scripts_Edit,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/@Delete')[1] = 'True' as Scripts_Delete,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/@View')[1] as Scripts_View,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@value')[1]::INTEGER as Other_Value,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@Print')[1] = 'True' as Allow_Print,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@Export')[1] = 'True' as Allow_Export,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@manageDatabase')[1] = 'True' as Manage_Database,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@manageCustomMenus')[1] = 'True' as Manage_Custom_Menus,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@manageAccounts')[1] = 'True' as Manage_Accounts,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@manageExtPrivs')[1] = 'True' as Manage_Ext_Privs,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@allowOverride')[1] = 'True' as Allow_Override,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@allowOpenQuickly')[1] = 'True' as Allow_Open_Quickly,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@disconnectIdle')[1] = 'True' as Disconnect_Idle,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/@commands')[1] as Commands,
    xml_extract_text(ps_xml, '/PrivilegeSet/access/Other/Password/@prohibitModification')[1] = 'True' as Password_Prohibit_Modification,
    fn.File_Name as File_Name
FROM privilege_sets
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(ps_xml, '/PrivilegeSet/@id')[1] IS NOT NULL
ON CONFLICT (PrivilegeSet_UUID, File_Name) DO UPDATE SET
    PrivilegeSet_ID = EXCLUDED.PrivilegeSet_ID,
    PrivilegeSet_Name = EXCLUDED.PrivilegeSet_Name,
    Description = EXCLUDED.Description,
    Is_Default_Access = EXCLUDED.Is_Default_Access,
    Records_Create = EXCLUDED.Records_Create,
    Records_Edit = EXCLUDED.Records_Edit,
    Records_Delete = EXCLUDED.Records_Delete,
    Records_View = EXCLUDED.Records_View,
    Layouts_Create = EXCLUDED.Layouts_Create,
    Layouts_Edit = EXCLUDED.Layouts_Edit,
    Layouts_Delete = EXCLUDED.Layouts_Delete,
    Layouts_View = EXCLUDED.Layouts_View,
    Layouts_Custom = EXCLUDED.Layouts_Custom,
    ValueLists_Create = EXCLUDED.ValueLists_Create,
    ValueLists_Edit = EXCLUDED.ValueLists_Edit,
    ValueLists_Delete = EXCLUDED.ValueLists_Delete,
    ValueLists_View = EXCLUDED.ValueLists_View,
    Scripts_Create = EXCLUDED.Scripts_Create,
    Scripts_Edit = EXCLUDED.Scripts_Edit,
    Scripts_Delete = EXCLUDED.Scripts_Delete,
    Scripts_View = EXCLUDED.Scripts_View,
    Other_Value = EXCLUDED.Other_Value,
    Allow_Print = EXCLUDED.Allow_Print,
    Allow_Export = EXCLUDED.Allow_Export,
    Manage_Database = EXCLUDED.Manage_Database,
    Manage_Custom_Menus = EXCLUDED.Manage_Custom_Menus,
    Manage_Accounts = EXCLUDED.Manage_Accounts,
    Manage_Ext_Privs = EXCLUDED.Manage_Ext_Privs,
    Allow_Override = EXCLUDED.Allow_Override,
    Allow_Open_Quickly = EXCLUDED.Allow_Open_Quickly,
    Disconnect_Idle = EXCLUDED.Disconnect_Idle,
    Commands = EXCLUDED.Commands,
    Password_Prohibit_Modification = EXCLUDED.Password_Prohibit_Modification;


-- ========================================
-- PrivilegeSetRecordAccess (Custom Record Privileges, Tabellen-Ebene)
--
-- Custom Record Privileges, Stufe 1: Bei <Records Custom="True"> liegt
-- der Detailbaum unter Records/Custom/ObjectList/Table und wurde von
-- PrivilegeSetsCatalog (nur Attribut-Lesung am <Records>-Element) bisher
-- ignoriert. Diese Tabelle parst den Custom-Subtree auf Tabellen-Ebene:
-- eine Zeile je Privilege Set × Tabelle × Operation (View/Edit/Create/Delete).
--
-- <Table type="New"> ist die Default-Regel für künftige, noch nicht existierende
-- Tabellen (BaseTable_* = NULL, Table_Type = 'New'). Access_Mode bleibt VARCHAR
-- (keine Enum), damit unbekannte @access-Modi nicht verloren gehen.
-- ========================================
CREATE TABLE IF NOT EXISTS PrivilegeSetRecordAccess (
    PrivilegeSet_ID BIGINT,
    PrivilegeSet_Name VARCHAR,
    PrivilegeSet_UUID VARCHAR,
    BaseTable_ID BIGINT,
    BaseTable_Name VARCHAR,
    BaseTable_UUID VARCHAR,
    Table_Type VARCHAR,        -- 'existing' | 'New' (Default-Regel für künftige Tabellen)
    Operation VARCHAR,         -- 'View' | 'Edit' | 'Create' | 'Delete'
    Access_Mode VARCHAR,       -- NoAccess | ReadOnly | ReadWrite | Calculation | Custom | … (VARCHAR, keine Enum)
    Calculation_Text VARCHAR,  -- Klartext-Formel (CDATA) bei @access="Calculation", normalisiert
    DDR_Hash VARCHAR,          -- Calculation/DDRREF/@hash → JOIN mit DDR_Calculations.Calc_Hash
    Context_TO_Name VARCHAR,   -- Auswertungskontext (Calculation/TableOccurrenceReference)
    Context_TO_UUID VARCHAR,
    Fields_Access VARCHAR,     -- <Fields>@access der Tabelle (ein Wert je Tabelle)
    File_Name VARCHAR
);

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen (1:N, kein PK).
-- BaseTable_UUID ist bei type="New" NULL, daher DELETE-by-File statt ON CONFLICT.
-- Chunk-Guard (project/plan_xml_diff.md §4.3, I2): nur löschen, wenn der aktuelle
-- XML-Input (= Chunk) den PrivilegeSetsCatalog-Branch enthält. Ohne Guard würde ein
-- Chunk OHNE diesen Branch die von einem anderen Chunk derselben Datei eingefügten
-- Zeilen löschen (DELETE-then-INSERT, kein UPSERT). Nicht-gesplittet: Branch immer
-- präsent → Verhalten unverändert.
DELETE FROM PrivilegeSetRecordAccess WHERE File_Name IN (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
    WHERE len(xml_extract_elements(xml, '//PrivilegeSetsCatalog')) > 0
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
privilege_sets AS (
    SELECT
        unnest(xml_extract_elements(xml, '//PrivilegeSetsCatalog/ObjectList/PrivilegeSet')) as ps_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
-- Zweistufiges unnest (analog StepsForScripts): Privilege-Set-Subtree →
-- Records/Custom/ObjectList/Table. Nur Sets mit Custom Record Privileges
-- besitzen diesen Subtree; einfache <Records …>-Attribut-Sets liefern keine Zeilen.
ps_tables AS (
    SELECT
        xml_extract_text(ps_xml, '/PrivilegeSet/@id')[1]::BIGINT as PrivilegeSet_ID,
        xml_extract_text(ps_xml, '/PrivilegeSet/@name')[1] as PrivilegeSet_Name,
        xml_extract_text(ps_xml, '/PrivilegeSet/UUID')[1] as PrivilegeSet_UUID,
        unnest(xml_extract_elements(ps_xml, '/PrivilegeSet/access/Records/Custom/ObjectList/Table')) as table_xml
    FROM privilege_sets
),
ps_table_info AS (
    SELECT
        PrivilegeSet_ID,
        PrivilegeSet_Name,
        PrivilegeSet_UUID,
        xml_extract_text(table_xml, '/Table/BaseTableReference/@id')[1]::BIGINT as BaseTable_ID,
        xml_extract_text(table_xml, '/Table/BaseTableReference/@name')[1] as BaseTable_Name,
        xml_extract_text(table_xml, '/Table/BaseTableReference/@UUID')[1] as BaseTable_UUID,
        xml_extract_text(table_xml, '/Table/@type')[1] as Table_Type,
        xml_extract_text(table_xml, '/Table/Fields/@access')[1] as Fields_Access,
        table_xml
    FROM ps_tables
),
-- Die vier Operationen je Table-Zeile flachklopfen. Jeder Operation entspricht
-- ein gleichnamiger Kindknoten (<View>/<Edit>/<Create>/<Delete>) mit @access und
-- optionalem <Calculation>-Block (TableOccurrenceReference + DDRREF + Text-CDATA).
ps_record_access AS (
    SELECT * FROM (
        SELECT
            ti.*,
            'View' as Operation,
            xml_extract_text(table_xml, '/Table/View/@access')[1] as Access_Mode,
            xml_extract_text(table_xml, '/Table/View/Calculation/Text')[1] as Calc_Text_Raw,
            xml_extract_text(table_xml, '/Table/View/Calculation/DDRREF/@hash')[1] as DDR_Hash,
            xml_extract_text(table_xml, '/Table/View/Calculation/TableOccurrenceReference/@name')[1] as Context_TO_Name,
            xml_extract_text(table_xml, '/Table/View/Calculation/TableOccurrenceReference/@UUID')[1] as Context_TO_UUID
        FROM ps_table_info ti
        UNION ALL
        SELECT
            ti.*,
            'Edit' as Operation,
            xml_extract_text(table_xml, '/Table/Edit/@access')[1],
            xml_extract_text(table_xml, '/Table/Edit/Calculation/Text')[1],
            xml_extract_text(table_xml, '/Table/Edit/Calculation/DDRREF/@hash')[1],
            xml_extract_text(table_xml, '/Table/Edit/Calculation/TableOccurrenceReference/@name')[1],
            xml_extract_text(table_xml, '/Table/Edit/Calculation/TableOccurrenceReference/@UUID')[1]
        FROM ps_table_info ti
        UNION ALL
        SELECT
            ti.*,
            'Create' as Operation,
            xml_extract_text(table_xml, '/Table/Create/@access')[1],
            xml_extract_text(table_xml, '/Table/Create/Calculation/Text')[1],
            xml_extract_text(table_xml, '/Table/Create/Calculation/DDRREF/@hash')[1],
            xml_extract_text(table_xml, '/Table/Create/Calculation/TableOccurrenceReference/@name')[1],
            xml_extract_text(table_xml, '/Table/Create/Calculation/TableOccurrenceReference/@UUID')[1]
        FROM ps_table_info ti
        UNION ALL
        SELECT
            ti.*,
            'Delete' as Operation,
            xml_extract_text(table_xml, '/Table/Delete/@access')[1],
            xml_extract_text(table_xml, '/Table/Delete/Calculation/Text')[1],
            xml_extract_text(table_xml, '/Table/Delete/Calculation/DDRREF/@hash')[1],
            xml_extract_text(table_xml, '/Table/Delete/Calculation/TableOccurrenceReference/@name')[1],
            xml_extract_text(table_xml, '/Table/Delete/Calculation/TableOccurrenceReference/@UUID')[1]
        FROM ps_table_info ti
    )
)
INSERT INTO PrivilegeSetRecordAccess
SELECT
    ra.PrivilegeSet_ID,
    ra.PrivilegeSet_Name,
    ra.PrivilegeSet_UUID,
    ra.BaseTable_ID,
    ra.BaseTable_Name,
    ra.BaseTable_UUID,
    ra.Table_Type,
    ra.Operation,
    ra.Access_Mode,
    -- chr(127) -> chr(10): Preprocessing-Sentinel für CR zurück zu LF
    replace(ra.Calc_Text_Raw, chr(127), chr(10)) as Calculation_Text,
    ra.DDR_Hash,
    ra.Context_TO_Name,
    ra.Context_TO_UUID,
    ra.Fields_Access,
    fn.File_Name
FROM ps_record_access ra
CROSS JOIN filename_normalized fn
WHERE ra.PrivilegeSet_UUID IS NOT NULL;


-- ========================================
-- PrivilegeSetFieldAccess (Custom Record Privileges, Feld-Ebene)
--
-- Custom Record Privileges, Stufe 2: Trägt eine Tabelle im Custom-Subtree
-- <Fields access="Custom">, öffnet sich darunter ein feld-granularer Detailbaum
-- aus <Field>-Einträgen mit eigenem @access. Eine Zeile je Privilege Set ×
-- Tabelle × Feld. Nur Tabellen mit Fields_Access='Custom' liefern Zeilen;
-- alle anderen tragen ihren einzelnen Fields-@access bereits in
-- PrivilegeSetRecordAccess.Fields_Access.
--
-- Graph-Integration: scoped restricts_field-Link in create_universal_catalogs.sql
-- (Block 35) — NUR Restriktionen (Access_Mode <> 'ReadWrite'), eigener Link_Role
-- statt reads_field. Voll-offene Felder (ReadWrite) erzeugen bewusst keine Links
-- (kein Signal). Die Where-Used-Lücke schließt weiterhin allein Stufe 1 (Calc-Refs);
-- restricts_field ist eine Einschränkung, keine Nutzung.
-- ========================================
CREATE TABLE IF NOT EXISTS PrivilegeSetFieldAccess (
    PrivilegeSet_ID BIGINT,
    PrivilegeSet_Name VARCHAR,
    PrivilegeSet_UUID VARCHAR,
    BaseTable_ID BIGINT,
    BaseTable_Name VARCHAR,
    BaseTable_UUID VARCHAR,
    Field_ID BIGINT,
    Field_Name VARCHAR,
    Field_UUID VARCHAR,
    Field_Type VARCHAR,        -- 'existing' | 'New' (Default-Regel für künftige Felder)
    Access_Mode VARCHAR,       -- NoAccess | ReadOnly | ReadWrite | … (VARCHAR, keine Enum)
    File_Name VARCHAR
);

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen (1:N, kein PK).
-- Chunk-Guard (§4.3, I2): nur löschen, wenn der Chunk PrivilegeSetsCatalog enthält.
DELETE FROM PrivilegeSetFieldAccess WHERE File_Name IN (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
    WHERE len(xml_extract_elements(xml, '//PrivilegeSetsCatalog')) > 0
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
privilege_sets AS (
    SELECT
        unnest(xml_extract_elements(xml, '//PrivilegeSetsCatalog/ObjectList/PrivilegeSet')) as ps_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
-- Dreistufiges unnest: Privilege-Set → Table → Field. Nur Tabellen mit
-- <Fields access="Custom"> besitzen <Field>-Kinder; alle anderen liefern
-- eine leere Liste und fallen damit automatisch aus dem Ergebnis.
ps_tables AS (
    SELECT
        xml_extract_text(ps_xml, '/PrivilegeSet/@id')[1]::BIGINT as PrivilegeSet_ID,
        xml_extract_text(ps_xml, '/PrivilegeSet/@name')[1] as PrivilegeSet_Name,
        xml_extract_text(ps_xml, '/PrivilegeSet/UUID')[1] as PrivilegeSet_UUID,
        unnest(xml_extract_elements(ps_xml, '/PrivilegeSet/access/Records/Custom/ObjectList/Table')) as table_xml
    FROM privilege_sets
),
ps_table_fields AS (
    SELECT
        PrivilegeSet_ID,
        PrivilegeSet_Name,
        PrivilegeSet_UUID,
        xml_extract_text(table_xml, '/Table/BaseTableReference/@id')[1]::BIGINT as BaseTable_ID,
        xml_extract_text(table_xml, '/Table/BaseTableReference/@name')[1] as BaseTable_Name,
        xml_extract_text(table_xml, '/Table/BaseTableReference/@UUID')[1] as BaseTable_UUID,
        unnest(xml_extract_elements(table_xml, '/Table/Fields/Field')) as field_xml
    FROM ps_tables
)
INSERT INTO PrivilegeSetFieldAccess
SELECT
    f.PrivilegeSet_ID,
    f.PrivilegeSet_Name,
    f.PrivilegeSet_UUID,
    f.BaseTable_ID,
    f.BaseTable_Name,
    f.BaseTable_UUID,
    xml_extract_text(field_xml, '/Field/FieldReference/@id')[1]::BIGINT as Field_ID,
    xml_extract_text(field_xml, '/Field/FieldReference/@name')[1] as Field_Name,
    xml_extract_text(field_xml, '/Field/FieldReference/@UUID')[1] as Field_UUID,
    xml_extract_text(field_xml, '/Field/@type')[1] as Field_Type,
    xml_extract_text(field_xml, '/Field/@access')[1] as Access_Mode,
    fn.File_Name
FROM ps_table_fields f
CROSS JOIN filename_normalized fn
WHERE f.PrivilegeSet_UUID IS NOT NULL;


-- ========================================
-- PrivilegeSetObjectAccess (Custom Privileges für Layouts/ValueLists/Scripts)
--
-- Custom Privileges, Stufe 3: Dieselbe Custom="True"-Mechanik wie bei den
-- Record-Privilegien existiert für weitere Objektklassen. Bei
-- <Layouts|ValueLists|Scripts Custom="True"> listet <Custom>/ObjectList jedes
-- Objekt der Klasse mit eigenem @access. Eine Zeile je Privilege Set × Objekt.
--
-- Unified-Tabelle mit Object_Class-Diskriminator (statt drei fast identischer
-- Tabellen). Klassen ohne Custom-Subtree (einfache Attribut-Form wie
-- <ValueLists Create="True" …>) liefern keine Zeilen.
--
-- Records_Access ist nur bei Layouts belegt (Layout trägt zusätzlich zum
-- Layout-@access ein @records für den Datensatz-Zugriff auf dem Layout).
-- Class_Allow_Create spiegelt das <Custom Create="…">-Attribut der Klasse
-- (gilt für die ganze Klasse, der Bequemlichkeit halber je Zeile wiederholt).
--
-- Graph-Integration: scoped restricts_object-Link in create_universal_catalogs.sql
-- (Block 36) — analog zur Feld-Ebene NUR Restriktionen (Access_Mode <> 'ReadWrite');
-- voll-offene Objekte erzeugen keine Links (kein Signal bei hohem Volumen).
-- ========================================
CREATE TABLE IF NOT EXISTS PrivilegeSetObjectAccess (
    PrivilegeSet_ID BIGINT,
    PrivilegeSet_Name VARCHAR,
    PrivilegeSet_UUID VARCHAR,
    Object_Class VARCHAR,      -- 'Layout' | 'ValueList' | 'Script'
    Object_ID BIGINT,
    Object_Name VARCHAR,
    Object_UUID VARCHAR,
    Item_Type VARCHAR,         -- 'existing' | 'New' (Default-Regel für künftige Objekte)
    Access_Mode VARCHAR,       -- NoAccess | ReadOnly | ReadWrite | … (VARCHAR, keine Enum)
    Records_Access VARCHAR,    -- nur Layouts: @records (Datensatz-Zugriff auf dem Layout)
    Class_Allow_Create BOOLEAN, -- <Custom Create="…"> der Klasse (darf neue Objekte angelegt werden?)
    File_Name VARCHAR
);

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen (1:N, kein PK).
-- Chunk-Guard (§4.3, I2): nur löschen, wenn der Chunk PrivilegeSetsCatalog enthält.
DELETE FROM PrivilegeSetObjectAccess WHERE File_Name IN (
    SELECT regexp_replace(
        xml_extract_text(xml, '/FMSaveAsXML/@File')[1], '\.fmp12$', ''
    ) FROM read_xml_objects(getvariable('fm_xml'),
        maximum_file_size=getvariable('max_filesize'))
    WHERE len(xml_extract_elements(xml, '//PrivilegeSetsCatalog')) > 0
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
privilege_sets AS (
    SELECT
        unnest(xml_extract_elements(xml, '//PrivilegeSetsCatalog/ObjectList/PrivilegeSet')) as ps_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
ps_base AS (
    SELECT
        xml_extract_text(ps_xml, '/PrivilegeSet/@id')[1]::BIGINT as PrivilegeSet_ID,
        xml_extract_text(ps_xml, '/PrivilegeSet/@name')[1] as PrivilegeSet_Name,
        xml_extract_text(ps_xml, '/PrivilegeSet/UUID')[1] as PrivilegeSet_UUID,
        ps_xml
    FROM privilege_sets
),
-- Pro Objektklasse ein eigenes unnest (Item- und Reference-Elementnamen
-- unterscheiden sich je Klasse), anschließend per UNION ALL vereint.
layout_items AS (
    SELECT
        PrivilegeSet_ID, PrivilegeSet_Name, PrivilegeSet_UUID,
        'Layout' as Object_Class,
        xml_extract_text(ps_xml, '/PrivilegeSet/access/Layouts/Custom/@Create')[1] = 'True' as Class_Allow_Create,
        unnest(xml_extract_elements(ps_xml, '/PrivilegeSet/access/Layouts/Custom/ObjectList/Layout')) as item_xml
    FROM ps_base
),
valuelist_items AS (
    SELECT
        PrivilegeSet_ID, PrivilegeSet_Name, PrivilegeSet_UUID,
        'ValueList' as Object_Class,
        xml_extract_text(ps_xml, '/PrivilegeSet/access/ValueLists/Custom/@Create')[1] = 'True' as Class_Allow_Create,
        unnest(xml_extract_elements(ps_xml, '/PrivilegeSet/access/ValueLists/Custom/ObjectList/ValueList')) as item_xml
    FROM ps_base
),
script_items AS (
    SELECT
        PrivilegeSet_ID, PrivilegeSet_Name, PrivilegeSet_UUID,
        'Script' as Object_Class,
        xml_extract_text(ps_xml, '/PrivilegeSet/access/Scripts/Custom/@Create')[1] = 'True' as Class_Allow_Create,
        unnest(xml_extract_elements(ps_xml, '/PrivilegeSet/access/Scripts/Custom/ObjectList/Script')) as item_xml
    FROM ps_base
)
INSERT INTO PrivilegeSetObjectAccess
SELECT
    i.PrivilegeSet_ID,
    i.PrivilegeSet_Name,
    i.PrivilegeSet_UUID,
    i.Object_Class,
    -- Reference-Element trägt denselben Namen wie die Klasse (Layout→LayoutReference, …)
    xml_extract_text(i.item_xml, '/' || i.Object_Class || '/' || i.Object_Class || 'Reference/@id')[1]::BIGINT as Object_ID,
    xml_extract_text(i.item_xml, '/' || i.Object_Class || '/' || i.Object_Class || 'Reference/@name')[1] as Object_Name,
    xml_extract_text(i.item_xml, '/' || i.Object_Class || '/' || i.Object_Class || 'Reference/@UUID')[1] as Object_UUID,
    xml_extract_text(i.item_xml, '/' || i.Object_Class || '/@type')[1] as Item_Type,
    xml_extract_text(i.item_xml, '/' || i.Object_Class || '/@access')[1] as Access_Mode,
    xml_extract_text(i.item_xml, '/' || i.Object_Class || '/@records')[1] as Records_Access,
    i.Class_Allow_Create,
    fn.File_Name
FROM (
    SELECT * FROM layout_items
    UNION ALL
    SELECT * FROM valuelist_items
    UNION ALL
    SELECT * FROM script_items
) i
CROSS JOIN filename_normalized fn
WHERE i.PrivilegeSet_UUID IS NOT NULL;


-- ========================================
-- DDR_INFO Integration (FileMaker 21+)
--
-- HINWEIS: Diese Tabellen werden immer erstellt, bleiben aber leer,
-- wenn die XML-Datei kein Has_DDR_INFO="True" Attribut hat.
-- Prüfe XMLMetadata.Has_DDR_INFO um zu sehen, ob DDR-Info verfügbar ist.
-- ========================================

-- DDR_ScriptSteps: Lesbare Script-Schritte aus DDR_INFO
CREATE TABLE IF NOT EXISTS DDR_ScriptSteps (
    Step_UUID VARCHAR,
    Step_Hash VARCHAR,
    Step_Text VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Step_UUID, File_Name)
);

-- @STREAMIFY_BLOCK:ddr_scriptsteps@
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
ddr_script_raw AS (
    SELECT
        unnest(xml_extract_elements(xml, '//DDR_INFO/Script/ObjectList/*')) as step_elem
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO DDR_ScriptSteps
SELECT
    regexp_extract(
        step_elem::VARCHAR,
        '<_([0-9A-F-]+)',
        1
    ) as Step_UUID,
    xml_extract_text(step_elem, '//*/@hash')[1] as Step_Hash,
    replace(xml_extract_text(step_elem, '//text()')[1], chr(127), chr(10)) as Step_Text,
    fn.File_Name as File_Name
FROM ddr_script_raw
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(step_elem, '//*/@datatype')[1] = 'StepText'
ON CONFLICT (Step_UUID, File_Name) DO UPDATE SET
    Step_Hash = EXCLUDED.Step_Hash,
    Step_Text = EXCLUDED.Step_Text;
-- @END_STREAMIFY_BLOCK@


-- DDR_Calculations: Formel-Chunks für Abhängigkeitsanalyse
CREATE TABLE IF NOT EXISTS DDR_Calculations (
    Calc_UUID VARCHAR,
    Calc_Hash VARCHAR,
    Chunk_Index BIGINT,
    Chunk_Type VARCHAR,
    Chunk_Content VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Calc_UUID, Chunk_Index, File_Name)
);

-- @STREAMIFY_BLOCK:ddr_calculations@
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
ddr_calc_raw AS (
    SELECT
        unnest(xml_extract_elements(xml, '//DDR_INFO/Calculation/ObjectList/*')) as calc_elem
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
-- Chunk-Index in XML-Dokumentreihenfolge (PRD prd_universal_function_links.md §4):
-- Zwei parallele unnest()-Aufrufe iterieren synchron pro Zeile. Die Chunk-Liste
-- und ein begleitendes generate_series mit derselben Länge erzeugen einen
-- deterministischen, lesegerechten Chunk_Index. Vorgängerlösung mit
-- ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) war nicht-deterministisch.
calc_with_chunk_lists AS (
    SELECT
        -- Slot-Suffix erhalten: '_<UUID>_<Slot>' (numerisch UND benannt,
        -- formatunabhängig bis zum ersten Whitespace/'>'). Die alte Variante
        -- '<_([0-9A-F-]+)' schnitt den Slot ab → verschiedene Slots derselben
        -- UUID kollidierten im PK (Calc_UUID, Chunk_Index, File_Name) und
        -- überschrieben sich per ON CONFLICT DO UPDATE (~36-41% Definitionsverlust).
        -- Calc_UUID wird nirgends mit Objekt-UUIDs gejoint (alle Objekt-Joins
        -- laufen über Calc_Hash), daher ist die Bedeutungsänderung
        -- "Objekt-UUID" → "Berechnungs-Instanz-ID (UUID+Slot)" unkritisch.
        regexp_extract(
            calc_elem::VARCHAR,
            '<(_[^\s>]+)',
            1
        ) as Calc_UUID,
        xml_extract_text(calc_elem, '//*/@hash')[1] as Calc_Hash,
        xml_extract_elements(calc_elem, '//ChunkList/Chunk') as chunks
    FROM ddr_calc_raw
    WHERE xml_extract_text(calc_elem, '//*/@datatype')[1] = 'ChunkList'
),
calc_with_chunks AS (
    SELECT
        Calc_UUID,
        Calc_Hash,
        unnest(chunks) as chunk_xml,
        unnest(generate_series(1, len(chunks))) as chunk_index
    FROM calc_with_chunk_lists
)
INSERT INTO DDR_Calculations
SELECT
    Calc_UUID,
    Calc_Hash,
    chunk_index as Chunk_Index,
    xml_extract_text(chunk_xml, '/Chunk/@type')[1] as Chunk_Type,
    COALESCE(
        xml_extract_text(chunk_xml, 'text()')[1],
        chunk_xml::VARCHAR
    ) as Chunk_Content,
    fn.File_Name as File_Name
FROM calc_with_chunks
CROSS JOIN filename_normalized fn
ON CONFLICT (Calc_UUID, Chunk_Index, File_Name) DO UPDATE SET
    Calc_Hash = EXCLUDED.Calc_Hash,
    Chunk_Type = EXCLUDED.Chunk_Type,
    Chunk_Content = EXCLUDED.Chunk_Content;
-- @END_STREAMIFY_BLOCK@




-- ============================================
-- PHASE 4: OPTIONALE KATALOGE
-- ============================================


-- ============================================
-- 20. PasteIndexList
-- ============================================
-- Sehr einfach: Liste von Object-IDs
-- Wird verwendet für Copy/Paste Operations
CREATE TABLE IF NOT EXISTS PasteIndexList (
    Object_ID BIGINT,
    List_Index BIGINT,
    File_Name VARCHAR,
    PRIMARY KEY (Object_ID, File_Name)
);

-- @STREAMIFY_BLOCK:pasteindexlist@
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
paste_objects AS (
    SELECT
        unnest(xml_extract_elements(xml, '//PasteIndexList/Object')) as object_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO PasteIndexList
SELECT
    xml_extract_text(object_xml, '/Object/@id')[1]::BIGINT as Object_ID,
    ROW_NUMBER() OVER (ORDER BY Object_ID) as List_Index,
    fn.File_Name as File_Name
FROM paste_objects
CROSS JOIN filename_normalized fn
WHERE Object_ID IS NOT NULL
ON CONFLICT (Object_ID, File_Name) DO UPDATE SET
    List_Index = EXCLUDED.List_Index;
-- @END_STREAMIFY_BLOCK@


-- ============================================
-- 21. BaseDirectoryCatalog
-- ============================================
-- Basis-Directory der FileMaker-Datei
-- Pattern: XPath für nested Element
CREATE TABLE IF NOT EXISTS BaseDirectoryCatalog (
    BD_Name VARCHAR,
    BD_ID BIGINT,
    BD_RelativeTo VARCHAR,
    BD_UUID VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (BD_UUID, File_Name)
);

-- @STREAMIFY_BLOCK:basedirectorycatalog@
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_dir AS (
    SELECT
        unnest(xml_extract_elements(xml, '//BaseDirectoryCatalog/BaseDirectory')) as dir_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO BaseDirectoryCatalog
SELECT
    xml_extract_text(dir_xml, '/BaseDirectory/@name')[1] as BD_Name,
    xml_extract_text(dir_xml, '/BaseDirectory/@id')[1]::BIGINT as BD_ID,
    xml_extract_text(dir_xml, '/BaseDirectory/@relativeTo')[1] as BD_RelativeTo,
    xml_extract_text(dir_xml, '/BaseDirectory/UUID/text()')[1] as BD_UUID,
    fn.File_Name as File_Name
FROM raw_dir
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(dir_xml, '/BaseDirectory/@id')[1] IS NOT NULL
ON CONFLICT (BD_UUID, File_Name) DO UPDATE SET
    BD_Name = EXCLUDED.BD_Name,
    BD_ID = EXCLUDED.BD_ID,
    BD_RelativeTo = EXCLUDED.BD_RelativeTo;
-- @END_STREAMIFY_BLOCK@


-- ============================================
-- 22. ScriptTriggers
-- ============================================
-- Script Trigger (OnFirstWindowOpen, OnLastWindowClose, etc.)
-- Pattern: XPath für nested Element in Metadata
-- Owner-Kontext (Owner_UUID, Owner_Type) ist Teil der Trigger-Identität:
-- Trigger_ID ist bei Object-Level-Triggern nur ein Slot innerhalb des Owner-
-- Kontexts (kein globaler Identifier). Mit dem alten PK (Trigger_ID, File_Name)
-- kollabierte ON CONFLICT DO UPDATE beliebig viele Trigger-Instanzen auf eine
-- Row ("letzter gewinnt", ~96% Verlust). Der Trigger wird erst durch
-- (Trigger_ID, Owner_UUID, File_Name) eindeutig.
CREATE TABLE IF NOT EXISTS ScriptTriggers (
    Trigger_ID BIGINT,
    Trigger_Action VARCHAR,
    Trigger_BrowseMode VARCHAR,
    Script_ID BIGINT,
    Script_Name VARCHAR,
    Script_UUID VARCHAR,
    Owner_UUID VARCHAR,
    Owner_Type VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Trigger_ID, Owner_UUID, File_Name)
);

-- Owner-getrennte Extraktion: das frühere flache '//ScriptTriggers/ScriptTrigger'
-- verwarf den Parent-Kontext. Drei Quellen per UNION ALL, jede trägt Owner_UUID
-- + Owner_Type mit. Die XPaths sind so geschnitten, dass kein Trigger doppelt
-- erfasst wird: Object-Level-Trigger liegen INNERHALB von Layouts, daher greift
-- die Layout-Stufe nur die DIREKTEN Trigger des <Layout> (Pfad /Layout/Script...),
-- nicht die der enthaltenen <LayoutObject>.
-- @STREAMIFY_BLOCK:scripttriggers@
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
-- File-Level (OnFirstWindowOpen, OnLastWindowClose, …) — eindeutig pro File
file_triggers AS (
    SELECT
        'File' as Owner_Type,
        xml_extract_text(xml, '/FMSaveAsXML/@UUID')[1] as Owner_UUID,
        unnest(xml_extract_elements(xml, '//Metadata/AddAction/ScriptTriggers/ScriptTrigger')) as trigger_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
-- Layout-Level (OnLayoutEnter, OnLayoutKeystroke, …) — nur DIREKTE <Layout>-Trigger
raw_layouts AS (
    SELECT unnest(xml_extract_elements(xml, '//LayoutCatalog/Layout')) as layout_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
layout_triggers AS (
    SELECT
        'Layout' as Owner_Type,
        xml_extract_text(layout_xml, '/Layout/UUID')[1] as Owner_UUID,
        unnest(xml_extract_elements(layout_xml, '/Layout/ScriptTriggers/ScriptTrigger')) as trigger_xml
    FROM raw_layouts
),
-- LayoutObject-Level (OnObjectSave, OnObjectEnter, …) — der kollidierende Fall:
-- viele Objekte teilen dieselbe lokale Trigger_ID. Der direkte Pfad greift nur
-- die eigenen Trigger jedes Objekts; verschachtelte Kinder liefern ihre Trigger
-- über ihre eigene //LayoutObject-Zeile (kein Doppelzählen).
raw_objects AS (
    SELECT unnest(xml_extract_elements(xml, '//LayoutObject')) as obj_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
),
object_triggers AS (
    SELECT
        'LayoutObject' as Owner_Type,
        xml_extract_text(obj_xml, '/LayoutObject/UUID')[1] as Owner_UUID,
        unnest(xml_extract_elements(obj_xml, '/LayoutObject/ScriptTriggers/ScriptTrigger')) as trigger_xml
    FROM raw_objects
),
all_triggers AS (
    SELECT * FROM file_triggers
    UNION ALL SELECT * FROM layout_triggers
    UNION ALL SELECT * FROM object_triggers
)
INSERT INTO ScriptTriggers
SELECT
    xml_extract_text(t.trigger_xml, '/ScriptTrigger/@id')[1]::BIGINT as Trigger_ID,
    xml_extract_text(t.trigger_xml, '/ScriptTrigger/@action')[1] as Trigger_Action,
    xml_extract_text(t.trigger_xml, '/ScriptTrigger/@browseMode')[1] as Trigger_BrowseMode,

    -- Script-Referenz
    xml_extract_text(t.trigger_xml, '/ScriptTrigger/ScriptReference/@id')[1]::BIGINT as Script_ID,
    xml_extract_text(t.trigger_xml, '/ScriptTrigger/ScriptReference/@name')[1] as Script_Name,
    xml_extract_text(t.trigger_xml, '/ScriptTrigger/ScriptReference/@UUID')[1] as Script_UUID,

    -- Deterministischer md5-Fallback verhindert eine NULL im PK, falls ein Owner
    -- ausnahmsweise keine UUID trägt (kein ROW_NUMBER, vgl. Slot-Fix oben).
    -- SERIALISIERUNGS-UNABHÄNGIG (project/plan_xml_diff_streaming_preprocess.md): hasht
    -- EXTRAHIERTE Identitätsfelder statt der Roh-Serialisierung trigger_xml::VARCHAR.
    -- Sonst divergierte der PK unter SAX-Streaming (CDATA/Entity/Whitespace) und
    -- erzwänge einen DOM-Fallback. Owner-lose Trigger sind ein Edge-Case (in den
    -- Testdaten 0 Zeilen → DOM-Baseline unverändert); der Schlüssel bleibt deterministisch.
    COALESCE(t.Owner_UUID, md5(
        COALESCE(xml_extract_text(t.trigger_xml, '/ScriptTrigger/@id')[1], '') || '|' ||
        COALESCE(xml_extract_text(t.trigger_xml, '/ScriptTrigger/@action')[1], '') || '|' ||
        COALESCE(xml_extract_text(t.trigger_xml, '/ScriptTrigger/@browseMode')[1], '') || '|' ||
        COALESCE(xml_extract_text(t.trigger_xml, '/ScriptTrigger/ScriptReference/@UUID')[1], '') || '|' ||
        t.Owner_Type
    )) as Owner_UUID,
    t.Owner_Type,

    fn.File_Name as File_Name

FROM all_triggers t
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(t.trigger_xml, '/ScriptTrigger/@id')[1] IS NOT NULL
ON CONFLICT (Trigger_ID, Owner_UUID, File_Name) DO UPDATE SET
    Trigger_Action = EXCLUDED.Trigger_Action,
    Trigger_BrowseMode = EXCLUDED.Trigger_BrowseMode,
    Script_ID = EXCLUDED.Script_ID,
    Script_Name = EXCLUDED.Script_Name,
    Script_UUID = EXCLUDED.Script_UUID,
    Owner_Type = EXCLUDED.Owner_Type;
-- @END_STREAMIFY_BLOCK@


-- ============================================
-- 23. ExtendedPrivilegesCatalog
-- ============================================
-- Erweiterte Berechtigungen (fmwebdirect, fmxdbc, fmapp, etc.)
-- Pattern: XPath mit UNNEST für PrivilegeSetReferences
CREATE TABLE IF NOT EXISTS ExtendedPrivilegesCatalog (
    EP_ID BIGINT,
    EP_Name VARCHAR,
    EP_Description VARCHAR,
    EP_UUID VARCHAR,
    PrivilegeSet_IDs BIGINT[],
    PrivilegeSet_Names VARCHAR[],
    File_Name VARCHAR,
    PRIMARY KEY (EP_UUID, File_Name)
);

-- @STREAMIFY_BLOCK:extendedprivilegescatalog@
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_privileges AS (
    SELECT
        unnest(xml_extract_elements(xml, '//ExtendedPrivilegesCatalog/ObjectList/ExtendedPrivilege')) as priv_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO ExtendedPrivilegesCatalog
SELECT
    xml_extract_text(priv_xml, '/ExtendedPrivilege/@id')[1]::BIGINT as EP_ID,
    xml_extract_text(priv_xml, '/ExtendedPrivilege/@name')[1] as EP_Name,
    xml_extract_text(priv_xml, '/ExtendedPrivilege/Description/text()')[1] as EP_Description,
    xml_extract_text(priv_xml, '/ExtendedPrivilege/UUID/text()')[1] as EP_UUID,

    -- Array of PrivilegeSet IDs und Namen
    list(xml_extract_text(ps_xml, '/PrivilegeSetReference/@id')[1]::BIGINT) as PrivilegeSet_IDs,
    list(xml_extract_text(ps_xml, '/PrivilegeSetReference/@name')[1]) as PrivilegeSet_Names,

    fn.File_Name as File_Name

FROM raw_privileges
CROSS JOIN filename_normalized fn
LEFT JOIN LATERAL (
    SELECT unnest(xml_extract_elements(priv_xml, '//ObjectList/PrivilegeSetReference')) as ps_xml
) ps ON true
GROUP BY EP_ID, EP_Name, EP_Description, EP_UUID, fn.File_Name
ON CONFLICT (EP_UUID, File_Name) DO UPDATE SET
    EP_ID = EXCLUDED.EP_ID,
    EP_Name = EXCLUDED.EP_Name,
    EP_Description = EXCLUDED.EP_Description,
    PrivilegeSet_IDs = EXCLUDED.PrivilegeSet_IDs,
    PrivilegeSet_Names = EXCLUDED.PrivilegeSet_Names;
-- @END_STREAMIFY_BLOCK@


-- ============================================
-- 24. CustomMenuCatalog
-- ============================================
-- Benutzerdefinierte Menüs mit verschachtelter Hierarchie
-- Pattern: XPath mit JSON für polymorphe Strukturen
CREATE TABLE IF NOT EXISTS CustomMenuCatalog (
    Menu_ID BIGINT,
    Menu_Name VARCHAR,
    Menu_UUID VARCHAR,
    Menu_XML VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Menu_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_menus AS (
    SELECT
        unnest(xml_extract_elements(xml, '//CustomMenuCatalog/CustomMenu')) as menu_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO CustomMenuCatalog
SELECT
    xml_extract_text(menu_xml, '/CustomMenu/@id')[1]::BIGINT as Menu_ID,
    xml_extract_text(menu_xml, '/CustomMenu/@name')[1] as Menu_Name,
    xml_extract_text(menu_xml, '/CustomMenu/UUID/text()')[1] as Menu_UUID,

    -- Vollständige Menü-Struktur als XML (enthält verschachtelte Items)
    menu_xml::VARCHAR as Menu_XML,

    fn.File_Name as File_Name

FROM raw_menus
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(menu_xml, '/CustomMenu/@id')[1] IS NOT NULL
ON CONFLICT (Menu_UUID, File_Name) DO UPDATE SET
    Menu_ID = EXCLUDED.Menu_ID,
    Menu_Name = EXCLUDED.Menu_Name,
    Menu_XML = EXCLUDED.Menu_XML;


-- ============================================
-- 24b. FileAccessAuthorizations  (Paket A.1, v4 §2)
-- ============================================
-- Datei-Zugriffsschutz: welche Dateien/Plugins dürfen diese Datei referenzieren.
-- Struktur (Tiefe 3, bleibt in main): <FileAccessCatalog @sameHost @required>
--   <UUID/> <ObjectList> <Authorization @id @type=Local|External [@self]>
--   <Source @CreationAccountName @CreationTimestamp/> <UUID>#text</UUID>
--   <Display>CDATA</Display> <Authentication>hash</Authentication> <TagList/>.
-- read_xml_objects + XPath (kein typisiertes record_element → kein globales Leck, §7).
CREATE TABLE IF NOT EXISTS FileAccessAuthorizations (
    Auth_ID BIGINT,
    Auth_Type VARCHAR,                  -- Local | External
    Is_Self BOOLEAN,
    Authorized_Name VARCHAR,            -- Display (CDATA): referenzierte Datei / Plugin
    Auth_UUID VARCHAR,
    Authentication_Hash VARCHAR,
    Source_CreationAccountName VARCHAR,
    Source_CreationTimestamp VARCHAR,
    Catalog_Required BOOLEAN,           -- FileAccessCatalog/@required (pro Datei konstant)
    Catalog_SameHost BOOLEAN,           -- FileAccessCatalog/@sameHost
    File_Name VARCHAR,
    PRIMARY KEY (Auth_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_auth AS (
    SELECT
        xml_extract_text(xml, '//FileAccessCatalog/@required')[1] as cat_required,
        xml_extract_text(xml, '//FileAccessCatalog/@sameHost')[1] as cat_samehost,
        unnest(xml_extract_elements(xml, '//FileAccessCatalog/ObjectList/Authorization')) as auth_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO FileAccessAuthorizations
SELECT
    xml_extract_text(auth_xml, '/Authorization/@id')[1]::BIGINT as Auth_ID,
    xml_extract_text(auth_xml, '/Authorization/@type')[1] as Auth_Type,
    (lower(coalesce(xml_extract_text(auth_xml, '/Authorization/@self')[1], '')) = 'true') as Is_Self,
    xml_extract_text(auth_xml, '/Authorization/Display/text()')[1] as Authorized_Name,
    xml_extract_text(auth_xml, '/Authorization/UUID/text()')[1] as Auth_UUID,
    xml_extract_text(auth_xml, '/Authorization/Authentication/text()')[1] as Authentication_Hash,
    xml_extract_text(auth_xml, '/Authorization/Source/@CreationAccountName')[1] as Source_CreationAccountName,
    xml_extract_text(auth_xml, '/Authorization/Source/@CreationTimestamp')[1] as Source_CreationTimestamp,
    (lower(coalesce(cat_required, '')) = 'true') as Catalog_Required,
    (lower(coalesce(cat_samehost, '')) = 'true') as Catalog_SameHost,
    fn.File_Name as File_Name
FROM raw_auth
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(auth_xml, '/Authorization/UUID/text()')[1] IS NOT NULL
ON CONFLICT (Auth_UUID, File_Name) DO UPDATE SET
    Auth_ID = EXCLUDED.Auth_ID,
    Auth_Type = EXCLUDED.Auth_Type,
    Is_Self = EXCLUDED.Is_Self,
    Authorized_Name = EXCLUDED.Authorized_Name,
    Authentication_Hash = EXCLUDED.Authentication_Hash,
    Source_CreationAccountName = EXCLUDED.Source_CreationAccountName,
    Source_CreationTimestamp = EXCLUDED.Source_CreationTimestamp,
    Catalog_Required = EXCLUDED.Catalog_Required,
    Catalog_SameHost = EXCLUDED.Catalog_SameHost;


-- ============================================
-- 24c. CustomMenuSetCatalog  (Paket A.2, v4 §2)
-- ============================================
-- Menü-Sets = benannte Sammlungen von Custom Menus, die ein Layout aktivieren kann.
-- Struktur (Tiefe 3, bleibt in main): <CustomMenuSetCatalog> … <ObjectList>
--   <CustomMenuSet @name @id @comment> <UUID>#text</UUID> <TagList/>
--   <CustomMenuList> <CustomMenuReference @name @id/> … </CustomMenuList> </CustomMenuSet>.
-- (Der Top-Level <CustomMenuSetReference> unter dem Katalog = Default-Set-Verweis, NICHT
--  in ObjectList → vom XPath ausgeschlossen.) Member-IDs/-Namen als Arrays; P4 entfaltet
--  sie zu CustomMenuSet→CustomMenu-Links (Auflösung per @id + File_Name, §7).
CREATE TABLE IF NOT EXISTS CustomMenuSetCatalog (
    MenuSet_ID BIGINT,
    MenuSet_Name VARCHAR,
    Comment VARCHAR,
    MenuSet_UUID VARCHAR,
    Member_Menu_IDs BIGINT[],
    Member_Menu_Names VARCHAR[],
    File_Name VARCHAR,
    PRIMARY KEY (MenuSet_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_menusets AS (
    SELECT
        unnest(xml_extract_elements(xml, '//CustomMenuSetCatalog/ObjectList/CustomMenuSet')) as ms_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO CustomMenuSetCatalog
SELECT
    xml_extract_text(ms_xml, '/CustomMenuSet/@id')[1]::BIGINT as MenuSet_ID,
    xml_extract_text(ms_xml, '/CustomMenuSet/@name')[1] as MenuSet_Name,
    xml_extract_text(ms_xml, '/CustomMenuSet/@comment')[1] as Comment,
    xml_extract_text(ms_xml, '/CustomMenuSet/UUID/text()')[1] as MenuSet_UUID,
    list(xml_extract_text(ref_xml, '/CustomMenuReference/@id')[1]::BIGINT)
        FILTER (WHERE ref_xml IS NOT NULL) as Member_Menu_IDs,
    list(xml_extract_text(ref_xml, '/CustomMenuReference/@name')[1])
        FILTER (WHERE ref_xml IS NOT NULL) as Member_Menu_Names,
    fn.File_Name as File_Name
FROM raw_menusets
CROSS JOIN filename_normalized fn
LEFT JOIN LATERAL (
    SELECT unnest(xml_extract_elements(ms_xml, '/CustomMenuSet/CustomMenuList/CustomMenuReference')) as ref_xml
) r ON true
WHERE xml_extract_text(ms_xml, '/CustomMenuSet/UUID/text()')[1] IS NOT NULL
GROUP BY MenuSet_ID, MenuSet_Name, Comment, MenuSet_UUID, fn.File_Name
ON CONFLICT (MenuSet_UUID, File_Name) DO UPDATE SET
    MenuSet_ID = EXCLUDED.MenuSet_ID,
    MenuSet_Name = EXCLUDED.MenuSet_Name,
    Comment = EXCLUDED.Comment,
    Member_Menu_IDs = EXCLUDED.Member_Menu_IDs,
    Member_Menu_Names = EXCLUDED.Member_Menu_Names;


-- ============================================
-- 24d. LibraryReferences  (Paket A.3 — Inventar, v4 §2)
-- ============================================
-- Eingebettete Medien-Bibliothek: <LibraryCatalog> <BinaryData>
--   <LibraryReference @id @key> + <StreamList> (Blobs). Wir behalten NUR die
--   Referenz-Schlüssel (key = Inhalts-Hash, über den Layout-Objekte/Themes das Bild
--   referenzieren) als schlankes Inventar. Die Blobs (~9,6 MB/Korpus) tragen keinen
--   Analysewert; ihr Byte-Schnitt im Phase-S-Preprocessing ist ein separater Schritt
--   (v4 §2 A.3 „Phase-S-Schnitt" / §8 — gebündelt mit der v3-Phase-S-Fusion). Diese
--   Tabelle ist unabhängig davon korrekt (parst die Referenzen, ob Blobs da sind oder nicht).
CREATE TABLE IF NOT EXISTS LibraryReferences (
    Library_ID BIGINT,
    Library_Key VARCHAR,                -- Inhalts-Hash (Where-used-Schlüssel für Bilder)
    File_Name VARCHAR,
    -- PK = (Library_ID, File_Name): eine Zeile je LibraryReference (@id eindeutig je Datei).
    -- NICHT nach Library_Key dedupen — dasselbe Bild (key) darf in mehreren Library-Slots
    -- liegen (Ooe: key 8985…DB60 unter id 10/15/16). Der key ist der Where-used-Join-Schlüssel
    -- (Layout/Theme → key), nicht der Identitäts-Schlüssel.
    PRIMARY KEY (Library_ID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_libref AS (
    SELECT
        unnest(xml_extract_elements(xml, '//LibraryCatalog/BinaryData/LibraryReference')) as ref_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO LibraryReferences
SELECT
    xml_extract_text(ref_xml, '/LibraryReference/@id')[1]::BIGINT as Library_ID,
    xml_extract_text(ref_xml, '/LibraryReference/@key')[1] as Library_Key,
    fn.File_Name as File_Name
FROM raw_libref
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(ref_xml, '/LibraryReference/@id')[1] IS NOT NULL
ON CONFLICT (Library_ID, File_Name) DO UPDATE SET
    Library_Key = EXCLUDED.Library_Key;


-- ============================================
-- 25. ThemeCatalog
-- ============================================
-- CSS-Regelsätze für Layouts
-- Pattern: XPath mit JSON für CSS-Strukturen
-- HINWEIS: Theme-Struktur ist sehr komplex mit CSS-Definitionen
CREATE TABLE IF NOT EXISTS ThemeCatalog (
    Theme_ID BIGINT,
    Theme_Name VARCHAR,
    Theme_UUID VARCHAR,
    Theme_XML VARCHAR,
    File_Name VARCHAR,
    PRIMARY KEY (Theme_UUID, File_Name)
);

WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
raw_themes AS (
    SELECT
        unnest(xml_extract_elements(xml, '//ThemeCatalog/Theme')) as theme_xml
    FROM read_xml_objects(getvariable('fm_xml'), maximum_file_size=getvariable('max_filesize'))
)
INSERT INTO ThemeCatalog
SELECT
    xml_extract_text(theme_xml, '/Theme/@id')[1]::BIGINT as Theme_ID,
    xml_extract_text(theme_xml, '/Theme/@name')[1] as Theme_Name,
    xml_extract_text(theme_xml, '/Theme/UUID/text()')[1] as Theme_UUID,

    -- Vollständige Theme-Struktur als JSON (enthält CSS-Regelsätze)
    theme_xml::VARCHAR as Theme_XML,

    fn.File_Name as File_Name

FROM raw_themes
CROSS JOIN filename_normalized fn
WHERE xml_extract_text(theme_xml, '/Theme/@id')[1] IS NOT NULL
ON CONFLICT (Theme_UUID, File_Name) DO UPDATE SET
    Theme_ID = EXCLUDED.Theme_ID,
    Theme_Name = EXCLUDED.Theme_Name,
    Theme_XML = EXCLUDED.Theme_XML;


-- ============================================
-- SchemaInfo aktualisieren
-- ============================================
-- Letzter Schritt: nach erfolgreichem Import den Schema-Stand persistieren.
-- Wenn der Lauf vorher abbricht, bleibt der alte SchemaInfo-Eintrag aktuell,
-- sodass die Detection beim nächsten Aufruf den Drift sauber erkennt.
INSERT INTO SchemaInfo (Schema_Version, Schema_Hash, Schema_Built_At, Builder_Notes)
VALUES (
    getvariable('schema_version'),
    getvariable('schema_hash'),
    CURRENT_TIMESTAMP,
    getvariable('schema_notes')
);


-- ============================================
-- IMPLEMENTIERUNGS-STATUS
-- ============================================
-- ✅ Phase 0: Basis-Kataloge (10 Tabellen)
-- ✅ Phase 1: Erweiterte Basis-Kataloge (5 Tabellen)
-- ✅ Phase 2: DDR_INFO Integration (3 Tabellen)
-- ✅ Phase 3: Layout-Objekte (1 Tabelle)
-- ✅ Phase 4: Optionale Kataloge (6 Tabellen)
-- ✅ Phase 5: SchemaInfo (Versionierung & Auto-Heal)
--
-- GESAMT: 26 Tabellen erfolgreich implementiert



