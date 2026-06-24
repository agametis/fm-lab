/*
-- convert_xml_03_details.sql — Phase 3 der XML-Konvertierungs-Pipeline.
-- Spezial-Parser: Variablen-Analyse.
-- Erzeugt VariableUsages + VariablesCatalog aus DDR-Chunks, Set-Variable-Steps,
-- MBS-Superglobalen, Merge-Variablen, Trigger-Parametern und Regex-Fallback.
-- TABLE-ONLY (liest nur P1/P2-Tabellen, kein read_xml). Läuft nach Phase 2 und
-- VOR Phase 4 (ObjectCatalog registriert die Variablen-Objekte).
-- Ausgekoppelt aus create_universal_catalogs.sql (Phase A, Logik unverändert).
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
-- Performance (P3): Die frühere Version prüfte
-- "Calc_Hash kommt in KEINEM Step/LayoutObject vor" über zwei korrelierte
-- NOT EXISTS mit `CAST(... AS VARCHAR) LIKE '%'||vr.Calc_Hash||'%'` — ein
-- Substring-Scan jedes Parameters_XML/Object_XML-Blobs PRO vr-Zeile
-- (O(vr × Steps × LayoutObjects × Blob-Länge) → ~152 s). Stattdessen werden alle
-- hash="…"-Attribute EINMAL pro File extrahiert (_context_hashes) und 3e nutzt
-- einen Anti-Join. Bit-identisch verifiziert (gleiche Zeilen + Content-Hash).
DROP TABLE IF EXISTS _context_hashes;
CREATE TEMP TABLE _context_hashes AS
SELECT DISTINCT File_Name, hash FROM (
    SELECT File_Name,
        unnest(regexp_extract_all(CAST(Parameters_XML AS VARCHAR), 'hash="([A-F0-9]+)"', 1)) AS hash
    FROM StepsForScripts WHERE Parameters_XML IS NOT NULL
    UNION ALL
    SELECT File_Name,
        unnest(regexp_extract_all(CAST(Object_XML AS VARCHAR), 'hash="([A-F0-9]+)"', 1)) AS hash
    FROM LayoutObjects WHERE Object_XML IS NOT NULL
);

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
      SELECT 1 FROM _context_hashes ch
      WHERE ch.File_Name = vr.File_Name AND ch.hash = vr.Calc_Hash
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
-- A.3g: Variablen in Custom Record Privileges (PrivilegeSetRecordAccess.DDR_Hash)
-- ========================================
-- Record-Access-Calcs
-- (@access="Calculation") referenzieren Variablen wie $$__Rechte_Bearbeiten.
-- Neuer Context_Type 'record_access_calc' macht diese Nutzung im Variablen-
-- Where-Used sichtbar (vorher unsichtbar: kein generischer XMLCalcReferences→
-- VariableUsages-Pfad existiert, jeder Quelltyp braucht einen eigenen Block).
--
-- Greift auf die Parser-Grundlage zurück (KEIN Neuparsen): _DDR_VarRefs_Distinct
-- trägt pro (Hash, File, Variable) genau EINE Zeile; die 43×-Hash-Kollision
-- ist damit bereits kollabiert. Der JOIN auf die N
-- PrivilegeSetRecordAccess-Zeilen mit diesem Hash erzeugt exakt eine Usage je
-- Set×Operation×Tabelle (nicht 43×).
INSERT INTO VariableUsages
SELECT
    vr.Variable_Name,
    CASE
        WHEN vr.Variable_Name LIKE '$$%' THEN 'global'
        WHEN vr.Variable_Name LIKE '$%' THEN 'local'
        ELSE 'let_local'
    END as Variable_Scope,
    'read' as Usage_Type,
    'record_access_calc' as Context_Type,
    ra.PrivilegeSet_UUID as Context_UUID,
    ra.PrivilegeSet_Name || ' › ' || ra.Operation || ':' || COALESCE(ra.BaseTable_Name, '<New>') as Context_Name,
    NULL as Script_Name,
    NULL as Script_UUID,
    NULL as Step_Index,
    ra.BaseTable_Name as Table_Name,
    NULL as Field_Name,
    vr.Calc_Hash,
    'ddr_chunk' as Source,
    vr.File_Name
FROM _DDR_VarRefs_Distinct vr
JOIN PrivilegeSetRecordAccess ra
  ON vr.Calc_Hash = ra.DDR_Hash AND vr.File_Name = ra.File_Name
WHERE ra.DDR_Hash IS NOT NULL;


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
    -- Deterministisch (A-1): ohne ORDER BY ist first() reihenfolge-abhängig und
    -- damit nicht reproduzierbar — bei mehreren DuckDB-Threads bzw. parallelem
    -- Import (--jobs) verschiebt sich die physische Zeilenreihenfolge von
    -- VariableUsages. Stabile Sortierung über (File, Script, Step, Context).
    first(Context_Name ORDER BY File_Name, Script_Name, Step_Index, Context_Name) as First_Seen_Context,
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
        -- Deterministisch (A-1): mode() bricht Häufigkeits-Gleichstände
        -- reihenfolge-abhängig (nicht reproduzierbar bei parallelem Import).
        -- Stattdessen: häufigste Datei, Gleichstand alphabetisch (nur für
        -- superglobale Variablen relevant — sonst greift Scope_Anchor oben).
        ELSE (SELECT fn FROM (
                  SELECT File_Name fn, COUNT(*) c
                  FROM VariableUsages vc_inner
                  WHERE vc_inner.Variable_Name = vc_src.Variable_Name
                    AND vc_inner.Variable_Scope = vc_src.Variable_Scope
                    AND vc_inner.Scope_Anchor IS NOT DISTINCT FROM vc_src.Scope_Anchor
                  GROUP BY File_Name
                  ORDER BY c DESC, File_Name ASC
                  LIMIT 1))
    END as File_Name
FROM VariableUsages vc_src
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


