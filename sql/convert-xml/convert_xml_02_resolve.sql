/*
-- convert_xml_02_resolve.sql — Phase 2 der XML-Konvertierungs-Pipeline.
-- Löst die Verschränkungs-/Referenz-Tabellen
-- auf, die aus den P1-Roh-Katalogen abgeleitet werden:
--   • XMLStepReferences   (Cluster 1)
--   • XMLLayoutReferences  (Cluster 2)
--   • MBS_SubnameMap + GetSubparameterMap          (Cluster 3)
--   • XMLCalcReferences + PluginFunctionUsages     (Cluster 4)
--
-- TABLE-ONLY (Schritt 2 abgeschlossen): Diese Phase liest AUSSCHLIESSLICH aus
-- den P1-Tabellen (inkl. der Roh-XML-Spalten Step_XML/Object_XML/Parameters_XML
-- via xml_extract_* auf Spaltenwerten) — KEIN read_xml mehr. Sie verarbeitet alle
-- Dateien auf einmal (DELETE-then-INSERT pro Tabelle, File_Name-Filter entfallen)
-- und läuft daher genau EINMAL nach allen P1-Importen (das
-- Skill-Skript ruft sie batch-einmalig auf, analog zu create_universal_catalogs.sql).
-- Schema-Persistenz (SchemaInfo) bleibt in convert_xml_01_extract.sql — diese Datei
-- schreibt KEINE SchemaInfo.
*/

INSTALL webbed FROM community;
LOAD webbed;   -- xml_extract_* auf Spaltenwerten (Step_XML/Object_XML/Parameters_XML); kein read_xml

-- Workaround-Disable-Flag (Version-Check-Registry tools/katana-xml/version_check.json,
-- Capability fragment_utf8/#108 → wa_entity_decode, Default ON). Gatet den html_unescape-
-- Decode der Namensspalten unten; OFF (sobald webbed Fragmente als literales UTF-8 statt
-- &#xNN; serialisiert) → Roh-Wert unveraendert. Idempotent → identitaets-neutral solange ON.
SET VARIABLE wa_entity_decode = true;

-- ============================================
-- XMLStepReferences (ersetzt Python extract_xml_references.py)
-- ============================================
-- Extrahiert UUID-Referenzen direkt aus dem XML per xml_extract_text().
-- Kein JSON-Umweg, kein Escaping-Problem.
CREATE TABLE IF NOT EXISTS XMLStepReferences (
    Script_UUID VARCHAR,
    Step_UUID VARCHAR,
    Step_Name VARCHAR,
    Step_Index VARCHAR,
    Ref_Type VARCHAR,            -- 'field' | 'script' | 'layout' | 'variable'
    Ref_UUID VARCHAR,            -- bei Ref_Type='variable': NULL
    Ref_Name VARCHAR,
    File_Name VARCHAR,
    -- v2.0 Erweiterungen:
    TO_Name VARCHAR,             -- nur Ref_Type='field' (Set Field / GTF / GTRR)
    TO_UUID VARCHAR,             -- analog
    Data_Source_Name VARCHAR,    -- nur Ref_Type='script' Cross-File (Perform Script from file)
    Data_Source_UUID VARCHAR,    -- analog
    Variable_Scope VARCHAR,      -- nur Ref_Type='variable': 'local'|'global'|'superglobal'|'let_local'
    Usage_Type VARCHAR           -- nur Ref_Type='variable': 'set' (Set-Variable-Step-Definition)
);

-- Additive Migration für Bestands-DBs (idempotent — neuer Bau setzt sie via CREATE).
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS TO_Name VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS TO_UUID VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Data_Source_Name VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Data_Source_UUID VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Variable_Scope VARCHAR;
ALTER TABLE XMLStepReferences ADD COLUMN IF NOT EXISTS Usage_Type VARCHAR;

-- Bestehende Einträge für diese Datei entfernen (Idempotenz)
DELETE FROM XMLStepReferences WHERE TRUE;

-- Quelle: StepsForScripts-Tabelle.
-- Step-UUID/Name/Index stammen aus Spalten; alle Referenzen (Script/Field/Layout/
-- TableOccurrence/DataSource/Name) werden aus Step_XML (vollständiges <Step>-Element)
-- gelesen — byte-identisch zur früheren Extraktion aus der Roh-XML (kein read_xml mehr).
-- Step_XML statt Parameters_XML, weil manche Step-Typen (z.B. "missing plug-in")
-- Referenzen AUSSERHALB von ParameterValues ablegen.

-- Perform Script → ScriptReference
INSERT INTO XMLStepReferences
SELECT
    Script_UUID,
    Step_UUID,
    Step_Name,
    Step_Index::VARCHAR AS Step_Index,
    'script' as Ref_Type,
    ref_uuid as Ref_UUID,
    xml_extract_text(Step_XML, '//ScriptReference/@name')[1] as Ref_Name,
    File_Name,
    NULL AS TO_Name, NULL AS TO_UUID,
    -- Cross-File-Detection: <DataSourceReference> vor <ScriptReference> markiert externen Aufruf.
    -- NULLIF, weil xml_extract_text leere Strings für nicht-existente Elemente liefert.
    NULLIF(xml_extract_text(Step_XML, '//DataSourceReference/@name')[1], '') AS Data_Source_Name,
    NULLIF(xml_extract_text(Step_XML, '//DataSourceReference/@UUID')[1], '') AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM (
    -- Opt 3A (Resolve-Query-Dedup): //ScriptReference/@UUID nur EINMAL parsen statt in
    -- SELECT *und* WHERE; der LIKE-Vorfilter hält den Parse auf Perform-Script-Steps
    -- beschränkt. Die übrigen (Select-only-)Extrakte bleiben außen → werden erst für die
    -- gefilterten Zeilen ausgewertet (parse-count ≤ vorher; Output bit-identisch).
    SELECT Script_UUID, Step_UUID, Step_Name, Step_Index, File_Name, Step_XML,
           xml_extract_text(Step_XML, '//ScriptReference/@UUID')[1] AS ref_uuid
    FROM StepsForScripts
    WHERE Step_Name LIKE '%Perform Script%'
)
WHERE ref_uuid IS NOT NULL;

-- Alle Step-Typen mit eingebetteten <FieldReference>-Elementen
-- Universelle Erfassung: unnest jeder FieldReference im Step_XML → eine Zeile pro
-- Feld. Step-Filter entfällt — XPath '//FieldReference' matched in 22 Step-Typen
-- (Set Field, Sort Records, Import Records, Perform Find, Replace Field Contents,
-- Show Custom Dialog, etc.). TO-Auflösung relativ zur FieldReference, damit Steps
-- mit mehreren Feld-TO-Paaren (Import Records) korrekt aufgelöst werden.
INSERT INTO XMLStepReferences
SELECT
    Script_UUID,
    Step_UUID,
    Step_Name,
    Step_Index::VARCHAR AS Step_Index,
    'field' as Ref_Type,
    ref_uuid as Ref_UUID,
    ref_name as Ref_Name,
    File_Name,
    -- TO-Auflösung relativ zum FieldReference-Element
    NULLIF(xml_extract_text(field_ref_xml, '/FieldReference/TableOccurrenceReference/@name')[1], '') AS TO_Name,
    NULLIF(xml_extract_text(field_ref_xml, '/FieldReference/TableOccurrenceReference/@UUID')[1], '') AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM (
    -- Opt 3A: /FieldReference/@UUID + @name je EINMAL parsen (vorher SELECT+WHERE doppelt);
    -- field_ref_xml bleibt durchgereicht für die gefilterten Select-only-Extrakte.
    SELECT Script_UUID, Step_UUID, Step_Name, Step_Index, File_Name, field_ref_xml,
           xml_extract_text(field_ref_xml, '/FieldReference/@UUID')[1] AS ref_uuid,
           xml_extract_text(field_ref_xml, '/FieldReference/@name')[1] AS ref_name
    FROM (
        SELECT
            Script_UUID, Step_UUID, Step_Name, Step_Index, File_Name,
            unnest(xml_extract_elements(Step_XML, '//FieldReference')) as field_ref_xml
        FROM StepsForScripts
        -- Opt 3A: LIKE-Vorfilter überspringt Steps ohne FieldReference komplett (kein DOM-Parse).
        -- Ein XPath-Match auf //FieldReference impliziert den Substring → kein Treffer fällt weg
        -- (gleiche Superset-Logik wie der Script-Ref-Footprint-Fix weiter unten).
        WHERE Step_XML LIKE '%FieldReference%'
    )
)
WHERE ref_uuid IS NOT NULL
  -- Import-Records-Platzhalter ausfiltern: nicht zugeordnete Quellspalten einer
  -- Importzuordnung stehen als '<FieldReference id="0" name="" UUID="">' im Map —
  -- weder Name noch UUID → keine echte Feldreferenz (sonst ~14,8k dangling
  -- imports_to_field-Links + „Ziel nicht im Datenbestand" in der Step-Anzeige).
  AND NOT (COALESCE(ref_uuid, '') = '' AND COALESCE(ref_name, '') = '');

-- Go to Related Record → TableOccurrenceReference
-- GTRR enthält kein <FieldReference>; das Ziel ist die TO. Heimat/Cross-File werden
-- im Template über TableOccurrenceResolution aufgelöst (Ref_UUID = TO_UUID, File_Name
-- = Quelldatei des Scripts).
INSERT INTO XMLStepReferences
SELECT
    Script_UUID,
    Step_UUID,
    Step_Name,
    Step_Index::VARCHAR AS Step_Index,
    'tableOccurrence' as Ref_Type,
    ref_uuid as Ref_UUID,
    xml_extract_text(Step_XML, '//TableOccurrenceReference/@name')[1] as Ref_Name,
    File_Name,
    -- TO_Name/TO_UUID-Spalten redundant für tableOccurrence-Refs (Ref_UUID/Ref_Name
    -- enthalten dieselbe Info). NULL hält die Semantik konsistent (TO_* nur für
    -- Field-Refs gefüllt, wo es das *Kontext*-TO eines Felds beschreibt).
    NULL AS TO_Name, NULL AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM (
    -- Opt 3A: //TableOccurrenceReference/@UUID nur EINMAL parsen (vorher SELECT+WHERE).
    SELECT Script_UUID, Step_UUID, Step_Name, Step_Index, File_Name, Step_XML,
           xml_extract_text(Step_XML, '//TableOccurrenceReference/@UUID')[1] AS ref_uuid
    FROM StepsForScripts
    WHERE Step_Name = 'Go to Related Record'
)
WHERE ref_uuid IS NOT NULL;

-- Go to Related Record → LayoutReference
-- Variante A (~92%) hat <LayoutReference> innerhalb von <LayoutReferenceContainer>.
-- Variante B ("original layout") hat nur <LayoutReferenceContainer> mit <Label> —
-- der XPath //LayoutReference/@UUID matcht dann nichts → kein INSERT.
INSERT INTO XMLStepReferences
SELECT
    Script_UUID,
    Step_UUID,
    Step_Name,
    Step_Index::VARCHAR AS Step_Index,
    'layout' as Ref_Type,
    ref_uuid as Ref_UUID,
    xml_extract_text(Step_XML, '//LayoutReference/@name')[1] as Ref_Name,
    File_Name,
    NULL AS TO_Name, NULL AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM (
    -- Opt 3A: //LayoutReference/@UUID nur EINMAL parsen (vorher SELECT+WHERE).
    SELECT Script_UUID, Step_UUID, Step_Name, Step_Index, File_Name, Step_XML,
           xml_extract_text(Step_XML, '//LayoutReference/@UUID')[1] AS ref_uuid
    FROM StepsForScripts
    WHERE Step_Name = 'Go to Related Record'
)
WHERE ref_uuid IS NOT NULL;

-- Go to Layout → LayoutReference
INSERT INTO XMLStepReferences
SELECT
    Script_UUID,
    Step_UUID,
    Step_Name,
    Step_Index::VARCHAR AS Step_Index,
    'layout' as Ref_Type,
    ref_uuid as Ref_UUID,
    xml_extract_text(Step_XML, '//LayoutReference/@name')[1] as Ref_Name,
    File_Name,
    NULL AS TO_Name, NULL AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    NULL AS Variable_Scope, NULL AS Usage_Type
FROM (
    -- Opt 3A: //LayoutReference/@UUID nur EINMAL parsen (vorher SELECT+WHERE).
    SELECT Script_UUID, Step_UUID, Step_Name, Step_Index, File_Name, Step_XML,
           xml_extract_text(Step_XML, '//LayoutReference/@UUID')[1] AS ref_uuid
    FROM StepsForScripts
    WHERE Step_Name = 'Go to Layout'
)
WHERE ref_uuid IS NOT NULL;


-- Set Variable → <Name value="$X"> als Definition (LHS, Usage_Type='set')
-- Die RHS-Lesung kommt über DDR-Calc-Chunks und landet in XMLCalcReferences
-- (Ref_Type='variable', Usage_Type='read'). Damit haben wir saubere Trennung
-- Definition vs. Lesung — Voraussetzung für Cross-Step-Navigation.
INSERT INTO XMLStepReferences
SELECT
    Script_UUID,
    Step_UUID,
    Step_Name,
    Step_Index::VARCHAR AS Step_Index,
    'variable' as Ref_Type,
    NULL as Ref_UUID,
    -- <Name value="$X"> liegt unterhalb von ParameterValues/Parameter/Name
    name_value as Ref_Name,
    File_Name,
    NULL AS TO_Name, NULL AS TO_UUID,
    NULL AS Data_Source_Name, NULL AS Data_Source_UUID,
    -- Scope-Detektor: $$$ → superglobal, $$ → global, $ → local. Reihenfolge wichtig
    -- (LIKE '$$$%' muss vor LIKE '$$%' stehen — sonst werden $$$ als $$ erkannt).
    CASE
        WHEN name_value LIKE '$$$%' THEN 'superglobal'
        WHEN name_value LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END AS Variable_Scope,
    'set' AS Usage_Type
FROM (
    -- Opt 3A: //Name/@value nur EINMAL parsen (vorher 5× pro Zeile: SELECT + CASE×2 + WHERE×2).
    SELECT Script_UUID, Step_UUID, Step_Name, Step_Index, File_Name,
           xml_extract_text(Step_XML, '//Name/@value')[1] AS name_value
    FROM StepsForScripts
    WHERE Step_Name = 'Set Variable'
)
WHERE name_value IS NOT NULL
  AND name_value <> '';

-- HINWEIS: Die Cross-File-Auflösung leerer Referenz-UUIDs (External GTRR / Go-to-Layout /
-- Perform-Script + TO-relative Feldbezüge) UND der Step_UUID-Index liegen NICHT hier,
-- sondern in Phase 4 (convert_xml_04_catalog.sql, ganz oben). Grund: P2 läuft im Batch
-- DATEI-PARTITIONIERT (je Slice nur die eigenen Dateien als gefilterte `src`-Views), die
-- Auflösung ist aber DATEI-ÜBERGREIFEND und batch-weit — sie muss auf der fertig gemergten
-- Master-XMLStepReferences laufen, nicht je Slice. Der Import-Platzhalter-Filter im
-- Feld-INSERT oben bleibt hier (rein per-Datei → partitionssicher).

-- ============================================
-- XMLLayoutReferences (ersetzt Python extract_xml_references.py)
-- ============================================
-- Extrahiert UUID-Referenzen aus LayoutObjects direkt per xml_extract_text().
CREATE TABLE IF NOT EXISTS XMLLayoutReferences (
    Object_UUID VARCHAR,
    Ref_Type VARCHAR,
    Ref_UUID VARCHAR,
    Ref_Name VARCHAR,
    File_Name VARCHAR
);

-- Bestehende Einträge für diese Datei entfernen (Idempotenz)
DELETE FROM XMLLayoutReferences WHERE TRUE;

-- Feld-Referenzen: LayoutObject/Field/FieldReference/@UUID
INSERT INTO XMLLayoutReferences
SELECT
    object_uuid as Object_UUID,
    'field' as Ref_Type,
    ref_uuid as Ref_UUID,
    xml_extract_text(object_xml, '/LayoutObject/Field/FieldReference/@name')[1] as Ref_Name,
    File_Name
FROM (
    -- Opt 3A: UUID + FieldReference/@UUID je EINMAL parsen (vorher SELECT+WHERE doppelt);
    -- object_xml bleibt durchgereicht für den gefilterten Select-only-@name-Extrakt.
    SELECT Object_XML AS object_xml, File_Name,
           xml_extract_text(Object_XML, '/LayoutObject/UUID')[1] AS object_uuid,
           xml_extract_text(Object_XML, '/LayoutObject/Field/FieldReference/@UUID')[1] AS ref_uuid
    FROM LayoutObjects
    -- Opt 3A: LIKE-Vorfilter überspringt Objekte ohne FieldReference (Superset; kein Treffer fällt weg).
    WHERE Object_XML LIKE '%FieldReference%'
)
WHERE object_uuid IS NOT NULL
  AND ref_uuid IS NOT NULL;

-- Script-Referenzen: //ScriptReference/@UUID (alle Nachfahren).
-- P2-Footprint-Fix: statt
-- unnest(xml_extract_elements(…, '//ScriptReference')) — das DOM-tragende
-- Fragment-Listen materialisiert und den EINZIGEN nicht-spillbaren >1-GB-Peak
-- erzeugte (2298 MB, reproduzierte den 2-GiB-P2-OOM) — werden zwei PARALLELE
-- String-Listen (@UUID ∥ @name) extrahiert und positionsweise gezippt. Die Listen
-- sind je ScriptReference längen-gleich (im Korpus 0 Mismatch), daher ausrichtungs-
-- treu. Footprint 2298→495 MB, voll spillbar, korpus-bit-identisch (38326 Zeilen,
-- EXCEPT ALL beidseitig 0). LIKE-Vorfilter überspringt Objekte ohne ScriptReference
-- (ein XPath-Match impliziert den Substring → kein Treffer fällt weg).
INSERT INTO XMLLayoutReferences
SELECT Object_UUID, 'script' AS Ref_Type, Ref_UUID, Ref_Name, File_Name
FROM (
    SELECT ou AS Object_UUID, unnest(uuids) AS Ref_UUID, unnest(names) AS Ref_Name, File_Name
    FROM (
        SELECT xml_extract_text(Object_XML, '/LayoutObject/UUID')[1] AS ou,
               xml_extract_text(Object_XML, '//ScriptReference/@UUID') AS uuids,
               xml_extract_text(Object_XML, '//ScriptReference/@name') AS names,
               File_Name
        FROM LayoutObjects
        WHERE Object_XML LIKE '%ScriptReference%'
    )
    WHERE ou IS NOT NULL AND len(uuids) > 0
)
WHERE Ref_UUID IS NOT NULL;

-- ValueList-Referenzen: LayoutObject/Field/Display/ValueListReference/@UUID (NEU)
INSERT INTO XMLLayoutReferences
SELECT
    object_uuid as Object_UUID,
    'valuelist' as Ref_Type,
    ref_uuid as Ref_UUID,
    xml_extract_text(object_xml, '/LayoutObject/Field/Display/ValueListReference/@name')[1] as Ref_Name,
    File_Name
FROM (
    -- Opt 3A: UUID + ValueListReference/@UUID je EINMAL parsen (vorher SELECT+WHERE doppelt);
    -- object_xml bleibt durchgereicht für den gefilterten Select-only-@name-Extrakt.
    SELECT Object_XML AS object_xml, File_Name,
           xml_extract_text(Object_XML, '/LayoutObject/UUID')[1] AS object_uuid,
           xml_extract_text(Object_XML, '/LayoutObject/Field/Display/ValueListReference/@UUID')[1] AS ref_uuid
    FROM LayoutObjects
    -- Opt 3A: LIKE-Vorfilter überspringt Objekte ohne ValueListReference (Superset; kein Treffer fällt weg).
    WHERE Object_XML LIKE '%ValueListReference%'
)
WHERE object_uuid IS NOT NULL
  AND ref_uuid IS NOT NULL;

-- Portal → TableOccurrence: /LayoutObject/Portal/TableOccurrenceReference/@UUID (NEU)
INSERT INTO XMLLayoutReferences
SELECT
    xml_extract_text(object_xml, '/LayoutObject/UUID')[1] as Object_UUID,
    'table_occurrence' as Ref_Type,
    ref_uuid as Ref_UUID,
    xml_extract_text(object_xml, '/LayoutObject/Portal/TableOccurrenceReference/@name')[1] as Ref_Name,
    File_Name
FROM (
    -- Opt 3A: Portal/TableOccurrenceReference/@UUID nur EINMAL parsen (vorher SELECT+WHERE);
    -- der @type='Portal'-Vorfilter bleibt im Subquery, object_xml durchgereicht für die
    -- gefilterten Select-only-Extrakte (UUID + @name).
    SELECT Object_XML AS object_xml, File_Name,
           xml_extract_text(Object_XML, '/LayoutObject/Portal/TableOccurrenceReference/@UUID')[1] AS ref_uuid
    FROM LayoutObjects
    -- Opt 3A: LIKE-Vorfilter spart den @type-DOM-Parse für Nicht-Portal-Objekte (Superset:
    -- jedes type="Portal"-Objekt enthält den Substring; False Positives filtert @type weg).
    WHERE Object_XML LIKE '%Portal%'
      AND xml_extract_text(Object_XML, '/LayoutObject/@type')[1] = 'Portal'
)
WHERE ref_uuid IS NOT NULL;

-- ============================================
-- MBS_SubnameMap
-- ============================================
-- Pro `MBS`-PluginFunctionRef-Chunk wird der fachliche MBS-Funktionsname (erstes
-- Argument, z.B. "List.AddPrefix") aus den NoRef-Chunks derselben Calculation
-- ermittelt. Chunk_Index steht in
-- XML-Dokumentreihenfolge — die Pairing-Heuristik nutzt nur die relative
-- Reihenfolge pro Liste:
--   (a) alle MBS-PluginFunctionRef-Chunks und
--   (b) alle NoRef-Chunks mit Pattern `( "..."` (= MBS-Argumentliste)
-- werden nach Chunk_Index sortiert und 1:1 per ROW_NUMBER gemappt.
-- Bei dynamischem ersten Argument (`MBS( $name ; … )`) liefert die NoRef-Liste
-- weniger Treffer als die MBS-Liste — dann bleibt SubName NULL (kein subFunction
-- im Tokens-Output).

CREATE TABLE IF NOT EXISTS MBS_SubnameMap (
    Calc_UUID VARCHAR,
    File_Name VARCHAR,
    Plugin_Chunk_Index BIGINT,    -- Chunk_Index des PluginFunctionRef-Chunks
    SubName VARCHAR,               -- fachlicher MBS-Funktionsname (z.B. "List.AddPrefix")
    PRIMARY KEY (Calc_UUID, File_Name, Plugin_Chunk_Index)
);

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen
DELETE FROM MBS_SubnameMap WHERE TRUE;

INSERT INTO MBS_SubnameMap
WITH plugin_refs AS (
    SELECT d.Calc_UUID, d.File_Name, d.Chunk_Index
    FROM DDR_Calculations d
    WHERE d.Chunk_Type = 'PluginFunctionRef'
      AND regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'MBS'
),
subname_chunks AS (
    -- Normalize encoded whitespace char-refs (CR/LF/TAB, decimal & hex) to a plain
    -- space BEFORE the `( "<SubName>"` match, so the extraction is serialization-
    -- independent. A newline right after the opening paren — MBS( \n"FM.…"; …) — is
    -- serialized by DOM as the literal entity `&#13;` but by SAX (--streamify) as a
    -- real CR byte. The old regex `\(\s*"` matched the CR (\s) but NOT `&#13;` (the
    -- `&` is not \s) → DOM silently dropped real MBS calls (SubName NULL) that SAX
    -- resolved → DOM≠SAX AND a latent DOM data-loss bug. Decoding the char-refs first
    -- makes both paths agree and recovers the missed calls.
    SELECT Calc_UUID, File_Name, Chunk_Index,
        regexp_extract(norm, '\(\s*"([^"]+)"', 1) AS SubName
    FROM (
        SELECT d.Calc_UUID, d.File_Name, d.Chunk_Index,
            regexp_replace(d.Chunk_Content, '&#(0*(9|10|13)|[xX]0*(9|[aAdD]));', ' ', 'g') AS norm
        FROM DDR_Calculations d
        WHERE d.Chunk_Type = 'NoRef'
    )
    WHERE regexp_matches(norm, '\(\s*"[^"]+"')
)
-- Proximity-Paarung (T6, 2026-06-16): jeder MBS-PluginFunctionRef wird mit dem
-- UNMITTELBAR FOLGENDEN passenden NoRef-Chunk (kleinster Chunk_Index > Ref-Index)
-- gepaart — das ist der `( "<SubName>"; `-Chunk direkt hinter dem MBS-Aufruf.
-- Ersetzt die frühere rn-Rang-Paarung (k-ter Ref ↔ k-ter SubName-Chunk), die
-- fragil war: zusätzliche `( "…"`-matchende Chunks (SQL-Strings; im --streamify-
-- Build zusätzlich die Roh-Fallback-Serialisierung textloser Chunks) verschoben
-- die rn-Ausrichtung → falsche/fehlende SubNames (Phantom-PluginFunction
-- `MBS::SELECT`, NULLs). Proximity ist serialisierungs-robust UND korrekter
-- (DOM-NULLs 305→222, 92 Fehl-Paarungen behoben; DOM==--streamify-Objektmenge).
SELECT pr.Calc_UUID, pr.File_Name, pr.Chunk_Index, sc.SubName
FROM plugin_refs pr
LEFT JOIN subname_chunks sc
  ON pr.Calc_UUID = sc.Calc_UUID
 AND pr.File_Name = sc.File_Name
 AND sc.Chunk_Index > pr.Chunk_Index
QUALIFY ROW_NUMBER() OVER (PARTITION BY pr.Calc_UUID, pr.File_Name, pr.Chunk_Index
                           ORDER BY sc.Chunk_Index) = 1;


-- ============================================
-- GetSubparameterMap
-- ============================================
-- Get(<SubParameter>) ist eine FileMaker-Container-Funktion: pro Sub-Parameter
-- liefert sie einen anderen Wert. Im DDR steht der Sub-Parameter als eigener
-- FunctionRef-Chunk innerhalb von Get( ... ) — Pattern (nach Chunk-Reorder
-- immer in dieser Reihenfolge):
--   Chunk N:   FunctionRef = 'Get'
--   Chunk N+1: NoRef       = '(' (mit optionalem Whitespace)
--   Chunk N+2: FunctionRef = '<SubParameter>'  (z.B. 'LayoutName')
--   Chunk N+3: NoRef       = ')...'
-- Bei dynamischen Aufrufen (Get($name) oder Get(Abs(...))) bleibt SubParameter
-- NULL (Chunk N+2 ist VariableReference, FieldRef oder eine andere Funktion
-- die in der fm_reference NICHT als is_get_function markiert ist).
-- Die Get-Familie ist hier auf 'Get' beschränkt; lokalisierte Tokens (Holen,
-- Recibir, …) erscheinen im DDR praktisch nicht, weil FM die FunctionRefs auf
-- den kanonischen Namen normalisiert. Bei Bedarf erweiterbar.

CREATE TABLE IF NOT EXISTS GetSubparameterMap (
    Calc_UUID VARCHAR NOT NULL,
    File_Name VARCHAR NOT NULL,
    Get_Chunk_Index BIGINT NOT NULL,   -- Index des Get-FunctionRef-Chunks
    SubParameter VARCHAR,               -- z.B. 'ApplicationVersion', NULL bei dynamisch
    PRIMARY KEY (Calc_UUID, File_Name, Get_Chunk_Index)
);

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen
DELETE FROM GetSubparameterMap WHERE TRUE;

INSERT INTO GetSubparameterMap
WITH file_chunks AS (
    SELECT d.*
    FROM DDR_Calculations d
    WHERE TRUE
),
chunks_with_lead AS (
    SELECT
        Calc_UUID, File_Name, Chunk_Index, Chunk_Type, Chunk_Content,
        LEAD(Chunk_Type, 1) OVER w AS Next_Type,
        LEAD(Chunk_Type, 2) OVER w AS Next2_Type,
        LEAD(Chunk_Content, 2) OVER w AS Next2_Content
    FROM file_chunks
    WINDOW w AS (PARTITION BY Calc_UUID, File_Name ORDER BY Chunk_Index)
)
SELECT
    Calc_UUID,
    File_Name,
    Chunk_Index AS Get_Chunk_Index,
    CASE
        WHEN Next_Type = 'NoRef' AND Next2_Type = 'FunctionRef'
            THEN regexp_extract(Next2_Content, '>([^<]+)</Chunk>', 1)
        ELSE NULL
    END AS SubParameter
FROM chunks_with_lead
WHERE Chunk_Type = 'FunctionRef'
  AND regexp_extract(Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get';


-- ============================================
-- XMLCalcReferences
-- ============================================
-- Resolved DDR-Refs (FieldRef + CustomFunctionRef) aus allen Calculation-Quellen:
--   - FieldsForTables (Calculated, AutoEnter-Calc) via DDR_Hash / AE_Calc_Hash
--   - CustomFunctionsCatalog via DDR_Hash
--   - StepsForScripts via DDRREF-Hashes im Parameters_XML
--   - LayoutObjects via DDRREF-Hashes im Object_XML
-- Plugin-Funktionen landen in PluginFunctionUsages (separate Tabelle, da kein
-- ObjectCatalog-Eintrag vorhanden).
CREATE TABLE IF NOT EXISTS XMLCalcReferences (
    Source_UUID VARCHAR,         -- Script_UUID, Field_UUID, CF_UUID oder LayoutObject_UUID
    Source_Type VARCHAR,         -- 'Script', 'Field', 'CustomFunction', 'LayoutObject'
    Source_Subkey VARCHAR,       -- Step_Index (Steps), NULL (Field/CF/LayoutObject)
    Subrole VARCHAR,             -- 'Hide','Tooltip','Condition_1','action','1','2',NULL
    Calc_Hash VARCHAR,
    Ref_Type VARCHAR,            -- 'field' | 'customfunction' | 'pluginfunction' | 'variable'
    Ref_UUID VARCHAR,            -- Field-UUID (NULL bei CF/Plugin/Variable)
    Ref_Name VARCHAR,            -- Field-/CF-/Plugin-Name oder Variable-Name (mit Präfix)
    File_Name VARCHAR,
    TO_Name VARCHAR,             -- TO-Name aus <TableOccurrenceReference> (NULL bei CF/Plugin/Var)
    TO_UUID VARCHAR,             -- TO-UUID analog
    -- v2.0 Erweiterungen:
    Variable_Scope VARCHAR,      -- nur Ref_Type='variable': 'local'|'global'|'superglobal'|'let_local'
    Usage_Type VARCHAR,          -- nur Ref_Type='variable': 'read' (Calc-Chunk-Refs sind immer Lesungen)
    -- v2.1 Erweiterung:
    Ref_SubName VARCHAR          -- nur Ref_Type='pluginfunction' bei Container-Plugins
                                 -- (heute: MBS) — fachlicher Funktionsname aus dem
                                 -- ersten quoted String des Folge-NoRef-Chunks.
);

-- Additive Migration: Spalten für Bestands-DBs nachziehen. ADD COLUMN IF NOT EXISTS
-- ist idempotent. Reihenfolge identisch zu CREATE TABLE — positionsbasierte INSERTs
-- bleiben konsistent über beide Schema-Pfade.
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS TO_Name VARCHAR;
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS TO_UUID VARCHAR;
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS Variable_Scope VARCHAR;
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS Usage_Type VARCHAR;
ALTER TABLE XMLCalcReferences ADD COLUMN IF NOT EXISTS Ref_SubName VARCHAR;

CREATE TABLE IF NOT EXISTS PluginFunctionUsages (
    Source_UUID VARCHAR,
    Source_Type VARCHAR,
    Source_Subkey VARCHAR,       -- Step_Index oder NULL
    Subrole VARCHAR,
    Plugin_Function_Name VARCHAR,
    Calc_Hash VARCHAR,
    File_Name VARCHAR,
    -- Positionsbezogene Spalten,
    -- damit (Source, Calc_UUID, Plugin_Chunk_Index) eindeutig auf einen SubName
    -- in MBS_SubnameMap mappt. Calc_Hash-Joins explodieren wegen Hash-Dedup
    -- (1 Hash → bis zu 58k Calc_UUIDs); diese beiden Spalten lösen das.
    Calc_UUID VARCHAR,
    Plugin_Chunk_Index BIGINT
);

-- Additive Migration für Bestands-DBs (Reihenfolge identisch zum CREATE TABLE).
ALTER TABLE PluginFunctionUsages ADD COLUMN IF NOT EXISTS Calc_UUID VARCHAR;
ALTER TABLE PluginFunctionUsages ADD COLUMN IF NOT EXISTS Plugin_Chunk_Index BIGINT;

-- Idempotenz: bestehende Einträge der aktuellen Datei entfernen
DELETE FROM XMLCalcReferences WHERE TRUE;

DELETE FROM PluginFunctionUsages WHERE TRUE;

-- ============================================
-- A.2 — Refs aus Calculated Fields & AutoEnter-Calc (direkter DDR_Hash-Match)
-- ============================================

-- A.2.1 FieldRef in Calculated Fields (DDR_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    d.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef'
  AND f.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.2.2 CustomFunctionRef in Calculated Fields (DDR_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef'
  AND f.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.2.3 PluginFunctionRef in Calculated Fields → PluginFunctionUsages
INSERT INTO PluginFunctionUsages
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.Calc_Hash,
    d.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND f.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.2.4 FieldRef in AutoEnter-Calc (AE_Calc_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    d.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND TRUE;

-- A.2.5 CustomFunctionRef in AutoEnter-Calc (AE_Calc_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND TRUE;

-- A.2.6 PluginFunctionRef in AutoEnter-Calc → PluginFunctionUsages
INSERT INTO PluginFunctionUsages
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.Calc_Hash,
    d.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND TRUE;

-- ============================================
-- A.3 — Refs aus CustomFunctions (direkter DDR_Hash-Match)
-- ============================================

-- A.3.1 FieldRef in CustomFunctions
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    d.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef'
  AND cf.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.3.2 CustomFunctionRef in CustomFunctions (CF→CF Aufrufe)
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef'
  AND cf.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.3.3 PluginFunctionRef in CustomFunctions → PluginFunctionUsages
INSERT INTO PluginFunctionUsages
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.Calc_Hash,
    d.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND cf.DDR_Hash IS NOT NULL
  AND TRUE;

-- ============================================
-- A.4 — Refs aus Script-Steps (DDRREF-Hashes via Regex)
-- ============================================
-- DDRREF-Pattern: kind="ChunkList" hash="<HEX>" ...>_<UUID>_<SLOT></DDRREF>
-- Slot-Index ist FileMaker-spezifisch (Step-Typ-abhängig). Wir speichern ihn
-- als Subrole, ohne semantische Auflösung.

-- A.4.1 FieldRef in Script-Steps
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    sh.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef';

-- A.4.2 CustomFunctionRef in Script-Steps
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef';

-- A.4.3 PluginFunctionRef in Script-Steps → PluginFunctionUsages
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO PluginFunctionUsages
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.Calc_Hash,
    sh.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef';

-- ============================================
-- A.5 — Refs aus LayoutObjects (DDRREF-Hashes via Regex)
-- ============================================
-- Subrole: semantischer Suffix aus dem DDRREF (z.B. Hide, Tooltip, Condition_1,
-- action, ScriptTrigger_*, Label, TabPanel, Portal, Placeholder, WebViewer).

-- A.5.1 FieldRef in LayoutObjects
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    loh.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef';

-- A.5.2 CustomFunctionRef in LayoutObjects
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef';

-- A.5.3 PluginFunctionRef in LayoutObjects → PluginFunctionUsages
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO PluginFunctionUsages
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.Calc_Hash,
    loh.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef';


-- ============================================
-- A.6 — Plugin- und Variable-Refs in XMLCalcReferences
-- ============================================
-- 5 Quellen × 2 neue Ref-Typen = 10 INSERT-Blöcke.
-- PluginFunction-Refs sind hier zusätzlich zu PluginFunctionUsages enthalten,
-- damit der Tokens-Output sie als Refs ausliefern kann.
-- Variable-Refs (immer 'read') ergänzen die Set-Variable-Definitionen aus
-- XMLStepReferences (Usage_Type='set') zur bidirektionalen Cross-Step-Navigation.

-- A.6.1 PluginFunctionRef in Calculated Fields
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND f.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.6.2 VariableReference in Calculated Fields
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference'
  AND f.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.6.3 PluginFunctionRef in AutoEnter-Calc
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND TRUE;

-- A.6.4 VariableReference in AutoEnter-Calc
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference'
  AND f.AE_Calc_Hash IS NOT NULL
  AND TRUE;

-- A.6.5 PluginFunctionRef in CustomFunctions
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND cf.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.6.6 VariableReference in CustomFunctions
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference'
  AND cf.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.6.7 PluginFunctionRef in Script-Steps
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef';

-- A.6.8 VariableReference in Script-Steps
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference';

-- A.6.9 PluginFunctionRef in LayoutObjects
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.File_Name,
    NULL, NULL,
    NULL, NULL,
    m.SubName  -- Ref_SubName
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef';

-- A.6.10 VariableReference in LayoutObjects
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'variable',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.File_Name,
    NULL, NULL,
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference';


-- ============================================
-- A.7 — Built-in FunctionRef in XMLCalcReferences
-- ============================================
-- Built-in FileMaker-Funktionen (Get, Case, If, Length, …) erscheinen im DDR als
-- FunctionRef-Chunks. Wir spiegeln sie als Ref_Type='function' in XMLCalcReferences
-- für die fünf Quell-Kontexte. Built-ins haben keine UUID in der FileMaker-Lösung —
-- die kanonische Identität liegt in fm_reference.functions / function_name_lookup.
--
-- Für den Token 'Get' wird zusätzlich Ref_SubName aus GetSubparameterMap befüllt
-- (Pendant zur PluginFunction-Sub-Function-Auflösung).

-- A.7.1 FunctionRef in Calculated Fields (DDR_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'function',
    NULL,  -- Ref_UUID: built-in functions haben keine UUID
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) AS Ref_Name,
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.DDR_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef'
  AND f.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.7.2 FunctionRef in AutoEnter-Calc (AE_Calc_Hash)
INSERT INTO XMLCalcReferences
SELECT
    f.Field_UUID, 'Field', NULL, NULL,
    d.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM FieldsForTables f
JOIN DDR_Calculations d ON f.AE_Calc_Hash = d.Calc_Hash AND f.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef'
  AND f.AE_Calc_Hash IS NOT NULL
  AND TRUE;

-- A.7.3 FunctionRef in CustomFunctions
INSERT INTO XMLCalcReferences
SELECT
    cf.CF_UUID, 'CustomFunction', NULL, NULL,
    d.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    d.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM CustomFunctionsCatalog cf
JOIN DDR_Calculations d ON cf.DDR_Hash = d.Calc_Hash AND cf.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef'
  AND cf.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.7.4 FunctionRef in Script-Steps
WITH step_hashes AS (
    SELECT
        s.Script_UUID,
        s.Step_Index::VARCHAR AS Step_Index,
        s.File_Name,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(s.Parameters_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM StepsForScripts s
    WHERE s.Parameters_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    sh.Script_UUID, 'Script', sh.Step_Index, sh.Subrole,
    sh.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    sh.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM step_hashes sh
JOIN DDR_Calculations d
  ON sh.Calc_Hash = d.Calc_Hash
 AND sh.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef';

-- A.7.5 FunctionRef in LayoutObjects
WITH layout_obj_hashes AS (
    SELECT
        lo.Object_UUID,
        lo.File_Name,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 1)) AS Calc_Hash,
        unnest(regexp_extract_all(lo.Object_XML,
            'kind="ChunkList" hash="([^"]+)"[^>]*>_[A-F0-9-]{36}_([^<]+)</DDRREF>', 2)) AS Subrole
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%DDRREF%'
      AND TRUE
)
INSERT INTO XMLCalcReferences
SELECT
    loh.Object_UUID, 'LayoutObject', NULL, loh.Subrole,
    loh.Calc_Hash, 'function',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),
    loh.File_Name,
    NULL, NULL,
    NULL, NULL,
    CASE WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) = 'Get'
         THEN g.SubParameter ELSE NULL END
FROM layout_obj_hashes loh
JOIN DDR_Calculations d
  ON loh.Calc_Hash = d.Calc_Hash
 AND loh.File_Name = d.File_Name
LEFT JOIN GetSubparameterMap g
       ON g.Calc_UUID = d.Calc_UUID
      AND g.File_Name = d.File_Name
      AND g.Get_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'FunctionRef';


-- ============================================
-- A.8 — Refs aus Custom Record Privileges (PrivilegeSetRecordAccess)
--
-- Custom Record Privileges, Graph-Integration (alle Ref-Typen):
-- Record-Access-Calcs (View/Edit/Create/Delete bei @access="Calculation")
-- tragen ChunkList-Hashes nach demselben Muster wie Calculated Fields & CFs.
-- Der DDR_Hash → DDR_Calculations.Calc_Hash-JOIN macht ihre Refs sichtbar.
--
-- Wirkung: schließt die Where-Used-Lücke für Felder/Variablen/CFs/Plugins, die
-- NUR in einer Record-Access-Calc vorkommen (sonst fälschlich als "ungenutzt").
-- Diese Zeilen werden vom generischen Durchlauf in create_universal_catalogs.sql
-- automatisch zu Links mit Source_Type='PrivilegeSet':
--   * FieldRef           (A.8.1) → reads_field            (Link 30)
--   * CustomFunctionRef  (A.8.3) → calls_customfunction   (Link 31)
--   * PluginFunctionRef  (A.8.4, via PluginFunctionUsages) → calls_pluginfunction (Link 34)
-- VariableReference (A.8.2) hat KEINEN generischen XMLCalcReferences→Link-Pass;
-- ihr reads_variable-Link entsteht über VariableUsages (Context_Type=
-- 'record_access_calc') in create_universal_catalogs.sql. Die XMLCalcReferences-
-- Zeile dient hier der Token-/REST-Symmetrie (tokens[] kann die Variable als Ref
-- ausliefern). Subrole trägt durchgängig "<Operation>:<Tabelle>" für feinere
-- Filterung. Cross-File ist möglich (Calc liegt im Set der nutzenden Datei,
-- referenzierte UUID kann fremd sein).
-- ============================================

-- A.8.1 FieldRef in Custom Record Privileges (DDR_Hash)
INSERT INTO XMLCalcReferences
SELECT
    ra.PrivilegeSet_UUID, 'PrivilegeSet', NULL,
    ra.Operation || ':' || COALESCE(ra.BaseTable_Name, '<New>'),  -- Subrole
    d.Calc_Hash, 'field',
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*UUID="([^"]+)"', 1),
    regexp_extract(d.Chunk_Content, 'FieldReference[^>]*name="([^"]+)"', 1),
    d.File_Name,
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*name="([^"]+)"', 1), ''),
    NULLIF(regexp_extract(d.Chunk_Content, 'TableOccurrenceReference[^>]*UUID="([^"]+)"', 1), ''),
    NULL, NULL,  -- Variable_Scope, Usage_Type (nur für Ref_Type='variable')
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM PrivilegeSetRecordAccess ra
JOIN DDR_Calculations d ON ra.DDR_Hash = d.Calc_Hash AND ra.File_Name = d.File_Name
WHERE d.Chunk_Type = 'FieldRef'
  AND ra.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.8.2 VariableReference in Custom Record Privileges (DDR_Hash)
-- Gespiegelt von A.6.2 (VariableReference in Calculated Fields). Schreibt die
-- Variable als Ref nach XMLCalcReferences (Token-/REST-Symmetrie);
-- der eigentliche reads_variable-Link entsteht über VariableUsages.
INSERT INTO XMLCalcReferences
SELECT
    ra.PrivilegeSet_UUID, 'PrivilegeSet', NULL,
    ra.Operation || ':' || COALESCE(ra.BaseTable_Name, '<New>'),  -- Subrole
    d.Calc_Hash, 'variable',
    NULL,                                                          -- Ref_UUID (Variablen: NULL)
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),       -- Ref_Name = $$Var
    d.File_Name,
    NULL, NULL,                                                   -- TO_Name, TO_UUID
    CASE
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$$%' THEN 'superglobal'
        WHEN regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1) LIKE '$$%'  THEN 'global'
        ELSE 'local'
    END,
    'read',
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM PrivilegeSetRecordAccess ra
JOIN DDR_Calculations d ON ra.DDR_Hash = d.Calc_Hash AND ra.File_Name = d.File_Name
WHERE d.Chunk_Type = 'VariableReference'
  AND ra.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.8.3 CustomFunctionRef in Custom Record Privileges (DDR_Hash)
-- Gespiegelt von A.2.2 (CustomFunctionRef in Calculated Fields). Wird vom
-- generischen Durchlauf (create_universal_catalogs.sql Link 31) zu
-- calls_customfunction-Links mit Source_Type='PrivilegeSet' aufgelöst.
INSERT INTO XMLCalcReferences
SELECT
    ra.PrivilegeSet_UUID, 'PrivilegeSet', NULL,
    ra.Operation || ':' || COALESCE(ra.BaseTable_Name, '<New>'),  -- Subrole
    d.Calc_Hash, 'customfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),       -- Ref_Name = CF-Name
    d.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    NULL  -- Ref_SubName (nur für Ref_Type='pluginfunction' bei Container-Plugins)
FROM PrivilegeSetRecordAccess ra
JOIN DDR_Calculations d ON ra.DDR_Hash = d.Calc_Hash AND ra.File_Name = d.File_Name
WHERE d.Chunk_Type = 'CustomFunctionRef'
  AND ra.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.8.4 PluginFunctionRef in Custom Record Privileges → PluginFunctionUsages
-- Gespiegelt von A.2.3 (PluginFunctionRef in Calculated Fields). Schreibt nach
-- PluginFunctionUsages (NICHT direkt nach XMLCalcReferences-Link-Pfad), da
-- create_universal_catalogs.sql Link 34 (calls_pluginfunction) aus dieser Tabelle
-- speist. Positionsbezug (Calc_UUID, Plugin_Chunk_Index) macht den SubName-JOIN
-- mit MBS_SubnameMap eindeutig. Subrole trägt "<Operation>:<Tabelle>".
INSERT INTO PluginFunctionUsages
SELECT
    ra.PrivilegeSet_UUID, 'PrivilegeSet', NULL,
    ra.Operation || ':' || COALESCE(ra.BaseTable_Name, '<New>'),  -- Subrole
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),       -- Plugin_Function_Name
    d.Calc_Hash,
    d.File_Name,
    d.Calc_UUID,
    d.Chunk_Index
FROM PrivilegeSetRecordAccess ra
JOIN DDR_Calculations d ON ra.DDR_Hash = d.Calc_Hash AND ra.File_Name = d.File_Name
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND ra.DDR_Hash IS NOT NULL
  AND TRUE;

-- A.8.5 PluginFunctionRef in Custom Record Privileges → XMLCalcReferences
-- Zusätzlich zur PluginFunctionUsages-Zeile (A.8.4): macht den Plugin-Aufruf
-- auch im Token-/REST-Output als Ref sichtbar (analog A.6.1 für Felder).
-- Ref_SubName aus MBS_SubnameMap (NULL für Nicht-Container-Plugins).
INSERT INTO XMLCalcReferences
SELECT
    ra.PrivilegeSet_UUID, 'PrivilegeSet', NULL,
    ra.Operation || ':' || COALESCE(ra.BaseTable_Name, '<New>'),  -- Subrole
    d.Calc_Hash, 'pluginfunction',
    NULL,
    regexp_extract(d.Chunk_Content, '>([^<]+)</Chunk>', 1),       -- Ref_Name = Plugin-Funktion
    d.File_Name,
    NULL, NULL,
    NULL, NULL,  -- Variable_Scope, Usage_Type
    m.SubName  -- Ref_SubName
FROM PrivilegeSetRecordAccess ra
JOIN DDR_Calculations d ON ra.DDR_Hash = d.Calc_Hash AND ra.File_Name = d.File_Name
LEFT JOIN MBS_SubnameMap m
       ON m.Calc_UUID = d.Calc_UUID
      AND m.File_Name = d.File_Name
      AND m.Plugin_Chunk_Index = d.Chunk_Index
WHERE d.Chunk_Type = 'PluginFunctionRef'
  AND ra.DDR_Hash IS NOT NULL
  AND TRUE;


-- ============================================
-- Entity-Decode (zentraler Post-Pass)
-- ============================================
-- XMLCalcReferences und PluginFunctionUsages werden AUSSCHLIESSLICH aus rohen
-- DDR_Calculations-Chunks befüllt (Field-/CF-/Plugin-/Function-/Variable-Namen
-- per regexp_extract aus dem Chunk-String). Der Roh-String trägt un-dekodierte
-- XML-Entities (`Datens&#xE4;tze`, `Schl&#xFC;ssel`), die Regex NICHT dekodiert.
-- Ein einziger Decode-Pass hier normalisiert alle Namensspalten zentral, BEVOR
-- Phase 4 daraus md5-UUIDs/ObjectLinks baut → UUID-Konsistenz garantiert.
-- (Die UUID-/Chunk-Index-Spalten bleiben unberührt; die SubName-JOINs liefen
-- bereits oben über Chunk_Index, nicht über Namen.) Idempotent: html_unescape
-- lässt entity-freie Strings unverändert; LIKE-Guard spart den No-op-Scan.
-- wa_entity_decode-gegatet (Default ON): WHERE-Guard schaltet den Decode komplett ab,
-- wenn das Flag OFF ist (No-op, kein Schreibzugriff) — siehe Flag-Definition oben.
UPDATE XMLCalcReferences    SET Ref_Name    = html_unescape(Ref_Name)    WHERE getvariable('wa_entity_decode') AND Ref_Name    LIKE '%&%';
UPDATE XMLCalcReferences    SET TO_Name     = html_unescape(TO_Name)     WHERE getvariable('wa_entity_decode') AND TO_Name     LIKE '%&%';
-- Ref_SubName: Get(<SubName>) trägt den lokalisierten Funktionsnamen (→ BuiltinFunction
-- `Get(AnzahlGefundeneDatensätze)`); MBS-SubNames sind ASCII und vom LIKE-Guard ausgenommen.
UPDATE XMLCalcReferences    SET Ref_SubName = html_unescape(Ref_SubName) WHERE getvariable('wa_entity_decode') AND Ref_SubName LIKE '%&%';
UPDATE PluginFunctionUsages SET Plugin_Function_Name = html_unescape(Plugin_Function_Name) WHERE getvariable('wa_entity_decode') AND Plugin_Function_Name LIKE '%&%';
