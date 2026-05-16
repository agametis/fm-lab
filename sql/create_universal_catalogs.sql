/*
-- Universal Catalog SQL Script
-- Erstellt VariableUsages, VariablesCatalog, ObjectCatalog und ObjectLinks
--
-- WICHTIG: Diese Datei wird NACH convert_xml.sql UND extract_xml_references.py ausgeführt!
-- Sie setzt voraus, dass:
--   1. Alle 25 Basis-Tabellen bereits befüllt sind (convert_xml.sql)
--   2. XMLLayoutReferences und XMLStepReferences existieren (extract_xml_references.py + CSV-Import)
--
-- Reihenfolge:
--   Phase 0: Import der XML-Referenz-CSVs (Python XML-Extraktor)
--   Phase A: Variablen-Parser (VariableUsages + VariablesCatalog)
--   Phase B: ObjectCatalog (inkl. Variablen als Variable)
--   Phase C: ObjectLinks (inkl. sets_variable/reads_variable/displays_variable)
--   Phase D: Statistik-Views
--
-- Usage:
--   1. Alle XML-Dateien importieren: convert-xml --batch (führt alles automatisch aus)
--   2. Oder manuell:
--      duckdb db/fm_catalog.duckdb -c "SET VARIABLE fm_xml = 'File.xml';" < sql/convert_xml.sql
--      python3 scripts/extract_xml_references.py
--      duckdb db/fm_catalog.duckdb < sql/create_universal_catalogs.sql
--
-- Version 0.3
-- Date: 2026-03-26
*/

-- ############################################################
-- Phase 0: XML-Referenzen (erstellt von convert_xml.sql)
-- ############################################################
-- XMLLayoutReferences und XMLStepReferences werden direkt in
-- convert_xml.sql per xml_extract_text() erzeugt.
-- Kein Python-Script oder CSV-Import mehr nötig.


-- ############################################################
-- Phase A: Variablen-Parser
-- ############################################################
-- Erstellt VariableUsages + VariablesCatalog aus:
-- 1. DDR_Calculations VariableReference Chunks (primär)
-- 2. StepsForScripts Set Variable Schritte
-- 3. MBS Superglobale (Regex auf Calculation_Text)
-- 4. Merge-Variables aus LayoutObjects
-- 5. Regex-Fallback für Dateien ohne DDR
-- ############################################################


-- ========================================
-- A.1: VariableUsages Tabelle
-- ========================================

DROP TABLE IF EXISTS VariableUsages;

CREATE TABLE VariableUsages (
    Variable_Name VARCHAR NOT NULL,
    Variable_Scope VARCHAR NOT NULL,       -- global, local, superglobal, let_local
    Usage_Type VARCHAR NOT NULL,           -- set, read
    Context_Type VARCHAR NOT NULL,         -- script_step, calculation, auto_enter_calc, custom_function, layout_object
    Context_UUID VARCHAR,
    Context_Name VARCHAR,
    Script_Name VARCHAR,
    Script_UUID VARCHAR,
    Step_Index INTEGER,
    Table_Name VARCHAR,
    Field_Name VARCHAR,
    Calc_Hash VARCHAR,
    Source VARCHAR NOT NULL,               -- set_variable_step, ddr_chunk, mbs_variable_call, merge_variable, regex_fallback
    File_Name VARCHAR NOT NULL
);


-- ========================================
-- A.2: Chunk_Type in DDR_Calculations materialisieren
-- ========================================

UPDATE DDR_Calculations
SET Chunk_Type = regexp_extract(Chunk_Content, '<Chunk type="([^"]+)"', 1)
WHERE Chunk_Type IS NULL
  AND Chunk_Content IS NOT NULL;


-- ========================================
-- A.3: DDR VariableReference Chunks → VariableUsages
-- ========================================
-- Vorab-Aggregation: pro (Calc_Hash, File_Name, Variable_Name) genau eine Zeile.
-- Verhindert Inflation durch (a) mehrfache Verwendung derselben Variable in einer
-- Formel (mehrere Chunk-Rows) und (b) shared Calc_Hashes über mehrere Calc_UUIDs
-- (z.B. wenn viele Felder dieselbe Formel haben → identischer Hash).

DROP TABLE IF EXISTS _DDR_VarRefs_Distinct;
CREATE TEMP TABLE _DDR_VarRefs_Distinct AS
SELECT DISTINCT
    Calc_Hash,
    File_Name,
    regexp_extract(Chunk_Content, '>([^<]+)</Chunk>', 1) as Variable_Name
FROM DDR_Calculations
WHERE Chunk_Type = 'VariableReference'
  AND regexp_extract(Chunk_Content, '>([^<]+)</Chunk>', 1) IS NOT NULL;

-- 3a: Variablen in Calculated Fields (FieldsForTables.DDR_Hash)
INSERT INTO VariableUsages
SELECT
    vr.Variable_Name,
    CASE
        WHEN vr.Variable_Name LIKE '$$%' THEN 'global'
        WHEN vr.Variable_Name LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'calculation' as Context_Type,
    f.Field_UUID as Context_UUID,
    f.Table_Name || '::' || f.Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    f.Table_Name,
    f.Field_Name,
    vr.Calc_Hash,
    'ddr_chunk' as Source,
    vr.File_Name
FROM _DDR_VarRefs_Distinct vr
JOIN FieldsForTables f ON vr.Calc_Hash = f.DDR_Hash AND vr.File_Name = f.File_Name;

-- 3b: Variablen in AutoEnter Calculated Fields (FieldsForTables.AE_Calc_Hash)
INSERT INTO VariableUsages
SELECT
    vr.Variable_Name,
    CASE
        WHEN vr.Variable_Name LIKE '$$%' THEN 'global'
        WHEN vr.Variable_Name LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'auto_enter_calc' as Context_Type,
    f.Field_UUID as Context_UUID,
    f.Table_Name || '::' || f.Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    f.Table_Name,
    f.Field_Name,
    vr.Calc_Hash,
    'ddr_chunk' as Source,
    vr.File_Name
FROM _DDR_VarRefs_Distinct vr
JOIN FieldsForTables f ON vr.Calc_Hash = f.AE_Calc_Hash AND vr.File_Name = f.File_Name
WHERE f.AE_Calc_Hash IS NOT NULL;

-- 3c: Variablen in CustomFunctions (CustomFunctionsCatalog.DDR_Hash)
INSERT INTO VariableUsages
SELECT
    vr.Variable_Name,
    CASE
        WHEN vr.Variable_Name LIKE '$$%' THEN 'global'
        WHEN vr.Variable_Name LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'custom_function' as Context_Type,
    cf.CF_UUID as Context_UUID,
    cf.CF_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    vr.Calc_Hash,
    'ddr_chunk' as Source,
    vr.File_Name
FROM _DDR_VarRefs_Distinct vr
JOIN CustomFunctionsCatalog cf ON vr.Calc_Hash = cf.DDR_Hash AND vr.File_Name = cf.File_Name
WHERE cf.DDR_Hash IS NOT NULL;

-- 3d: Variablen in Script-Schritt-Formeln
-- StepsForScripts.Parameters_XML enthält ChunkList-Hashes → DDR_Calculations.Calc_Hash
INSERT INTO VariableUsages
WITH step_hashes AS (
    SELECT
        Script_Name, Script_UUID, Step_Index, File_Name,
        unnest(regexp_extract_all(CAST(Parameters_XML AS VARCHAR),
            'kind="ChunkList" hash="([A-F0-9]+)"', 1)) as calc_hash
    FROM StepsForScripts
    WHERE Parameters_XML IS NOT NULL
      AND CAST(Parameters_XML AS VARCHAR) LIKE '%ChunkList%'
)
SELECT
    vr.Variable_Name,
    CASE
        WHEN vr.Variable_Name LIKE '$$%' THEN 'global'
        WHEN vr.Variable_Name LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'script_step' as Context_Type,
    s.Script_UUID as Context_UUID,
    s.Script_Name as Context_Name,
    s.Script_Name,
    s.Script_UUID,
    s.Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    vr.Calc_Hash,
    'ddr_chunk' as Source,
    vr.File_Name
FROM _DDR_VarRefs_Distinct vr
JOIN step_hashes s ON vr.Calc_Hash = s.calc_hash AND vr.File_Name = s.File_Name;

-- 3e: DDR-Variablen ohne zuordenbaren Kontext
INSERT INTO VariableUsages
SELECT
    vr.Variable_Name,
    CASE
        WHEN vr.Variable_Name LIKE '$$%' THEN 'global'
        WHEN vr.Variable_Name LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'calculation' as Context_Type,
    NULL as Context_UUID,
    NULL as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    vr.Calc_Hash,
    'ddr_chunk' as Source,
    vr.File_Name
FROM _DDR_VarRefs_Distinct vr
WHERE NOT EXISTS (
      SELECT 1 FROM FieldsForTables f
      WHERE (vr.Calc_Hash = f.DDR_Hash OR vr.Calc_Hash = f.AE_Calc_Hash)
        AND vr.File_Name = f.File_Name
  )
  AND NOT EXISTS (
      SELECT 1 FROM CustomFunctionsCatalog cf
      WHERE vr.Calc_Hash = cf.DDR_Hash AND vr.File_Name = cf.File_Name
  )
  AND NOT EXISTS (
      SELECT 1 FROM StepsForScripts s
      WHERE s.Parameters_XML IS NOT NULL
        AND CAST(s.Parameters_XML AS VARCHAR) LIKE '%' || vr.Calc_Hash || '%'
        AND vr.File_Name = s.File_Name
  )
  AND NOT EXISTS (
      SELECT 1 FROM LayoutObjects lo
      WHERE lo.Object_XML IS NOT NULL
        AND CAST(lo.Object_XML AS VARCHAR) LIKE '%' || vr.Calc_Hash || '%'
        AND lo.File_Name = vr.File_Name
  );

-- ========================================
-- A.3f: Variablen in LayoutObject-Formeln (Object_XML ChunkList-Hashes)
-- ========================================
-- Erfasst Variablen-Referenzen in:
-- Conditional Formatting, Hide Conditions, Tooltips, Platzhalter,
-- berechnete Labels, Portal-Filter, Web-Viewer-URLs, Tab-Panel-Titel,
-- Script-Parameter, Display Calculations, Popover-Titel
--
-- Alle diese Kontexte verwenden DDRREF kind="ChunkList" hash="..." in Object_XML.
-- Der Hash wird gegen DDR_Calculations aufgelöst um VariableReference-Chunks zu finden.

INSERT INTO VariableUsages
WITH lo_hashes AS (
    SELECT
        Object_UUID, Object_Type, Layout_ID, File_Name,
        unnest(regexp_extract_all(CAST(Object_XML AS VARCHAR),
            'kind="ChunkList" hash="([A-F0-9]+)"', 1)) as calc_hash
    FROM LayoutObjects
    WHERE Object_XML IS NOT NULL
      AND CAST(Object_XML AS VARCHAR) LIKE '%ChunkList%'
)
SELECT
    vr.Variable_Name,
    CASE
        WHEN vr.Variable_Name LIKE '$$%' THEN 'global'
        WHEN vr.Variable_Name LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'layout_object' as Context_Type,
    lo.Object_UUID as Context_UUID,
    l.L_Name || ' → ' || lo.Object_Type as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    vr.Calc_Hash,
    'ddr_chunk' as Source,
    vr.File_Name
FROM _DDR_VarRefs_Distinct vr
JOIN lo_hashes lo ON vr.Calc_Hash = lo.calc_hash AND vr.File_Name = lo.File_Name
JOIN Layouts l ON lo.Layout_ID = l.L_ID AND l.File_Name = lo.File_Name;


-- ========================================
-- A.4: Set Variable Schritte → VariableUsages
-- ========================================

INSERT INTO VariableUsages
SELECT
    Variable_Name,
    CASE WHEN Variable_Name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'set_variable_step' as Source,
    File_Name
FROM StepsForScripts
WHERE Step_Name = 'Set Variable'
  AND Variable_Name IS NOT NULL;


-- ========================================
-- A.4b: Target=Variable Script-Steps → VariableUsages
-- ========================================
-- Script-Steps die ihr Ergebnis in eine Variable schreiben:
-- Insert Text, Show Custom Dialog, Insert from URL, Insert Calculated Result,
-- Execute FileMaker Data API, Open/Read Data File, etc.
-- Generische Erkennung über <Variable value="$var">
-- LATERAL UNNEST für Multi-Target (z.B. Show Custom Dialog mit 3 Eingabefeldern)

INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'target_variable_step' as Source,
    File_Name
FROM StepsForScripts
CROSS JOIN LATERAL unnest(
    regexp_extract_all(CAST(Parameters_XML AS VARCHAR),
        '<Variable value="([^"]+)"', 1)
) as t(var_name)
WHERE Step_Name != 'Set Variable'
  AND CAST(Parameters_XML AS VARCHAR) LIKE '%<Variable value="%';


-- ========================================
-- A.5: MBS Superglobale → VariableUsages
-- ========================================

-- 5a: Variable.Set / FM.VariableSet in Script-Schritten
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:FM\.VariableSet|Variable\.Set)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM StepsForScripts
WHERE Calculation_Text LIKE '%Variable.Set%' OR Calculation_Text LIKE '%FM.VariableSet%'
  AND regexp_extract(Calculation_Text,
        '(?:FM\.VariableSet|Variable\.Set)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 5b: Variable.Get / FM.VariableGet / Variable.Exists / Variable.Lookup in Script-Schritten
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'read' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM StepsForScripts
WHERE (Calculation_Text LIKE '%Variable.Get%'
    OR Calculation_Text LIKE '%FM.VariableGet%'
    OR Calculation_Text LIKE '%Variable.Exists%'
    OR Calculation_Text LIKE '%Variable.Lookup%')
  AND regexp_extract(Calculation_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 5c: Variable.Append / Variable.AppendValue / Variable.AppendJSON / Variable.Add in Script-Schritten
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:Variable\.Append|Variable\.AppendValue|Variable\.AppendJSON|Variable\.Add)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM StepsForScripts
WHERE (Calculation_Text LIKE '%Variable.Append%'
    OR Calculation_Text LIKE '%Variable.AppendValue%'
    OR Calculation_Text LIKE '%Variable.AppendJSON%'
    OR Calculation_Text LIKE '%Variable.Add%')
  AND regexp_extract(Calculation_Text,
        '(?:Variable\.Append|Variable\.AppendValue|Variable\.AppendJSON|Variable\.Add)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 5d: Variable.Clear in Script-Schritten
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:Variable\.Clear)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'set' as Usage_Type,
    'script_step' as Context_Type,
    Script_UUID as Context_UUID,
    Script_Name as Context_Name,
    Script_Name,
    Script_UUID,
    Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM StepsForScripts
WHERE Calculation_Text LIKE '%Variable.Clear%'
  AND Calculation_Text NOT LIKE '%Variable.ClearAll%'
  AND regexp_extract(Calculation_Text,
        '(?:Variable\.Clear)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 5e: MBS Superglobale in Calculated Fields (FieldsForTables.Calculation_Text)
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'read' as Usage_Type,
    'calculation' as Context_Type,
    Field_UUID as Context_UUID,
    Table_Name || '::' || Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    Table_Name,
    Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM FieldsForTables
WHERE Calculation_Text IS NOT NULL
  AND (Calculation_Text LIKE '%Variable.Get%'
    OR Calculation_Text LIKE '%FM.VariableGet%'
    OR Calculation_Text LIKE '%Variable.Exists%'
    OR Calculation_Text LIKE '%Variable.Lookup%')
  AND regexp_extract(Calculation_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 5f: MBS Superglobale in AutoEnter Calculated Fields (FieldsForTables.AE_Calc_Text)
INSERT INTO VariableUsages
SELECT
    regexp_extract(AE_Calc_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    'read' as Usage_Type,
    'auto_enter_calc' as Context_Type,
    Field_UUID as Context_UUID,
    Table_Name || '::' || Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    Table_Name,
    Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM FieldsForTables
WHERE AE_Calc_Text IS NOT NULL
  AND (AE_Calc_Text LIKE '%Variable.Get%'
    OR AE_Calc_Text LIKE '%FM.VariableGet%'
    OR AE_Calc_Text LIKE '%Variable.Exists%'
    OR AE_Calc_Text LIKE '%Variable.Lookup%')
  AND regexp_extract(AE_Calc_Text,
        '(?:FM\.VariableGet|Variable\.Get|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;

-- 5g: MBS Superglobale in CustomFunctions (CalcsForCustomFunctions.Calculation_Code)
INSERT INTO VariableUsages
SELECT
    regexp_extract(Calculation_Code,
        '(?:FM\.VariableGet|Variable\.Get|FM\.VariableSet|Variable\.Set|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) as Variable_Name,
    'superglobal' as Variable_Scope,
    CASE
        WHEN Calculation_Code LIKE '%Variable.Set%' OR Calculation_Code LIKE '%FM.VariableSet%' THEN 'set'
        ELSE 'read'
    END as Usage_Type,
    'custom_function' as Context_Type,
    CF_UUID as Context_UUID,
    CF_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'mbs_variable_call' as Source,
    File_Name
FROM CalcsForCustomFunctions
WHERE Calculation_Code IS NOT NULL
  AND (Calculation_Code LIKE '%Variable.Get%'
    OR Calculation_Code LIKE '%FM.VariableGet%'
    OR Calculation_Code LIKE '%Variable.Set%'
    OR Calculation_Code LIKE '%FM.VariableSet%'
    OR Calculation_Code LIKE '%Variable.Exists%'
    OR Calculation_Code LIKE '%Variable.Lookup%')
  AND regexp_extract(Calculation_Code,
        '(?:FM\.VariableGet|Variable\.Get|FM\.VariableSet|Variable\.Set|Variable\.Exists|Variable\.Lookup)\s*"\s*;\s*"([^"]+)"', 1) IS NOT NULL;


-- ========================================
-- A.6: Merge-Variables aus LayoutObjects → VariableUsages
-- ========================================

INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'layout_object' as Context_Type,
    lo.Object_UUID as Context_UUID,
    l.L_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'merge_variable' as Source,
    lo.File_Name
FROM LayoutObjects lo
JOIN Layouts l ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
CROSS JOIN LATERAL unnest(
    regexp_extract_all(lo.Text_Content, '<<(\$\$?[^>]+)>>', 1)
) as t(var_name)
WHERE lo.Object_Type = 'Text'
  AND lo.Text_Content LIKE '%<<%$%>>%';


-- ========================================
-- A.6b: Script-Trigger-Parameter → VariableUsages
-- ========================================
-- Layout-Objekte mit Script-Triggern, deren Parameter Variablen referenzieren

INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'layout_object' as Context_Type,
    lo.Object_UUID as Context_UUID,
    l.L_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'script_trigger_param' as Source,
    lo.File_Name
FROM LayoutObjects lo
JOIN Layouts l ON lo.Layout_ID = l.L_ID AND lo.File_Name = l.File_Name
CROSS JOIN LATERAL unnest(
    regexp_extract_all(lo.ScriptTrigger_Parameter_Text,
        '\$\$?[a-zA-Z_][a-zA-Z0-9_ ]*')
) as t(var_name)
WHERE lo.ScriptTrigger_Parameter_Text IS NOT NULL
  AND lo.ScriptTrigger_Parameter_Text LIKE '%$%';


-- ========================================
-- A.7: Regex-Fallback für Dateien ohne DDR
-- ========================================

-- 7a: Regex-Variablen aus Script-Schritt-Formeln (nur Dateien ohne DDR)
INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'script_step' as Context_Type,
    s.Script_UUID as Context_UUID,
    s.Script_Name as Context_Name,
    s.Script_Name,
    s.Script_UUID,
    s.Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'regex_fallback' as Source,
    s.File_Name
FROM StepsForScripts s
JOIN XMLMetadata m ON s.File_Name = m.Filename
CROSS JOIN LATERAL unnest(
    regexp_extract_all(s.Calculation_Text, '\$\$?[a-zA-Z_][a-zA-Z0-9_]*')
) as t(var_name)
WHERE m.Has_DDR_INFO = 'False'
  AND s.Calculation_Text IS NOT NULL
  AND s.Step_Name != 'Set Variable';

-- 7b: Regex-Variablen aus Calculated Fields (nur Dateien ohne DDR)
INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'calculation' as Context_Type,
    f.Field_UUID as Context_UUID,
    f.Table_Name || '::' || f.Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    f.Table_Name,
    f.Field_Name,
    NULL as Calc_Hash,
    'regex_fallback' as Source,
    f.File_Name
FROM FieldsForTables f
JOIN XMLMetadata m ON f.File_Name = m.Filename
CROSS JOIN LATERAL unnest(
    regexp_extract_all(f.Calculation_Text, '\$\$?[a-zA-Z_][a-zA-Z0-9_]*')
) as t(var_name)
WHERE m.Has_DDR_INFO = 'False'
  AND f.Calculation_Text IS NOT NULL;

-- 7c: Regex-Variablen aus AutoEnter Calculated Fields (nur Dateien ohne DDR)
INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'auto_enter_calc' as Context_Type,
    f.Field_UUID as Context_UUID,
    f.Table_Name || '::' || f.Field_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    f.Table_Name,
    f.Field_Name,
    NULL as Calc_Hash,
    'regex_fallback' as Source,
    f.File_Name
FROM FieldsForTables f
JOIN XMLMetadata m ON f.File_Name = m.Filename
CROSS JOIN LATERAL unnest(
    regexp_extract_all(f.AE_Calc_Text, '\$\$?[a-zA-Z_][a-zA-Z0-9_]*')
) as t(var_name)
WHERE m.Has_DDR_INFO = 'False'
  AND f.AE_Calc_Text IS NOT NULL;

-- 7d: Regex-Variablen aus CustomFunction-Formeln (nur Dateien ohne DDR)
INSERT INTO VariableUsages
SELECT
    var_name as Variable_Name,
    CASE WHEN var_name LIKE '$$%' THEN 'global' ELSE 'local' END as Variable_Scope,
    'read' as Usage_Type,
    'custom_function' as Context_Type,
    ccf.CF_UUID as Context_UUID,
    ccf.CF_Name as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    NULL as Table_Name,
    NULL as Field_Name,
    NULL as Calc_Hash,
    'regex_fallback' as Source,
    ccf.File_Name
FROM CalcsForCustomFunctions ccf
JOIN XMLMetadata m ON ccf.File_Name = m.Filename
CROSS JOIN LATERAL unnest(
    regexp_extract_all(ccf.Calculation_Code, '\$\$?[a-zA-Z_][a-zA-Z0-9_]*')
) as t(var_name)
WHERE m.Has_DDR_INFO = 'False'
  AND ccf.Calculation_Code IS NOT NULL;


-- ========================================
-- A.7e: Scope_Anchor in VariableUsages materialisieren
-- ========================================
-- Bindet die Variablen-Identität an den FileMaker-Scope-Träger:
--   superglobal → '__global'           (prozessweit)
--   global      → File_Name            (datei-lokal)
--   local       → Script_UUID          (script-lokal, sofern vorhanden)
--                 '__file::'||File_Name (Fallback bei Calc/CF/Layout-Kontext ohne Script)
--   let_local   → Context_UUID || '__file::'||File_Name
ALTER TABLE VariableUsages ADD COLUMN IF NOT EXISTS Scope_Anchor VARCHAR;

UPDATE VariableUsages
SET Scope_Anchor = CASE
    WHEN Variable_Scope = 'superglobal' THEN '__global'
    WHEN Variable_Scope = 'global'      THEN File_Name
    WHEN Variable_Scope = 'local' AND Script_UUID IS NOT NULL THEN Script_UUID
    WHEN Variable_Scope = 'local' AND Script_UUID IS NULL     THEN '__file::' || File_Name
    WHEN Variable_Scope = 'let_local'   THEN COALESCE(Context_UUID, '__file::' || File_Name)
    ELSE File_Name
END;


-- ========================================
-- A.8: VariablesCatalog (Aggregation)
-- ========================================

DROP TABLE IF EXISTS VariablesCatalog;

CREATE TABLE VariablesCatalog AS
SELECT
    Variable_Name,
    Variable_Scope,
    Scope_Anchor,
    CASE Variable_Scope
        WHEN 'local' THEN Variable_Name
        WHEN 'global' THEN Variable_Name
        WHEN 'superglobal' THEN '$$$' || regexp_replace(Variable_Name, '^\$+', '')
        ELSE Variable_Name
    END as Display_Name,
    regexp_replace(Variable_Name, '^\$+', '') as Normalized_Name,
    -- Script_UUID nur bei script-lokalen Variablen (Anker = Script_UUID, kein '__file::'-Fallback)
    CASE WHEN Variable_Scope = 'local' AND Scope_Anchor NOT LIKE '__file::%'
         THEN Scope_Anchor
         ELSE NULL
    END as Script_UUID,
    COUNT(*) FILTER (WHERE Usage_Type = 'set') as Set_Count,
    COUNT(*) FILTER (WHERE Usage_Type = 'read') as Read_Count,
    COUNT(DISTINCT Script_Name) as Script_Count,
    COUNT(DISTINCT File_Name) as File_Count,
    array_agg(DISTINCT File_Name ORDER BY File_Name) as Files,
    first(Context_Name) as First_Seen_Context,
    Variable_Name LIKE '% %' as Has_Spaces,
    CASE WHEN bool_or(Source = 'ddr_chunk') THEN 'ddr'
         WHEN bool_or(Source IN ('set_variable_step', 'target_variable_step')) THEN 'step'
         WHEN bool_or(Source = 'mbs_variable_call') THEN 'mbs'
         WHEN bool_or(Source = 'merge_variable') THEN 'merge'
         WHEN bool_or(Source = 'script_trigger_param') THEN 'trigger'
         ELSE 'regex'
    END as Source_Reliability,
    -- File_Name = Datei, in der diese Scope-Instanz wohnt:
    --   global: Anker = File_Name (datei-lokal)
    --   local mit Script-Anker: einzige Datei dieses Scripts (durch mode garantiert)
    --   local ohne Script (Fallback '__file::X'): X
    --   superglobal: häufigste Datei (informativ)
    CASE
        WHEN Variable_Scope = 'global' THEN Scope_Anchor
        WHEN Variable_Scope = 'local' AND Scope_Anchor LIKE '__file::%'
            THEN substr(Scope_Anchor, 9)
        ELSE mode(File_Name)
    END as File_Name
FROM VariableUsages
GROUP BY Variable_Name, Variable_Scope, Scope_Anchor;

-- Indizes für VariableUsages/VariablesCatalog
CREATE INDEX IF NOT EXISTS idx_varusages_name ON VariableUsages(Variable_Name);
CREATE INDEX IF NOT EXISTS idx_varusages_scope ON VariableUsages(Variable_Scope);
CREATE INDEX IF NOT EXISTS idx_varusages_context ON VariableUsages(Context_UUID);
CREATE INDEX IF NOT EXISTS idx_varusages_file ON VariableUsages(File_Name);
CREATE INDEX IF NOT EXISTS idx_varusages_anchor ON VariableUsages(Scope_Anchor);
CREATE INDEX IF NOT EXISTS idx_varcatalog_scope ON VariablesCatalog(Variable_Scope);
CREATE INDEX IF NOT EXISTS idx_varcatalog_file ON VariablesCatalog(File_Name);
CREATE INDEX IF NOT EXISTS idx_varcatalog_anchor ON VariablesCatalog(Scope_Anchor);
CREATE INDEX IF NOT EXISTS idx_varcatalog_name ON VariablesCatalog(Variable_Name);

-- Variablen-Parser Statistik
SELECT '=== Variablen-Parser Ergebnis ===' as Info;

SELECT Source, COUNT(*) as Anzahl_Usages
FROM VariableUsages GROUP BY Source ORDER BY Anzahl_Usages DESC;

SELECT
    'Gesamt VariableUsages' as Metrik, COUNT(*)::VARCHAR as Wert FROM VariableUsages
UNION ALL SELECT 'Gesamt VariablesCatalog', COUNT(*)::VARCHAR FROM VariablesCatalog
UNION ALL SELECT 'Davon global', COUNT(*)::VARCHAR FROM VariablesCatalog WHERE Variable_Scope = 'global'
UNION ALL SELECT 'Davon lokal', COUNT(*)::VARCHAR FROM VariablesCatalog WHERE Variable_Scope = 'local'
UNION ALL SELECT 'Davon superglobal', COUNT(*)::VARCHAR FROM VariablesCatalog WHERE Variable_Scope = 'superglobal'
UNION ALL SELECT 'Davon let_local', COUNT(*)::VARCHAR FROM VariablesCatalog WHERE Variable_Scope = 'let_local';


-- ############################################################
-- Phase A.5: FolderHierarchy
-- ############################################################
-- Vereinheitlichte Hierarchie für Folder-Strukturen aller Objekttypen.
-- FileMaker modelliert Folder als sequenzielle Marker im XML:
--   isFolder='True'   → Ordner-Beginn (+1 Tiefe)
--   isFolder='Marker' → Ordner-Ende  (−1 Tiefe)
--   isSeparatorItem='True' → Trennlinie (kein Folder, nur UI)
--
-- Subtypen werden über Source_Table unterschieden:
--   ScriptCatalog → Script-Folder
--   Layouts       → Layout-Folder
--   FM 2026+: CustomFunctionsCatalog → CustomFunction-Folder (UNION-Zweig ergänzen)
-- ############################################################

CREATE OR REPLACE VIEW FolderHierarchy AS
WITH all_items AS (
    -- Scripts: Sequence_ID = XML-Reihenfolge (NICHT Script_ID, das ist Anlege-Reihenfolge!)
    SELECT
        Script_UUID AS Source_UUID,
        Script_Name AS Item_Name,
        File_Name,
        Sequence_ID,
        Folder_Type,
        Is_Separator,
        'ScriptCatalog' AS Source_Table
    FROM ScriptCatalog

    UNION ALL

    -- Layouts: Sequence_ID = XML-Reihenfolge (analog zu Scripts)
    SELECT
        L_UUID AS Source_UUID,
        L_Name AS Item_Name,
        File_Name,
        Sequence_ID,
        Folder_Type,
        Is_Separator,
        'Layouts' AS Source_Table
    FROM Layouts

    -- FM 2026+: CustomFunctionsCatalog hier als dritter UNION-Zweig ergänzen,
    -- sobald isFolder/isSeparatorItem dort verfügbar sind.
),
numbered AS (
    SELECT *,
        ROW_NUMBER() OVER (PARTITION BY File_Name, Source_Table
                           ORDER BY Sequence_ID) - 1 AS seq
    FROM all_items
),
with_levels AS (
    SELECT *,
        -- Stack-Logik: kumulative Summe bis VOR der aktuellen Zeile.
        -- 'True' öffnet einen Folder (+1), 'Marker' schließt ihn (−1).
        GREATEST(0, COALESCE(
            SUM(CASE WHEN Folder_Type = 'True'   THEN 1
                     WHEN Folder_Type = 'Marker' THEN -1
                     ELSE 0 END)
            OVER (PARTITION BY File_Name, Source_Table ORDER BY seq
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
        , 0)) AS nesting_level,
        CASE
            WHEN Is_Separator           THEN 'Separator'
            WHEN Folder_Type = 'True'   THEN 'Folder'
            WHEN Folder_Type = 'Marker' THEN 'FolderEnd'
            ELSE                             'Item'
        END AS subtype
    FROM numbered
)
SELECT
    t.Source_UUID,
    t.Item_Name,
    t.File_Name,
    t.Source_Table,
    t.Sequence_ID,
    t.seq,
    t.Folder_Type,
    t.Is_Separator,
    t.nesting_level,
    t.subtype,
    -- Parent_Folder_UUID: letzter offener Folder mit nesting_level = current - 1
    -- und seq < current. Korrelierte Subquery — DuckDB optimiert das.
    (
        SELECT p.Source_UUID
        FROM with_levels p
        WHERE p.File_Name    = t.File_Name
          AND p.Source_Table = t.Source_Table
          AND p.subtype      = 'Folder'
          AND p.nesting_level = t.nesting_level - 1
          AND p.seq          < t.seq
        ORDER BY p.seq DESC
        LIMIT 1
    ) AS Parent_Folder_UUID
FROM with_levels t;


-- ############################################################
-- Phase B: ObjectCatalog
-- ############################################################

-- ========================================
-- ObjectCatalog - Universelle Objektsuche
-- ========================================
-- Aggregiert ALLE Objekte aus allen 25 Tabellen
-- Ermöglicht schnelle Suche über alle Objekttypen hinweg

CREATE OR REPLACE TABLE ObjectCatalog AS

-- 1. BaseTableCatalog (Base Tables)
SELECT
    BT_UUID as Object_UUID,
    'BaseTable' as Object_Type,
    BT_Name as Object_Name,
    File_Name,
    'BaseTableCatalog' as Source_Table,
    BT_ID as Object_ID
FROM BaseTableCatalog

UNION ALL

-- 2. TableOccurrenceCatalog (Table Occurrences)
SELECT
    TO_UUID as Object_UUID,
    'TableOccurrence' as Object_Type,
    TO_Name as Object_Name,
    File_Name,
    'TableOccurrenceCatalog' as Source_Table,
    TO_ID as Object_ID
FROM TableOccurrenceCatalog

UNION ALL

-- 3. RelationshipCatalog (Relationships)
-- HINWEIS: Relationships haben keine UUID, verwenden Rel_ID + File_Name als Composite Key
SELECT
    Rel_ID::VARCHAR || '_' || File_Name as Object_UUID,
    'Relationship' as Object_Type,
    Left_TO_Name || ' → ' || Right_TO_Name as Object_Name,
    File_Name,
    'RelationshipCatalog' as Source_Table,
    Rel_ID as Object_ID
FROM RelationshipCatalog

UNION ALL

-- 4. FieldsForTables (Fields)
SELECT
    Field_UUID as Object_UUID,
    'Field' as Object_Type,
    Table_Name || '::' || Field_Name as Object_Name,
    File_Name,
    'FieldsForTables' as Source_Table,
    Field_ID as Object_ID
FROM FieldsForTables

UNION ALL

-- 5. ValueListCatalog (Value Lists)
SELECT
    VL_UUID as Object_UUID,
    'ValueList' as Object_Type,
    VL_Name as Object_Name,
    File_Name,
    'ValueListCatalog' as Source_Table,
    VL_ID as Object_ID
FROM ValueListCatalog

UNION ALL

-- 6. CustomFunctionsCatalog (Custom Functions)
SELECT
    CF_UUID as Object_UUID,
    'CustomFunction' as Object_Type,
    CF_Name as Object_Name,
    File_Name,
    'CustomFunctionsCatalog' as Source_Table,
    CF_ID as Object_ID
FROM CustomFunctionsCatalog

UNION ALL

-- 7. ScriptCatalog (Scripts - ohne Folders und Separators)
SELECT
    Script_UUID as Object_UUID,
    'Script' as Object_Type,
    Script_Name as Object_Name,
    File_Name,
    'ScriptCatalog' as Source_Table,
    Script_ID as Object_ID
FROM ScriptCatalog
WHERE (Folder_Type IS NULL OR Folder_Type = 'False')
  AND NOT Is_Separator

UNION ALL

-- 8. StepsForScripts (Script Steps)
SELECT
    Step_UUID as Object_UUID,
    'ScriptStep' as Object_Type,
    Script_Name || ' [' || Step_Index || '] ' || Step_Name as Object_Name,
    File_Name,
    'StepsForScripts' as Source_Table,
    Step_ID as Object_ID
FROM StepsForScripts

UNION ALL

-- 9. Layouts (Layouts - ohne Folders und Separators)
-- Folder/Marker-Records werden als 'Folder' separat aufgenommen (siehe Block 24)
SELECT
    L_UUID as Object_UUID,
    'Layout' as Object_Type,
    L_Name as Object_Name,
    File_Name,
    'Layouts' as Source_Table,
    L_ID as Object_ID
FROM Layouts
WHERE (Folder_Type IS NULL OR Folder_Type = 'False')
  AND NOT COALESCE(Is_Separator, FALSE)

UNION ALL

-- 10. LayoutParts (Layout Parts)
-- HINWEIS: LayoutParts haben keine UUID, verwenden Layout_ID + Part_Kind + File_Name
SELECT
    Layout_ID::VARCHAR || '_' || Part_Kind::VARCHAR || '_' || File_Name as Object_UUID,
    'LayoutPart' as Object_Type,
    Layout_Name || ' [' || Part_Type || ']' as Object_Name,
    File_Name,
    'LayoutParts' as Source_Table,
    Layout_ID as Object_ID
FROM LayoutParts

UNION ALL

-- 11. LayoutObjects (Layout Objects)
-- Display-Name-Default für unnamed LayoutObjects: 'Object_Type @ (Top,Left)',
-- z.B. 'Edit Box @ (123,45)'. Bounds machen das Element auf dem Layout
-- lokalisierbar; der vorherige Default 'Type #ID' war abstrakt.
SELECT
    Object_UUID as Object_UUID,
    'LayoutObject' as Object_Type,
    COALESCE(
        NULLIF(Object_Name, ''),
        Object_Type || ' @ (' || COALESCE(Bounds_Top, 0) || ',' || COALESCE(Bounds_Left, 0) || ')'
    ) as Object_Name,
    File_Name,
    'LayoutObjects' as Source_Table,
    Object_ID as Object_ID
FROM LayoutObjects

UNION ALL

-- 12. AccountsCatalog (Accounts)
SELECT
    Account_UUID as Object_UUID,
    'Account' as Object_Type,
    COALESCE(Account_Name, Description) as Object_Name,
    File_Name,
    'AccountsCatalog' as Source_Table,
    Account_ID as Object_ID
FROM AccountsCatalog

UNION ALL

-- 13. PrivilegeSetsCatalog (Privilege Sets)
SELECT
    PrivilegeSet_UUID as Object_UUID,
    'PrivilegeSet' as Object_Type,
    PrivilegeSet_Name as Object_Name,
    File_Name,
    'PrivilegeSetsCatalog' as Source_Table,
    PrivilegeSet_ID as Object_ID
FROM PrivilegeSetsCatalog

UNION ALL

-- 14./15. DDR_ScriptSteps und DDR_Calculations:
-- Bewusst NICHT als ObjectCatalog-Einträge geführt. Step_UUID und Calc_UUID
-- sind Rückreferenzen auf den Host (ScriptStep, LayoutObject, Field, CustomFunction),
-- keine eigenständigen Identitäten. Doppelte Catalog-Einträge mit identischer UUID
-- führten zu falsch-positiven Referenz-Anzeigen. Die DDR-Tabellen werden weiterhin
-- direkt über Step_UUID / Calc_Hash in den Detail-Templates referenziert.

-- 16. PasteIndexList (Paste Index Objects)
SELECT
    Object_ID::VARCHAR || '_' || File_Name as Object_UUID,
    'PasteIndexObject' as Object_Type,
    'Paste Object #' || Object_ID as Object_Name,
    File_Name,
    'PasteIndexList' as Source_Table,
    Object_ID as Object_ID
FROM PasteIndexList

UNION ALL

-- 17. BaseDirectoryCatalog (Base Directories)
SELECT
    BD_UUID as Object_UUID,
    'BaseDirectory' as Object_Type,
    BD_Name as Object_Name,
    File_Name,
    'BaseDirectoryCatalog' as Source_Table,
    BD_ID as Object_ID
FROM BaseDirectoryCatalog

UNION ALL

-- 18. ScriptTriggers (Script Triggers)
SELECT
    Trigger_ID::VARCHAR || '_' || File_Name as Object_UUID,
    'ScriptTrigger' as Object_Type,
    Trigger_Action || ' → ' || Script_Name as Object_Name,
    File_Name,
    'ScriptTriggers' as Source_Table,
    Trigger_ID as Object_ID
FROM ScriptTriggers

UNION ALL

-- 19. ExtendedPrivilegesCatalog (Extended Privileges)
SELECT
    EP_UUID as Object_UUID,
    'ExtendedPrivilege' as Object_Type,
    EP_Name as Object_Name,
    File_Name,
    'ExtendedPrivilegesCatalog' as Source_Table,
    EP_ID as Object_ID
FROM ExtendedPrivilegesCatalog

UNION ALL

-- 20. CustomMenuCatalog (Custom Menus)
SELECT
    Menu_UUID as Object_UUID,
    'CustomMenu' as Object_Type,
    Menu_Name as Object_Name,
    File_Name,
    'CustomMenuCatalog' as Source_Table,
    Menu_ID as Object_ID
FROM CustomMenuCatalog

UNION ALL

-- 21. ThemeCatalog (Themes)
SELECT
    Theme_UUID as Object_UUID,
    'Theme' as Object_Type,
    Theme_Name as Object_Name,
    File_Name,
    'ThemeCatalog' as Source_Table,
    Theme_ID as Object_ID
FROM ThemeCatalog

UNION ALL

-- 22. ExternalDataSourceCatalog (External Data Sources)
SELECT
    DS_UUID as Object_UUID,
    'ExternalDataSource' as Object_Type,
    DS_Name as Object_Name,
    File_Name,
    'ExternalDataSourceCatalog' as Source_Table,
    DS_ID as Object_ID
FROM ExternalDataSourceCatalog

UNION ALL

-- 23. VariablesCatalog (alle Variablen)
-- UUID = md5(Scope || Scope_Anchor || Name) — eine Identität pro Scope-Instanz
SELECT
    md5(Variable_Scope || '::' || Scope_Anchor || '::' || Variable_Name) as Object_UUID,
    'Variable' as Object_Type,
    Display_Name as Object_Name,
    File_Name,
    'VariablesCatalog' as Source_Table,
    NULL as Object_ID
FROM VariablesCatalog
WHERE Variable_Scope IN ('global', 'local', 'superglobal')

UNION ALL

-- 24. FolderHierarchy (Folder für Scripts/Layouts/CustomFunctions)
-- Object_Type='Folder' für ALLE Folder-Arten; Source_Table dient als Subtype-Diskriminator.
-- Separators werden NICHT in ObjectCatalog aufgenommen (reine UI-Marker, siehe FolderHierarchy-View).
SELECT
    Source_UUID as Object_UUID,
    'Folder' as Object_Type,
    Item_Name as Object_Name,
    File_Name,
    Source_Table,
    NULL as Object_ID
FROM FolderHierarchy
WHERE subtype = 'Folder'

UNION ALL

-- 25. BuiltinFunction (synthetisch)
-- PRD prd_universal_function_links.md §5: ein Eintrag pro distinct FunctionRef-Token
-- aus XMLCalcReferences (Ref_Type='function'). Built-ins sind lösungs-unabhängig
-- → File_Name = NULL. Bei Get(<SubParameter>) erzeugt jeder SubParameter einen
-- eigenen Eintrag (Object_Name = 'Get(<SubParameter>)'); zusätzlich existiert der
-- nackte 'Get'-Eintrag (Ref_SubName IS NULL).
-- Lokalisierte Token-Schreibweisen erzeugen mehrere Einträge mit unterschiedlicher
-- Object_UUID (Reference-DB-Anreicherung mappt sie zur Query-Zeit auf canonical_name).
SELECT DISTINCT
    md5('BuiltinFunction::' ||
        CASE WHEN Ref_Name = 'Get' AND Ref_SubName IS NOT NULL
             THEN Ref_Name || '::' || Ref_SubName
             ELSE Ref_Name END
    ) as Object_UUID,
    'BuiltinFunction' as Object_Type,
    CASE WHEN Ref_Name = 'Get' AND Ref_SubName IS NOT NULL
         THEN 'Get(' || Ref_SubName || ')'
         ELSE Ref_Name END as Object_Name,
    NULL as File_Name,
    'DDR_Calculations' as Source_Table,
    NULL as Object_ID
FROM XMLCalcReferences
WHERE Ref_Type = 'function'
  AND Ref_Name IS NOT NULL
  AND Ref_Name != ''

UNION ALL

-- 26. PluginFunction (synthetisch)
-- PRD prd_universal_function_links.md §6: ein Eintrag pro (Plugin_Function_Name, SubName).
-- Container-Plugins (heute: MBS) erzeugen pro SubName einen Eintrag; Non-Container-Plugins
-- einen Eintrag pro registriertem Calc-Token.
-- Object_Name folgt der Konvention 'Plugin::SubName' für Container-Plugins,
-- 'Plugin' für Non-Container-Plugins (siehe PRD §6.4).
-- Dynamische MBS-Aufrufe (SubName IS NULL) werden ausgefiltert.
SELECT DISTINCT
    md5('PluginFunction::' || pfu.Plugin_Function_Name || '::' ||
        COALESCE(msm.SubName, '')) as Object_UUID,
    'PluginFunction' as Object_Type,
    CASE WHEN msm.SubName IS NOT NULL
         THEN pfu.Plugin_Function_Name || '::' || msm.SubName
         ELSE pfu.Plugin_Function_Name END as Object_Name,
    NULL as File_Name,
    'PluginFunctionUsages' as Source_Table,
    NULL as Object_ID
FROM PluginFunctionUsages pfu
LEFT JOIN MBS_SubnameMap msm
  ON msm.Calc_UUID = pfu.Calc_UUID
 AND msm.File_Name = pfu.File_Name
 AND msm.Plugin_Chunk_Index = pfu.Plugin_Chunk_Index
WHERE pfu.Plugin_Function_Name IS NOT NULL
  AND pfu.Plugin_Function_Name != ''
  AND (msm.SubName IS NOT NULL OR pfu.Plugin_Function_Name != 'MBS')

UNION ALL

-- 27. ScriptStepType (synthetisch, Token-Aggregat)
-- PRD prd_pseudo_object_types_filter.md §6.1: ein Eintrag pro distinct Step_Name
-- aus StepsForScripts. ScriptStepTypes sind lösungs-unabhängig → File_Name = NULL.
-- Die Verwendungs-Anzahl wird im Detail-Template direkt aus StepsForScripts aggregiert
-- (keine zusätzlichen ObjectLinks — vgl. PRD §6.4 / §4 Begründung).
SELECT DISTINCT
    md5('ScriptStepType::' || Step_Name) as Object_UUID,
    'ScriptStepType' as Object_Type,
    Step_Name as Object_Name,
    NULL as File_Name,
    'StepsForScripts' as Source_Table,
    NULL as Object_ID
FROM StepsForScripts
WHERE Step_Name IS NOT NULL
  AND Step_Name != '';

-- ========================================
-- PluginComponent (synthetisch, Category-Aggregat)
-- ========================================
-- PRD prd_pseudo_object_types_filter.md §6.2: Komponenten-Mapping aus
--   1) data/mbs_component_exceptions.csv (autoritativ, ~1.021 Mappings)
--   2) Default-Heuristik split_part(SubName, '.', 1)
-- Object_Name folgt der Konvention 'MBS::<Component>' (z.B. 'MBS::XL').
-- Wird als separater INSERT nach dem CREATE eingefügt, weil die Auflösung
-- auf die bereits existierenden PluginFunction-Einträge des ObjectCatalog
-- zugreift (CSV-Lookup gegen 'MBS::SubName'-Object_Name).
-- File_Name = NULL (lösungs-unabhängig, vgl. PRD §5).
--
-- Voraussetzung: convert_fm_xml.sh führt den DuckDB-Lauf im Repo-Root aus,
-- sodass der relative CSV-Pfad auflösbar ist (cd in convert_fm_xml.sh).
-- Falls die CSV nicht existiert, greift die Default-Heuristik (read_csv-Fehler
-- müsste durch existierende CSV vermieden werden).
INSERT INTO ObjectCatalog (Object_UUID, Object_Type, Object_Name, File_Name, Source_Table, Object_ID)
WITH component_map AS (
    SELECT
        Funktionsname AS function_name,
        Component     AS component_name
    FROM read_csv('data/mbs_component_exceptions.csv', header=true)
),
resolved AS (
    SELECT DISTINCT
        regexp_replace(pf.Object_Name, '^MBS::', '') AS sub_name,
        COALESCE(
            cm.component_name,
            split_part(regexp_replace(pf.Object_Name, '^MBS::', ''), '.', 1)
        ) AS component_name
    FROM ObjectCatalog pf
    LEFT JOIN component_map cm
      ON cm.function_name = regexp_replace(pf.Object_Name, '^MBS::', '')
    WHERE pf.Object_Type = 'PluginFunction'
      AND pf.Object_Name LIKE 'MBS::%'
)
SELECT DISTINCT
    md5('PluginComponent::MBS::' || component_name) as Object_UUID,
    'PluginComponent' as Object_Type,
    'MBS::' || component_name as Object_Name,
    NULL as File_Name,
    'data/mbs_component_exceptions.csv' as Source_Table,
    NULL as Object_ID
FROM resolved
WHERE component_name IS NOT NULL
  AND component_name != '';

-- Indexes für ObjectCatalog
CREATE INDEX idx_objectcatalog_type ON ObjectCatalog(Object_Type);
CREATE INDEX idx_objectcatalog_file ON ObjectCatalog(File_Name);
CREATE INDEX idx_objectcatalog_name ON ObjectCatalog(Object_Name);
CREATE INDEX idx_objectcatalog_composite ON ObjectCatalog(Object_Type, File_Name);


-- ========================================
-- ObjectLinks - Verknüpfungen zwischen Objekten
-- ========================================
-- Extrahiert alle operationalen Links aus den Basis-Tabellen
-- Ermöglicht Cross-File Abhängigkeitsanalyse
--
-- WICHTIG: Is_Cross_File wird durch JOIN mit ObjectCatalog berechnet,
-- um die tatsächlichen File_Names der Source- und Target-Objekte zu vergleichen.

CREATE OR REPLACE TABLE ObjectLinks AS

-- 1. Relationships → Table Occurrences (Left)
SELECT
    rc.Rel_ID::VARCHAR || '_' || rc.File_Name as Source_UUID,
    'Relationship' as Source_Type,
    rc.Left_TO_UUID as Target_UUID,
    'TableOccurrence' as Target_Type,
    'operational' as Link_Type,
    'left_table' as Link_Role,
    NULL as Link_Subrole,
    rc.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (rc.File_Name != oc_target.File_Name) as Is_Cross_File
FROM RelationshipCatalog rc
LEFT JOIN ObjectCatalog oc_target ON rc.Left_TO_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'TableOccurrence'

UNION ALL

-- 2. Relationships → Table Occurrences (Right)
SELECT
    rc.Rel_ID::VARCHAR || '_' || rc.File_Name as Source_UUID,
    'Relationship' as Source_Type,
    rc.Right_TO_UUID as Target_UUID,
    'TableOccurrence' as Target_Type,
    'operational' as Link_Type,
    'right_table' as Link_Role,
    NULL as Link_Subrole,
    rc.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (rc.File_Name != oc_target.File_Name) as Is_Cross_File
FROM RelationshipCatalog rc
LEFT JOIN ObjectCatalog oc_target ON rc.Right_TO_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'TableOccurrence'

UNION ALL

-- 3. Relationships → Fields (Left Field)
SELECT
    rc.Rel_ID::VARCHAR || '_' || rc.File_Name as Source_UUID,
    'Relationship' as Source_Type,
    rc.Left_Field_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'left_field' as Link_Role,
    NULL as Link_Subrole,
    rc.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (rc.File_Name != oc_target.File_Name) as Is_Cross_File
FROM RelationshipCatalog rc
LEFT JOIN ObjectCatalog oc_target ON rc.Left_Field_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Field'

UNION ALL

-- 4. Relationships → Fields (Right Field)
SELECT
    rc.Rel_ID::VARCHAR || '_' || rc.File_Name as Source_UUID,
    'Relationship' as Source_Type,
    rc.Right_Field_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'right_field' as Link_Role,
    NULL as Link_Subrole,
    rc.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (rc.File_Name != oc_target.File_Name) as Is_Cross_File
FROM RelationshipCatalog rc
LEFT JOIN ObjectCatalog oc_target ON rc.Right_Field_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Field'

UNION ALL

-- 5. Fields → Base Tables
SELECT
    f.Field_UUID as Source_UUID,
    'Field' as Source_Type,
    f.Table_UUID as Target_UUID,
    'BaseTable' as Target_Type,
    'operational' as Link_Type,
    'parent_table' as Link_Role,
    NULL as Link_Subrole,
    f.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (f.File_Name != oc_target.File_Name) as Is_Cross_File
FROM FieldsForTables f
LEFT JOIN ObjectCatalog oc_target ON f.Table_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'BaseTable'

UNION ALL

-- 6. Table Occurrences → Base Tables
SELECT
    toc.TO_UUID as Source_UUID,
    'TableOccurrence' as Source_Type,
    toc.BT_UUID as Target_UUID,
    'BaseTable' as Target_Type,
    'operational' as Link_Type,
    'base_table' as Link_Role,
    NULL as Link_Subrole,
    toc.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (toc.File_Name != oc_target.File_Name) as Is_Cross_File
FROM TableOccurrenceCatalog toc
LEFT JOIN ObjectCatalog oc_target ON toc.BT_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'BaseTable'

UNION ALL

-- 7. Table Occurrences → External Data Sources
SELECT
    toc.TO_UUID as Source_UUID,
    'TableOccurrence' as Source_Type,
    toc.DS_UUID as Target_UUID,
    'ExternalDataSource' as Target_Type,
    'operational' as Link_Type,
    'data_source' as Link_Role,
    NULL as Link_Subrole,
    toc.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (toc.File_Name != oc_target.File_Name) as Is_Cross_File
FROM TableOccurrenceCatalog toc
LEFT JOIN ObjectCatalog oc_target ON toc.DS_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'ExternalDataSource'
WHERE toc.DS_UUID IS NOT NULL

UNION ALL

-- 8. Layouts → Table Occurrences
SELECT
    l.L_UUID as Source_UUID,
    'Layout' as Source_Type,
    (SELECT TO_UUID FROM TableOccurrenceCatalog WHERE TO_Name = l.L_TO_Name AND File_Name = l.File_Name LIMIT 1) as Target_UUID,
    'TableOccurrence' as Target_Type,
    'operational' as Link_Type,
    'context_table' as Link_Role,
    NULL as Link_Subrole,
    l.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (l.File_Name != oc_target.File_Name) as Is_Cross_File
FROM Layouts l
LEFT JOIN ObjectCatalog oc_target ON (SELECT TO_UUID FROM TableOccurrenceCatalog WHERE TO_Name = l.L_TO_Name AND File_Name = l.File_Name LIMIT 1) = oc_target.Object_UUID AND oc_target.Object_Type = 'TableOccurrence'

UNION ALL

-- 9. Layout Objects → Layouts (Parent)
-- Link_Type 'operational': pragmatisch betrachtet ist "LayoutObject liegt auf
-- Layout X" eine funktionale Information (welches Layout zeigt dieses Element?),
-- nicht nur eine reine Container-Hierarchie. Macht den Link in Standard-
-- Reference-Listen sichtbar (Frontend-Default ist Link_Type='operational').
SELECT
    lo.Object_UUID as Source_UUID,
    'LayoutObject' as Source_Type,
    (SELECT L_UUID FROM Layouts WHERE L_ID = lo.Layout_ID AND File_Name = lo.File_Name LIMIT 1) as Target_UUID,
    'Layout' as Target_Type,
    'operational' as Link_Type,
    'parent_layout' as Link_Role,
    NULL as Link_Subrole,
    lo.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (lo.File_Name != oc_target.File_Name) as Is_Cross_File
FROM LayoutObjects lo
LEFT JOIN ObjectCatalog oc_target ON (SELECT L_UUID FROM Layouts WHERE L_ID = lo.Layout_ID AND File_Name = lo.File_Name LIMIT 1) = oc_target.Object_UUID AND oc_target.Object_Type = 'Layout'

UNION ALL

-- 10. Layout Objects → Layout Objects (Parent-Child, nur wenn verschachtelt)
SELECT
    child.Object_UUID as Source_UUID,
    'LayoutObject' as Source_Type,
    (SELECT Object_UUID FROM LayoutObjects parent WHERE parent.Object_ID = child.Parent_Object_ID AND parent.Layout_ID = child.Layout_ID AND parent.File_Name = child.File_Name LIMIT 1) as Target_UUID,
    'LayoutObject' as Target_Type,
    'structural' as Link_Type,
    'parent_object' as Link_Role,
    NULL as Link_Subrole,
    child.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (child.File_Name != oc_target.File_Name) as Is_Cross_File
FROM LayoutObjects child
LEFT JOIN ObjectCatalog oc_target ON (SELECT Object_UUID FROM LayoutObjects parent WHERE parent.Object_ID = child.Parent_Object_ID AND parent.Layout_ID = child.Layout_ID AND parent.File_Name = child.File_Name LIMIT 1) = oc_target.Object_UUID AND oc_target.Object_Type = 'LayoutObject'
WHERE child.Parent_Object_ID IS NOT NULL

UNION ALL

-- 11. Script Steps → Scripts (Parent)
SELECT
    sfs.Step_UUID as Source_UUID,
    'ScriptStep' as Source_Type,
    sfs.Script_UUID as Target_UUID,
    'Script' as Target_Type,
    'structural' as Link_Type,
    'parent_script' as Link_Role,
    NULL as Link_Subrole,
    sfs.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (sfs.File_Name != oc_target.File_Name) as Is_Cross_File
FROM StepsForScripts sfs
LEFT JOIN ObjectCatalog oc_target ON sfs.Script_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Script'

UNION ALL

-- 12. Value Lists → Fields (Field Reference für Value List)
SELECT
    ovl.VL_UUID as Source_UUID,
    'ValueList' as Source_Type,
    ovl.Field_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'source_field' as Link_Role,
    NULL as Link_Subrole,
    ovl.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (ovl.File_Name != oc_target.File_Name) as Is_Cross_File
FROM OptionsForValueLists ovl
LEFT JOIN ObjectCatalog oc_target ON ovl.Field_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Field'
WHERE ovl.Field_UUID IS NOT NULL

UNION ALL

-- 13. Value Lists → Table Occurrences
SELECT
    ovl.VL_UUID as Source_UUID,
    'ValueList' as Source_Type,
    ovl.TO_UUID as Target_UUID,
    'TableOccurrence' as Target_Type,
    'operational' as Link_Type,
    'source_table' as Link_Role,
    NULL as Link_Subrole,
    ovl.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (ovl.File_Name != oc_target.File_Name) as Is_Cross_File
FROM OptionsForValueLists ovl
LEFT JOIN ObjectCatalog oc_target ON ovl.TO_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'TableOccurrence'
WHERE ovl.TO_UUID IS NOT NULL

UNION ALL

-- 14. Custom Functions → Custom Functions (via CalcsForCustomFunctions)
-- HINWEIS: Keine direkte Verknüpfung in diesem Schema, könnte über DDR_Calculations analysiert werden

-- 15. Script → Script (Perform Script Steps)
-- Extrahiert aus XMLStepReferences (Python XML-Extraktor, umgeht webbed JSON-Bugs)
SELECT
    xsr.Script_UUID as Source_UUID,
    'Script' as Source_Type,
    xsr.Ref_UUID as Target_UUID,
    'Script' as Target_Type,
    'operational' as Link_Type,
    'calls_script' as Link_Role,
    NULL as Link_Subrole,
    xsr.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (xsr.File_Name != oc_target.File_Name) as Is_Cross_File
FROM XMLStepReferences xsr
LEFT JOIN ObjectCatalog oc_target ON xsr.Ref_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Script'
WHERE xsr.Ref_Type = 'script'

UNION ALL

-- 16. Script → Field (alle Step-Typen mit FieldReference)
-- Extrahiert aus XMLStepReferences (PRD prd_universal_field_refs_in_steps.md §4.3)
-- Differenzierte Link-Rollen pro Step-Typ-Gruppe:
--   sets_field         — Step schreibt/verändert den Feldinhalt
--   reads_field        — Step liest aus dem Feld
--   navigates_to_field — Step springt zum Feld (Cursor-Positionierung)
--   finds_in_field     — Feld dient als Such-Kriterium
--   sorts_by_field     — Feld dient als Sortier-Kriterium
--   imports_to_field   — Feld ist Import-Ziel
--   exports_from_field — Feld ist Export-Quelle
--   inputs_to_field    — Feld nimmt Dialog-Eingabe entgegen
--   references_field   — Fallback für unbekannte Step-Typen
SELECT
    xsr.Script_UUID as Source_UUID,
    'Script' as Source_Type,
    xsr.Ref_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    CASE xsr.Step_Name
        WHEN 'Set Field' THEN 'sets_field'
        WHEN 'Replace Field Contents' THEN 'sets_field'
        WHEN 'Insert Calculated Result' THEN 'sets_field'
        WHEN 'Insert Text' THEN 'sets_field'
        WHEN 'Insert File' THEN 'sets_field'
        WHEN 'Insert from URL' THEN 'sets_field'
        WHEN 'Paste' THEN 'sets_field'
        WHEN 'Clear' THEN 'sets_field'
        WHEN 'Set Selection' THEN 'sets_field'
        WHEN 'Set Next Serial Value' THEN 'sets_field'
        WHEN 'Relookup Field Contents' THEN 'sets_field'
        WHEN 'Copy' THEN 'reads_field'
        WHEN 'Export Field Contents' THEN 'reads_field'
        WHEN 'Go to Field' THEN 'navigates_to_field'
        WHEN 'Go to Related Record' THEN 'navigates_to_field'
        WHEN 'Perform Find' THEN 'finds_in_field'
        WHEN 'Constrain Found Set' THEN 'finds_in_field'
        WHEN 'Extend Found Set' THEN 'finds_in_field'
        WHEN 'Enter Find Mode' THEN 'finds_in_field'
        WHEN 'Sort Records' THEN 'sorts_by_field'
        WHEN 'Import Records' THEN 'imports_to_field'
        WHEN 'Export Records' THEN 'exports_from_field'
        WHEN 'Show Custom Dialog' THEN 'inputs_to_field'
        ELSE 'references_field'
    END as Link_Role,
    NULL as Link_Subrole,
    xsr.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (xsr.File_Name != oc_target.File_Name) as Is_Cross_File
FROM XMLStepReferences xsr
LEFT JOIN ObjectCatalog oc_target ON xsr.Ref_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Field'
WHERE xsr.Ref_Type = 'field'

UNION ALL

-- 18. Script Triggers → Scripts
SELECT
    st.Trigger_ID::VARCHAR || '_' || st.File_Name as Source_UUID,
    'ScriptTrigger' as Source_Type,
    st.Script_UUID as Target_UUID,
    'Script' as Target_Type,
    'operational' as Link_Type,
    'trigger_script' as Link_Role,
    NULL as Link_Subrole,
    st.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (st.File_Name != oc_target.File_Name) as Is_Cross_File
FROM ScriptTriggers st
LEFT JOIN ObjectCatalog oc_target ON st.Script_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Script'

UNION ALL

-- 19. Accounts → Privilege Sets
SELECT
    ac.Account_UUID as Source_UUID,
    'Account' as Source_Type,
    (SELECT PrivilegeSet_UUID FROM PrivilegeSetsCatalog WHERE PrivilegeSet_Name = ac.PrivilegeSet_Name AND File_Name = ac.File_Name LIMIT 1) as Target_UUID,
    'PrivilegeSet' as Target_Type,
    'operational' as Link_Type,
    'privilege_set' as Link_Role,
    NULL as Link_Subrole,
    ac.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (ac.File_Name != oc_target.File_Name) as Is_Cross_File
FROM AccountsCatalog ac
LEFT JOIN ObjectCatalog oc_target ON (SELECT PrivilegeSet_UUID FROM PrivilegeSetsCatalog WHERE PrivilegeSet_Name = ac.PrivilegeSet_Name AND File_Name = ac.File_Name LIMIT 1) = oc_target.Object_UUID AND oc_target.Object_Type = 'PrivilegeSet'

UNION ALL

-- 20. LayoutObject → Field (Edit Box, Drop-down List, etc.)
-- Extrahiert aus XMLLayoutReferences (Python XML-Extraktor, umgeht webbed JSON-Bugs)
SELECT
    xlr.Object_UUID as Source_UUID,
    'LayoutObject' as Source_Type,
    xlr.Ref_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'displays_field' as Link_Role,
    NULL as Link_Subrole,
    xlr.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (xlr.File_Name != oc_target.File_Name) as Is_Cross_File
FROM XMLLayoutReferences xlr
LEFT JOIN ObjectCatalog oc_target ON xlr.Ref_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Field'
WHERE xlr.Ref_Type = 'field'

UNION ALL

-- 21. LayoutObject → Script (Button/GroupedButton/PopoverButton Actions)
-- Extrahiert aus XMLLayoutReferences (Python XML-Extraktor, findet auch GroupedButton)
SELECT
    xlr.Object_UUID as Source_UUID,
    'LayoutObject' as Source_Type,
    xlr.Ref_UUID as Target_UUID,
    'Script' as Target_Type,
    'operational' as Link_Type,
    'triggers_script' as Link_Role,
    NULL as Link_Subrole,
    xlr.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (xlr.File_Name != oc_target.File_Name) as Is_Cross_File
FROM XMLLayoutReferences xlr
LEFT JOIN ObjectCatalog oc_target ON xlr.Ref_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Script'
WHERE xlr.Ref_Type = 'script'

UNION ALL

-- 22. LayoutObject → ValueList (Field Display)
-- Extrahiert aus XMLLayoutReferences (Ref_Type = 'valuelist')
SELECT
    xlr.Object_UUID as Source_UUID,
    'LayoutObject' as Source_Type,
    xlr.Ref_UUID as Target_UUID,
    'ValueList' as Target_Type,
    'operational' as Link_Type,
    'uses_valuelist' as Link_Role,
    NULL as Link_Subrole,
    xlr.File_Name as Source_File,
    COALESCE(oc_target.File_Name, xlr.File_Name) as Target_File,
    (xlr.File_Name != COALESCE(oc_target.File_Name, xlr.File_Name)) as Is_Cross_File
FROM XMLLayoutReferences xlr
LEFT JOIN ObjectCatalog oc_target ON xlr.Ref_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'ValueList'
WHERE xlr.Ref_Type = 'valuelist'

UNION ALL

-- 23. Portal → TableOccurrence (Portal Data Source)
-- Extrahiert aus XMLLayoutReferences (Ref_Type = 'table_occurrence')
SELECT
    xlr.Object_UUID as Source_UUID,
    'LayoutObject' as Source_Type,
    xlr.Ref_UUID as Target_UUID,
    'TableOccurrence' as Target_Type,
    'operational' as Link_Type,
    'portal_context' as Link_Role,
    NULL as Link_Subrole,
    xlr.File_Name as Source_File,
    COALESCE(oc_target.File_Name, xlr.File_Name) as Target_File,
    (xlr.File_Name != COALESCE(oc_target.File_Name, xlr.File_Name)) as Is_Cross_File
FROM XMLLayoutReferences xlr
LEFT JOIN ObjectCatalog oc_target ON xlr.Ref_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'TableOccurrence'
WHERE xlr.Ref_Type = 'table_occurrence'

UNION ALL

-- 24. Script → Layout (Go to Layout Steps)
-- Extrahiert aus XMLStepReferences (Ref_Type = 'layout')
SELECT
    xsr.Script_UUID as Source_UUID,
    'Script' as Source_Type,
    xsr.Ref_UUID as Target_UUID,
    'Layout' as Target_Type,
    'operational' as Link_Type,
    'navigates_to_layout' as Link_Role,
    NULL as Link_Subrole,
    xsr.File_Name as Source_File,
    COALESCE(oc_target.File_Name, xsr.File_Name) as Target_File,
    (xsr.File_Name != COALESCE(oc_target.File_Name, xsr.File_Name)) as Is_Cross_File
FROM XMLStepReferences xsr
LEFT JOIN ObjectCatalog oc_target ON xsr.Ref_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Layout'
WHERE xsr.Ref_Type = 'layout'

UNION ALL

-- 25. Field → Field (Lookup-Quelle)
-- Link: Zielfeld hat Lookup auf Quellfeld
SELECT
    f.Field_UUID as Source_UUID,
    'Field' as Source_Type,
    f.Lookup_Field_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'lookup_source' as Link_Role,
    NULL as Link_Subrole,
    f.File_Name as Source_File,
    COALESCE(oc_target.File_Name, f.File_Name) as Target_File,
    (f.File_Name != COALESCE(oc_target.File_Name, f.File_Name)) as Is_Cross_File
FROM FieldsForTables f
LEFT JOIN ObjectCatalog oc_target ON f.Lookup_Field_UUID = oc_target.Object_UUID
WHERE f.AutoEnter_Type = 'Looked_up'
  AND f.Lookup_Field_UUID IS NOT NULL

UNION ALL

-- 23. Field → TableOccurrence (Lookup-Beziehung)
-- Link: Zielfeld nutzt diese Beziehung für den Lookup
SELECT
    f.Field_UUID as Source_UUID,
    'Field' as Source_Type,
    f.Lookup_TO_UUID as Target_UUID,
    'TableOccurrence' as Target_Type,
    'operational' as Link_Type,
    'lookup_relationship' as Link_Role,
    NULL as Link_Subrole,
    f.File_Name as Source_File,
    COALESCE(oc_target.File_Name, f.File_Name) as Target_File,
    (f.File_Name != COALESCE(oc_target.File_Name, f.File_Name)) as Is_Cross_File
FROM FieldsForTables f
LEFT JOIN ObjectCatalog oc_target ON f.Lookup_TO_UUID = oc_target.Object_UUID
WHERE f.AutoEnter_Type = 'Looked_up'
  AND f.Lookup_TO_UUID IS NOT NULL

UNION ALL

-- ========================================
-- Variable Links (24-29)
-- ========================================

-- 24. Script → Variable (sets_variable)
-- Script setzt eine Variable via Set Variable Schritt
SELECT DISTINCT
    vu.Script_UUID as Source_UUID,
    'Script' as Source_Type,
    md5(vu.Variable_Scope || '::' || vu.Scope_Anchor || '::' || vu.Variable_Name) as Target_UUID,
    'Variable' as Target_Type,
    'operational' as Link_Type,
    'sets_variable' as Link_Role,
    NULL as Link_Subrole,
    vu.File_Name as Source_File,
    vc.File_Name as Target_File,
    CASE WHEN vu.Variable_Scope IN ('local', 'global') THEN FALSE
         ELSE (vu.File_Name != vc.File_Name)
    END as Is_Cross_File
FROM VariableUsages vu
JOIN VariablesCatalog vc
    ON vu.Variable_Name  = vc.Variable_Name
   AND vu.Variable_Scope = vc.Variable_Scope
   AND vu.Scope_Anchor   = vc.Scope_Anchor
WHERE vu.Usage_Type = 'set'
  AND vu.Context_Type = 'script_step'
  AND vu.Variable_Scope IN ('global', 'local', 'superglobal')
  AND vu.Script_UUID IS NOT NULL

UNION ALL

-- 25. Script → Variable (reads_variable)
-- Script-Formel referenziert eine Variable
SELECT DISTINCT
    vu.Script_UUID as Source_UUID,
    'Script' as Source_Type,
    md5(vu.Variable_Scope || '::' || vu.Scope_Anchor || '::' || vu.Variable_Name) as Target_UUID,
    'Variable' as Target_Type,
    'operational' as Link_Type,
    'reads_variable' as Link_Role,
    NULL as Link_Subrole,
    vu.File_Name as Source_File,
    vc.File_Name as Target_File,
    CASE WHEN vu.Variable_Scope IN ('local', 'global') THEN FALSE
         ELSE (vu.File_Name != vc.File_Name)
    END as Is_Cross_File
FROM VariableUsages vu
JOIN VariablesCatalog vc
    ON vu.Variable_Name  = vc.Variable_Name
   AND vu.Variable_Scope = vc.Variable_Scope
   AND vu.Scope_Anchor   = vc.Scope_Anchor
WHERE vu.Usage_Type = 'read'
  AND vu.Context_Type = 'script_step'
  AND vu.Variable_Scope IN ('global', 'local', 'superglobal')
  AND vu.Script_UUID IS NOT NULL

UNION ALL

-- 26. Field → Variable (reads_variable)
-- Calculated/AutoEnter-Formel referenziert eine Variable
SELECT DISTINCT
    vu.Context_UUID as Source_UUID,
    'Field' as Source_Type,
    md5(vu.Variable_Scope || '::' || vu.Scope_Anchor || '::' || vu.Variable_Name) as Target_UUID,
    'Variable' as Target_Type,
    'operational' as Link_Type,
    'reads_variable' as Link_Role,
    NULL as Link_Subrole,
    vu.File_Name as Source_File,
    vc.File_Name as Target_File,
    CASE WHEN vu.Variable_Scope IN ('local', 'global') THEN FALSE
         ELSE (vu.File_Name != vc.File_Name)
    END as Is_Cross_File
FROM VariableUsages vu
JOIN VariablesCatalog vc
    ON vu.Variable_Name  = vc.Variable_Name
   AND vu.Variable_Scope = vc.Variable_Scope
   AND vu.Scope_Anchor   = vc.Scope_Anchor
WHERE vu.Usage_Type = 'read'
  AND vu.Context_Type IN ('calculation', 'auto_enter_calc')
  AND vu.Variable_Scope IN ('global', 'local', 'superglobal')
  AND vu.Context_UUID IS NOT NULL

UNION ALL

-- 27. CustomFunction → Variable (reads_variable / sets_variable)
-- CF-Formel referenziert oder setzt eine Variable (z.B. MBS Superglobale)
SELECT DISTINCT
    vu.Context_UUID as Source_UUID,
    'CustomFunction' as Source_Type,
    md5(vu.Variable_Scope || '::' || vu.Scope_Anchor || '::' || vu.Variable_Name) as Target_UUID,
    'Variable' as Target_Type,
    'operational' as Link_Type,
    CASE vu.Usage_Type WHEN 'set' THEN 'sets_variable' ELSE 'reads_variable' END as Link_Role,
    NULL as Link_Subrole,
    vu.File_Name as Source_File,
    vc.File_Name as Target_File,
    CASE WHEN vu.Variable_Scope IN ('local', 'global') THEN FALSE
         ELSE (vu.File_Name != vc.File_Name)
    END as Is_Cross_File
FROM VariableUsages vu
JOIN VariablesCatalog vc
    ON vu.Variable_Name  = vc.Variable_Name
   AND vu.Variable_Scope = vc.Variable_Scope
   AND vu.Scope_Anchor   = vc.Scope_Anchor
WHERE vu.Context_Type = 'custom_function'
  AND vu.Variable_Scope IN ('global', 'local', 'superglobal')
  AND vu.Context_UUID IS NOT NULL

UNION ALL

-- 28. LayoutObject → Variable (alle Quellen: Merge, Script-Trigger, DDR-Formeln)
-- merge_variable → displays_variable, alle anderen → reads_variable
SELECT DISTINCT
    vu.Context_UUID as Source_UUID,
    'LayoutObject' as Source_Type,
    md5(vu.Variable_Scope || '::' || vu.Scope_Anchor || '::' || vu.Variable_Name) as Target_UUID,
    'Variable' as Target_Type,
    'operational' as Link_Type,
    CASE vu.Source
        WHEN 'merge_variable' THEN 'displays_variable'
        ELSE 'reads_variable'
    END as Link_Role,
    NULL as Link_Subrole,
    vu.File_Name as Source_File,
    vc.File_Name as Target_File,
    CASE WHEN vu.Variable_Scope IN ('local', 'global') THEN FALSE
         ELSE (vu.File_Name != vc.File_Name)
    END as Is_Cross_File
FROM VariableUsages vu
JOIN VariablesCatalog vc
    ON vu.Variable_Name  = vc.Variable_Name
   AND vu.Variable_Scope = vc.Variable_Scope
   AND vu.Scope_Anchor   = vc.Scope_Anchor
WHERE vu.Context_Type = 'layout_object'
  AND vu.Variable_Scope IN ('global', 'local')
  AND vu.Context_UUID IS NOT NULL

UNION ALL

-- 29. Item/Sub-Folder → Folder (parent_folder, structural)
-- Verbindet Scripts/Layouts mit ihrem direkten Parent-Folder und Sub-Folder mit ihrem Parent-Folder.
-- Source_Type wird aus subtype + Source_Table abgeleitet.
-- Hinweis: parent_folder ist NICHT mit parent_object zu verwechseln — letzteres ist
-- die Layout-interne Objekt-Hierarchie (Group/Tab/Portal-Children).
SELECT
    fh.Source_UUID as Source_UUID,
    CASE
        WHEN fh.subtype = 'Folder' THEN 'Folder'
        WHEN fh.Source_Table = 'ScriptCatalog' THEN 'Script'
        WHEN fh.Source_Table = 'Layouts' THEN 'Layout'
        WHEN fh.Source_Table = 'CustomFunctionsCatalog' THEN 'CustomFunction'
    END as Source_Type,
    fh.Parent_Folder_UUID as Target_UUID,
    'Folder' as Target_Type,
    'structural' as Link_Type,
    'parent_folder' as Link_Role,
    NULL as Link_Subrole,
    fh.File_Name as Source_File,
    fh.File_Name as Target_File,
    FALSE as Is_Cross_File
FROM FolderHierarchy fh
WHERE fh.Parent_Folder_UUID IS NOT NULL
  AND fh.subtype IN ('Folder', 'Item')

UNION ALL

-- ========================================
-- Erweiterte Referenz-Auflösung (PRD prd_referenzen_extendet.md)
-- ========================================

-- 30. Calc-Source → Field (reads_field)
-- Quelle: XMLCalcReferences — alle Field-Referenzen aus DDR-Calc-Chunks.
-- Cross-File ist möglich: der Calc-Chunk liegt in der nutzenden Datei,
-- die Field-UUID kann auf eine andere Datei zeigen.
-- DISTINCT verhindert Aufblähung durch redundante DDRREF-Vorkommen im XML
-- (gleicher Hash kann z.B. in einem Layout 128x referenziert werden, wenn
-- alle Sub-Elemente dieselbe Hide-Calc nutzen). Ein Source-Target-Subrole-
-- Tupel bleibt eindeutig — Mehrfacherwähnung wird kollabiert.
SELECT DISTINCT
    xcr.Source_UUID as Source_UUID,
    xcr.Source_Type as Source_Type,
    xcr.Ref_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'reads_field' as Link_Role,
    xcr.Subrole as Link_Subrole,
    xcr.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (xcr.File_Name != oc_target.File_Name) as Is_Cross_File
FROM XMLCalcReferences xcr
JOIN ObjectCatalog oc_target
  ON xcr.Ref_UUID = oc_target.Object_UUID
 AND oc_target.Object_Type = 'Field'
WHERE xcr.Ref_Type = 'field'
  AND xcr.Ref_UUID IS NOT NULL

UNION ALL

-- 31. Calc-Source → CustomFunction (calls_customfunction)
-- CustomFunctions sind per FileMaker-Definition strikt datei-lokal:
-- Aufrufe können nur innerhalb der definierenden Datei erfolgen, gleichnamige
-- CFs in unterschiedlichen Dateien sind eigenständige Objekte.
-- → File-lokaler JOIN, Is_Cross_File konstant FALSE.
-- DISTINCT analog zu Block 30, kollabiert Mehrfachreferenzen.
SELECT DISTINCT
    xcr.Source_UUID as Source_UUID,
    xcr.Source_Type as Source_Type,
    cf.CF_UUID as Target_UUID,
    'CustomFunction' as Target_Type,
    'operational' as Link_Type,
    'calls_customfunction' as Link_Role,
    xcr.Subrole as Link_Subrole,
    xcr.File_Name as Source_File,
    cf.File_Name as Target_File,
    FALSE as Is_Cross_File
FROM XMLCalcReferences xcr
JOIN CustomFunctionsCatalog cf
  ON xcr.Ref_Name = cf.CF_Name
 AND xcr.File_Name = cf.File_Name
WHERE xcr.Ref_Type = 'customfunction'
  AND xcr.Ref_Name IS NOT NULL

UNION ALL

-- 32. Layout → Field (displays_field, aggregiert)
-- Aggregierter Direktlink aus dem Doppelhop:
--   LayoutObject → Field (displays_field) + LayoutObject → Layout (parent_layout).
-- Praxis: ein Feld kann auf einem Layout in mehreren LayoutObjects auftauchen
-- (verschiedene Slots, Tab-Panels, Group-Mitglieder). DISTINCT kollabiert das
-- auf das eindeutige (Layout, Field)-Paar.
-- Richtung Layout → Field gewählt (analog zu LayoutObject → Field), damit der
-- Link beim Field als Reverse-Lookup ("Wird verwendet von") automatisch
-- erscheint — parallel zum LayoutObject-granularen displays_field-Link.
-- Source_Type unterscheidet die beiden Granularitäten:
--   'LayoutObject' = einzelnes Element (mit Bounds-Kontext und Subrole)
--   'Layout'       = aggregiert (Layout zeigt Field)
SELECT DISTINCT
    l.L_UUID as Source_UUID,
    'Layout' as Source_Type,
    xlr.Ref_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'displays_field' as Link_Role,
    NULL as Link_Subrole,
    l.File_Name as Source_File,
    oc_field.File_Name as Target_File,
    (l.File_Name != oc_field.File_Name) as Is_Cross_File
FROM XMLLayoutReferences xlr
JOIN LayoutObjects lo
    ON xlr.Object_UUID = lo.Object_UUID
   AND xlr.File_Name   = lo.File_Name
JOIN Layouts l
    ON lo.Layout_ID = l.L_ID
   AND lo.File_Name = l.File_Name
JOIN ObjectCatalog oc_field
    ON xlr.Ref_UUID = oc_field.Object_UUID
   AND oc_field.Object_Type = 'Field'
WHERE xlr.Ref_Type = 'field'
  AND xlr.Ref_UUID IS NOT NULL

UNION ALL

-- 33. Calc-Source → BuiltinFunction (calls_function)
-- PRD prd_universal_function_links.md §5.4: Built-in FunctionRef-Aufrufe als
-- Link-Tripel (dedupliziert). Target ist datei-unabhängig → Is_Cross_File=FALSE.
-- Für Get(<SubParameter>) zeigt der Link auf den SubParameter-Eintrag, sonst
-- auf den nackten Token.
SELECT DISTINCT
    xcr.Source_UUID as Source_UUID,
    xcr.Source_Type as Source_Type,
    md5('BuiltinFunction::' ||
        CASE WHEN xcr.Ref_Name = 'Get' AND xcr.Ref_SubName IS NOT NULL
             THEN xcr.Ref_Name || '::' || xcr.Ref_SubName
             ELSE xcr.Ref_Name END
    ) as Target_UUID,
    'BuiltinFunction' as Target_Type,
    'operational' as Link_Type,
    'calls_function' as Link_Role,
    xcr.Subrole as Link_Subrole,
    xcr.File_Name as Source_File,
    NULL as Target_File,
    FALSE as Is_Cross_File
FROM XMLCalcReferences xcr
WHERE xcr.Ref_Type = 'function'
  AND xcr.Ref_Name IS NOT NULL
  AND xcr.Ref_Name != ''

UNION ALL

-- 34. Calc-Source → PluginFunction (calls_pluginfunction)
-- PRD prd_universal_function_links.md §6.5: Plugin-Funktionsaufrufe (granular
-- pro Plugin-Token + SubName für Container-Plugins). Source-Tupel kommt aus
-- PluginFunctionUsages (positionsbezogen via Calc_UUID + Plugin_Chunk_Index
-- → MBS_SubnameMap). Dynamische MBS-Aufrufe (SubName NULL) werden ausgefiltert.
-- Target ist datei-unabhängig → Is_Cross_File=FALSE.
SELECT DISTINCT
    pfu.Source_UUID as Source_UUID,
    pfu.Source_Type as Source_Type,
    md5('PluginFunction::' || pfu.Plugin_Function_Name || '::' ||
        COALESCE(msm.SubName, '')) as Target_UUID,
    'PluginFunction' as Target_Type,
    'operational' as Link_Type,
    'calls_pluginfunction' as Link_Role,
    pfu.Subrole as Link_Subrole,
    pfu.File_Name as Source_File,
    NULL as Target_File,
    FALSE as Is_Cross_File
FROM PluginFunctionUsages pfu
LEFT JOIN MBS_SubnameMap msm
  ON msm.Calc_UUID = pfu.Calc_UUID
 AND msm.File_Name = pfu.File_Name
 AND msm.Plugin_Chunk_Index = pfu.Plugin_Chunk_Index
WHERE pfu.Plugin_Function_Name IS NOT NULL
  AND pfu.Plugin_Function_Name != ''
  AND (msm.SubName IS NOT NULL OR pfu.Plugin_Function_Name != 'MBS');

-- ========================================
-- groups_into-Links: PluginFunction → PluginComponent (structural)
-- ========================================
-- PRD prd_pseudo_object_types_filter.md §6.2: jede MBS-Plugin-Funktion ist
-- über einen 'groups_into'-Link an ihre Komponente angebunden. Die Komponenten-
-- Auflösung folgt derselben Logik wie der PluginComponent-INSERT
-- (CSV-Override + Default-Heuristik split_part(SubName,'.',1)).
-- Source = PluginFunction (z.B. 'MBS::XL.Book.AddFormat'),
-- Target = PluginComponent (z.B. 'MBS::XL'). Target_File = NULL (Component
-- ist lösungs-unabhängig), Is_Cross_File = FALSE (beide synthetisch).
INSERT INTO ObjectLinks (Source_UUID, Source_Type, Target_UUID, Target_Type,
                          Link_Type, Link_Role, Link_Subrole,
                          Source_File, Target_File, Is_Cross_File)
WITH component_map AS (
    SELECT
        Funktionsname AS function_name,
        Component     AS component_name
    FROM read_csv('data/mbs_component_exceptions.csv', header=true)
),
resolved AS (
    SELECT
        pf.Object_UUID                                AS function_uuid,
        regexp_replace(pf.Object_Name, '^MBS::', '')  AS sub_name,
        COALESCE(
            cm.component_name,
            split_part(regexp_replace(pf.Object_Name, '^MBS::', ''), '.', 1)
        ) AS component_name
    FROM ObjectCatalog pf
    LEFT JOIN component_map cm
      ON cm.function_name = regexp_replace(pf.Object_Name, '^MBS::', '')
    WHERE pf.Object_Type = 'PluginFunction'
      AND pf.Object_Name LIKE 'MBS::%'
)
SELECT DISTINCT
    function_uuid                                          as Source_UUID,
    'PluginFunction'                                        as Source_Type,
    md5('PluginComponent::MBS::' || component_name)         as Target_UUID,
    'PluginComponent'                                       as Target_Type,
    'structural'                                            as Link_Type,
    'groups_into'                                           as Link_Role,
    NULL                                                    as Link_Subrole,
    NULL                                                    as Source_File,
    NULL                                                    as Target_File,
    FALSE                                                   as Is_Cross_File
FROM resolved
WHERE component_name IS NOT NULL
  AND component_name != '';

-- Indexes für ObjectLinks
CREATE INDEX idx_objectlinks_source ON ObjectLinks(Source_UUID);
CREATE INDEX idx_objectlinks_target ON ObjectLinks(Target_UUID);
CREATE INDEX idx_objectlinks_type ON ObjectLinks(Link_Type);
CREATE INDEX idx_objectlinks_composite ON ObjectLinks(Source_Type, Target_Type);
CREATE INDEX idx_objectlinks_file ON ObjectLinks(Source_File, Target_File);
CREATE INDEX idx_objectlinks_crossfile ON ObjectLinks(Is_Cross_File);


-- ========================================
-- Statistik-Views für Monitoring
-- ========================================

-- Object Count per Type and File
CREATE OR REPLACE VIEW v_object_stats AS
SELECT
    Object_Type,
    File_Name,
    COUNT(*) as Object_Count
FROM ObjectCatalog
GROUP BY Object_Type, File_Name
ORDER BY Object_Type, File_Name;

-- Link Count per Type
CREATE OR REPLACE VIEW v_link_stats AS
SELECT
    Source_Type,
    Target_Type,
    Link_Type,
    COUNT(*) as Link_Count,
    SUM(CASE WHEN Is_Cross_File THEN 1 ELSE 0 END) as Cross_File_Links
FROM ObjectLinks
GROUP BY Source_Type, Target_Type, Link_Type
ORDER BY Link_Count DESC;

-- Cross-File Dependencies
CREATE OR REPLACE VIEW v_cross_file_dependencies AS
SELECT
    ol.Source_Type,
    oc_source.Object_Name as Source_Object,
    oc_source.File_Name as Source_File,
    ol.Target_Type,
    oc_target.Object_Name as Target_Object,
    oc_target.File_Name as Target_File,
    ol.Link_Role
FROM ObjectLinks ol
JOIN ObjectCatalog oc_source ON ol.Source_UUID = oc_source.Object_UUID
JOIN ObjectCatalog oc_target ON ol.Target_UUID = oc_target.Object_UUID
WHERE ol.Is_Cross_File = true
ORDER BY ol.Source_Type, oc_source.Object_Name;
