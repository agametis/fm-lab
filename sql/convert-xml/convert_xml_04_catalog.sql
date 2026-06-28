/*
-- convert_xml_04_catalog.sql — Phase 4 der XML-Konvertierungs-Pipeline.
-- Generischer ObjektKatalog + Links:
-- ObjectCatalog (alle Objekttypen) und ObjectLinks (operational + structural,
-- cross-file). TABLE-ONLY (liest nur P1–P3-Tabellen, kein read_xml). Läuft nach
-- Phase 3, datei-übergreifend, einmal am Schluss.
-- Ausgekoppelt aus create_universal_catalogs.sql (Phase B/C/D, Logik unverändert).
*/

-- ############################################################
-- Phase A: Cross-File-Auflösung leerer Step-Referenz-UUIDs
-- ############################################################
-- Bei datei-übergreifenden Bezügen schreibt FileMaker KEINE Ziel-UUID, sondern nur den
-- <DataSourceReference> (Zieldatei) + die datei-lokale id (+ Name):
--   <LayoutReferenceContainer External="True">
--     <DataSourceReference name="Artikel Einkauf"/>
--     <LayoutReference id="1" name="Stammdaten" UUID=""/>     ← UUID leer
-- P2 liefert dann Ref_UUID='' → der Graph-Link (navigates_to_layout/calls_script/
-- sets_field …) dangelt (Target_UUID='') und das Ziel erscheint im Where-used als
-- ungenutzt. Hier — NACH dem batch-weiten P2-Merge, vor dem ObjectLinks-Aufbau — lösen
-- wir die echte UUID auf. Bewusst in P4 (nicht P2): P2 läuft datei-PARTITIONIERT (je Slice
-- nur die eigenen Dateien), die Auflösung ist aber DATEI-ÜBERGREIFEND und braucht die
-- volle Master-XMLStepReferences + alle Kataloge.
-- xml_extract_text läuft auf der Step_XML-SPALTE (KEIN read_xml/DOM → minimaler Peak; nur
-- ~1,5k External-Step-Zeilen), daher die webbed-Last vernachlässigbar.
INSTALL webbed FROM community;
LOAD webbed;

-- Layout: External GTRR / Go to Layout — DataSourceReference-Name → Zieldatei
-- (Strip '.fmp12') + lokale LayoutReference-id → Layouts.L_UUID. Pro Step genau EINE
-- Layout-Zeile (//…@UUID[1]) → UPDATE über Step_UUID eindeutig. ≈97 % auflösbar
-- (Rest = referenzierte Datei nicht importiert → bleibt leer, korrekt nicht-navigierbar).
UPDATE XMLStepReferences x
SET Ref_UUID = r.resolved_uuid
FROM (
    SELECT x2.Step_UUID, lay.L_UUID AS resolved_uuid
    FROM XMLStepReferences x2
    JOIN StepsForScripts st ON st.Step_UUID = x2.Step_UUID
    JOIN Layouts lay
      ON lay.File_Name = regexp_replace(
             NULLIF(xml_extract_text(st.Step_XML, '//DataSourceReference/@name')[1], ''),
             '\.fmp12$', '')
     AND lay.L_ID = TRY_CAST(
             NULLIF(xml_extract_text(st.Step_XML, '//LayoutReferenceContainer/LayoutReference/@id')[1], '')
             AS BIGINT)
    WHERE x2.Ref_Type = 'layout' AND (x2.Ref_UUID IS NULL OR x2.Ref_UUID = '')
) r
WHERE x.Step_UUID = r.Step_UUID
  AND x.Ref_Type = 'layout' AND (x.Ref_UUID IS NULL OR x.Ref_UUID = '');

-- Script: External Perform Script — DataSourceReference-Name → Zieldatei + lokale
-- ScriptReference-id → ScriptCatalog.Script_UUID. ≈99 % auflösbar.
UPDATE XMLStepReferences x
SET Ref_UUID = r.resolved_uuid
FROM (
    SELECT x2.Step_UUID, scr.Script_UUID AS resolved_uuid
    FROM XMLStepReferences x2
    JOIN StepsForScripts st ON st.Step_UUID = x2.Step_UUID
    JOIN ScriptCatalog scr
      ON scr.File_Name = regexp_replace(
             NULLIF(xml_extract_text(st.Step_XML, '//DataSourceReference/@name')[1], ''),
             '\.fmp12$', '')
     AND scr.Script_ID = TRY_CAST(
             NULLIF(xml_extract_text(st.Step_XML, '//ScriptReference/@id')[1], '')
             AS BIGINT)
    WHERE x2.Ref_Type = 'script' AND (x2.Ref_UUID IS NULL OR x2.Ref_UUID = '')
) r
WHERE x.Step_UUID = r.Step_UUID
  AND x.Ref_Type = 'script' AND (x.Ref_UUID IS NULL OR x.Ref_UUID = '');

-- Feld: TO-relativ ausgelassene UUID (Set Field / Sort / Go to Field …). FileMaker lässt
-- die Feld-UUID weg, liefert aber den TO-Kontext mit. Die TO zeigt auf eine Basistabelle
-- in einer ANDEREN Datei (TableOccurrenceCatalog.BT_UUID NULL, aber BT_Name + DS_Name
-- gesetzt) → Heimat der Basistabelle: DS_Name → Datei (sonst die TO-eigene Datei) +
-- BT_Name + Feldname → FieldsForTables.Field_UUID. Reine Tabellen-Auflösung (kein XML).
-- (TO_UUID, Feldname) ist eindeutig (durch BT_Name-Skopierung kollisionsfrei); Match über
-- (TO_UUID, Ref_Name), da ein Step mehrere Feldzeilen haben kann.
UPDATE XMLStepReferences x
SET Ref_UUID = r.field_uuid
FROM (
    SELECT toc.TO_UUID, f.Field_Name, f.Field_UUID AS field_uuid
    FROM TableOccurrenceCatalog toc
    JOIN FieldsForTables f
      ON f.Table_Name = toc.BT_Name
     AND f.File_Name = regexp_replace(
             COALESCE(NULLIF(toc.DS_Name, ''), toc.File_Name), '\.fmp12$', '')
    WHERE toc.TO_UUID IN (
        SELECT DISTINCT TO_UUID FROM XMLStepReferences
        WHERE Ref_Type = 'field' AND (Ref_UUID IS NULL OR Ref_UUID = '') AND TO_UUID IS NOT NULL
    )
) r
WHERE x.Ref_Type = 'field' AND (x.Ref_UUID IS NULL OR x.Ref_UUID = '')
  AND x.TO_UUID = r.TO_UUID AND x.Ref_Name = r.Field_Name;

-- Step_UUID-Index für die REST-API (pro ScriptStep-Detailaufruf werden die step-eigenen
-- Referenzen direkt aus XMLStepReferences gelesen). Hier statt in P2, weil der P2-Merge
-- (CREATE TABLE AS … LIMIT 0) keine Indizes der Slice-DBs überträgt.
CREATE INDEX IF NOT EXISTS idx_xmlstepref_step ON XMLStepReferences(Step_UUID);

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
-- HINWEIS: Relationships haben keine UUID, verwenden Rel_ID + File_Name als Composite Key.
-- DISTINCT, weil RelationshipCatalog seit Schema 1.2.0 eine Zeile pro Join-Prädikat führt
-- (Mehrfeld-Joins) — als Objekt zählt die Relation aber genau einmal.
SELECT DISTINCT
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
-- WICHTIG: eigener 'paste_'-UUID-Präfix. Ohne ihn kollidierte das synthetische
-- <Object_ID>_<File_Name>-Schema mit dem IDENTISCHEN Schema der Relationships
-- (Rel_ID overlappt mit Paste-Object_ID je Datei) → doppelte ObjectCatalog-Zeilen
-- pro UUID, die jeden ObjectLinks-JOIN über Source_/Target_UUID auffächern
-- (z.B. eine Relationship-Referenz erscheint zusätzlich als PasteIndexObject).
-- Paste-Objekte haben selbst KEINE ObjectLinks und keine Detail-/Frontend-Nutzung.
SELECT
    'paste_' || Object_ID::VARCHAR || '_' || File_Name as Object_UUID,
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
    Trigger_ID::VARCHAR || '_' || Owner_UUID || '_' || File_Name as Object_UUID,
    'ScriptTrigger' as Object_Type,
    -- COALESCE-Guard: echte Orphan-Trigger (Trigger-Slot ohne zugewiesenes
    -- Ziel-Skript) haben Script_Name=NULL. Ohne Guard wird der String-Konkat
    -- komplett NULL und bricht später den NOT-NULL-Constraint von ObjectHomes
    -- (build_resolutions.sql) ab → Rollback der gesamten Resolution-Erstellung.
    Trigger_Action || ' → ' || COALESCE(Script_Name, '<no script assigned>') as Object_Name,
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

-- 20b. CustomMenuSetCatalog (Menü-Sets)
SELECT
    MenuSet_UUID as Object_UUID,
    'CustomMenuSet' as Object_Type,
    MenuSet_Name as Object_Name,
    File_Name,
    'CustomMenuSetCatalog' as Source_Table,
    MenuSet_ID as Object_ID
FROM CustomMenuSetCatalog

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
-- Ein Eintrag pro distinct FunctionRef-Token
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
-- Ein Eintrag pro (Plugin_Function_Name, SubName).
-- Container-Plugins (heute: MBS) erzeugen pro SubName einen Eintrag; Non-Container-Plugins
-- einen Eintrag pro registriertem Calc-Token.
-- Object_Name folgt der Konvention 'Plugin::SubName' für Container-Plugins,
-- 'Plugin' für Non-Container-Plugins.
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
-- Ein Eintrag pro distinct Step_Name
-- aus StepsForScripts. ScriptStepTypes sind lösungs-unabhängig → File_Name = NULL.
-- Die Verwendungs-Anzahl wird im Detail-Template direkt aus StepsForScripts aggregiert
-- (keine zusätzlichen ObjectLinks).
SELECT DISTINCT
    md5('ScriptStepType::' || Step_Name) as Object_UUID,
    'ScriptStepType' as Object_Type,
    Step_Name as Object_Name,
    NULL as File_Name,
    'StepsForScripts' as Source_Table,
    NULL as Object_ID
FROM StepsForScripts
WHERE Step_Name IS NOT NULL
  AND Step_Name != ''

UNION ALL

-- 28. FilesCatalog (File-Knoten als Owner-Anker für File-Level-Trigger)
-- File-Level-Trigger
-- (OnFirstWindowOpen etc.) tragen als Owner_UUID die FMSaveAsXML/@UUID.
-- Damit der trigger_owner-Link (Block 18b) einen Katalog-Eintrag trifft,
-- wird hier je Datei ein File-Knoten registriert. Object_ID = NULL, da
-- Dateien keine FileMaker-interne ID haben.
SELECT
    File_UUID as Object_UUID,
    'File' as Object_Type,
    File_Name as Object_Name,
    File_Name,
    'FilesCatalog' as Source_Table,
    NULL as Object_ID
FROM FilesCatalog;

-- ========================================
-- PluginComponent (synthetisch, Category-Aggregat)
-- ========================================
-- Komponenten-Mapping aus
--   1) data/mbs_component_exceptions.csv (autoritativ, ~1.021 Mappings)
--   2) Default-Heuristik split_part(SubName, '.', 1)
-- Object_Name folgt der Konvention 'MBS::<Component>' (z.B. 'MBS::XL').
-- Wird als separater INSERT nach dem CREATE eingefügt, weil die Auflösung
-- auf die bereits existierenden PluginFunction-Einträge des ObjectCatalog
-- zugreift (CSV-Lookup gegen 'MBS::SubName'-Object_Name).
-- File_Name = NULL (lösungs-unabhängig).
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
-- DISTINCT: ein left_table-Link je Relation, nicht je Join-Prädikat (Schema 1.2.0).
FROM (SELECT DISTINCT Rel_ID, File_Name, Left_TO_UUID FROM RelationshipCatalog) rc
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
-- DISTINCT: ein right_table-Link je Relation, nicht je Join-Prädikat (Schema 1.2.0).
FROM (SELECT DISTINCT Rel_ID, File_Name, Right_TO_UUID FROM RelationshipCatalog) rc
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
-- DISTINCT: ein left_field-Link je (Relation, Feld), nicht je Join-Prädikat. Seit
-- Schema 1.2.0 ist RelationshipCatalog per-Prädikat — ein Feld, das in mehreren
-- Prädikaten derselben Seite vorkommt, ergäbe sonst doppelte (identische) Links.
FROM (SELECT DISTINCT Rel_ID, File_Name, Left_Field_UUID FROM RelationshipCatalog WHERE Left_Field_UUID IS NOT NULL) rc
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
-- DISTINCT: ein right_field-Link je (Relation, Feld), nicht je Join-Prädikat (s.o.).
FROM (SELECT DISTINCT Rel_ID, File_Name, Right_Field_UUID FROM RelationshipCatalog WHERE Right_Field_UUID IS NOT NULL) rc
LEFT JOIN ObjectCatalog oc_target ON rc.Right_Field_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'Field'

UNION ALL

-- 4b. Relationships → Fields (Sort fields, per side) — die in „Datensätze sortieren"
-- konfigurierten Felder sind eine echte Abhängigkeit der Beziehung. Link_Role='sort_field',
-- Link_Subrole = Seite ('left'/'right'). UNNEST der per-Seite Sort-UUID-Arrays, dann DISTINCT
-- (die Arrays sind über alle Predicate_Index-Zeilen einer Relation konstant).
SELECT
    rc.Rel_ID::VARCHAR || '_' || rc.File_Name as Source_UUID,
    'Relationship' as Source_Type,
    rc.sort_field_uuid as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'sort_field' as Link_Role,
    rc.side as Link_Subrole,
    rc.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (rc.File_Name != oc_target.File_Name) as Is_Cross_File
FROM (
    SELECT DISTINCT Rel_ID, File_Name, side, sort_field_uuid FROM (
        SELECT Rel_ID, File_Name, 'left' AS side, UNNEST(Left_Sort_Field_UUIDs) AS sort_field_uuid
        FROM RelationshipCatalog WHERE Left_Sort_Field_UUIDs IS NOT NULL
        UNION ALL
        SELECT Rel_ID, File_Name, 'right' AS side, UNNEST(Right_Sort_Field_UUIDs) AS sort_field_uuid
        FROM RelationshipCatalog WHERE Right_Sort_Field_UUIDs IS NOT NULL
    )
) rc
LEFT JOIN ObjectCatalog oc_target ON rc.sort_field_uuid = oc_target.Object_UUID AND oc_target.Object_Type = 'Field'

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
-- Klon-Disambiguierung: Containment ist datei-lokal (vgl. parent_script).
LEFT JOIN ObjectCatalog oc_target ON (SELECT L_UUID FROM Layouts WHERE L_ID = lo.Layout_ID AND File_Name = lo.File_Name LIMIT 1) = oc_target.Object_UUID AND oc_target.File_Name = lo.File_Name AND oc_target.Object_Type = 'Layout'

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
-- Klon-Disambiguierung: Containment ist datei-lokal (vgl. parent_script).
LEFT JOIN ObjectCatalog oc_target ON (SELECT Object_UUID FROM LayoutObjects parent WHERE parent.Object_ID = child.Parent_Object_ID AND parent.Layout_ID = child.Layout_ID AND parent.File_Name = child.File_Name LIMIT 1) = oc_target.Object_UUID AND oc_target.File_Name = child.File_Name AND oc_target.Object_Type = 'LayoutObject'
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
-- Klon-Disambiguierung: Containment ist datei-lokal. Ohne File_Name-Abgleich
-- matcht eine geteilte Klon-Script_UUID die Script-Zeile ALLER Klon-Dateien →
-- kartesische parent_script-Kanten (Step-Datei × Script-Datei).
LEFT JOIN ObjectCatalog oc_target ON sfs.Script_UUID = oc_target.Object_UUID AND oc_target.File_Name = sfs.File_Name AND oc_target.Object_Type = 'Script'

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
-- Extrahiert aus XMLStepReferences
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
    -- Owner_UUID muss im Source_UUID stehen, damit der Link zum ObjectCatalog-
    -- Eintrag passt (dort Block 18: Trigger_ID_Owner_UUID_File_Name). Ohne Owner
    -- (a) matcht der Link keinen Katalog-Eintrag → Trigger-Detail findet keine
    -- Referenz, und (b) kollabieren Object-Level-Trigger gleicher Trigger_ID auf
    -- eine UUID (derselbe Kollaps wie der ScriptTriggers-PK-Bug, eine Ebene tiefer).
    st.Trigger_ID::VARCHAR || '_' || st.Owner_UUID || '_' || st.File_Name as Source_UUID,
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

-- 18b. Script Triggers → Owner (Layout / LayoutObject / File)
-- Rückwärts-navigierbare Kante
-- vom Trigger-Knoten auf seinen Owner (child→parent, wie parent_layout/
-- parent_object/parent_script). Source_UUID identisch zu Block 18 (= Katalog-
-- UUID des Triggers). Link_Subrole trägt den Trigger-Typ, sodass "alle
-- OnObjectSave-Trigger eines Layouts" ohne JOIN auf ScriptTriggers geht.
-- Der IS-NOT-NULL-Guard verhindert verwaiste Links für unauflösbare Owner
-- (aktuell die 78 PopoverPanel-Owner — Parser-Folge-Ticket).
SELECT
    st.Trigger_ID::VARCHAR || '_' || st.Owner_UUID || '_' || st.File_Name as Source_UUID,
    'ScriptTrigger' as Source_Type,
    st.Owner_UUID as Target_UUID,
    st.Owner_Type as Target_Type,
    'structural' as Link_Type,
    'trigger_owner' as Link_Role,
    st.Trigger_Action as Link_Subrole,
    st.File_Name as Source_File,
    oc_owner.File_Name as Target_File,
    FALSE as Is_Cross_File
FROM ScriptTriggers st
-- Clone-Scoping: ein Trigger-Owner (Layout/
-- LayoutObject/File) liegt IMMER in derselben Datei wie der Trigger. Ohne
-- File_Name-Scope matcht eine geteilte Owner_UUID (geklonte Module) zusätzlich
-- die Owner-Schatten der Schwester-Module → mehrfache/fehlattribuierte Kanten.
-- Auf einem Nicht-Klon-Korpus ist die Bedingung ein No-Op (UUID global eindeutig).
LEFT JOIN ObjectCatalog oc_owner
    ON st.Owner_UUID = oc_owner.Object_UUID
   AND oc_owner.File_Name = st.File_Name
WHERE oc_owner.Object_UUID IS NOT NULL

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

-- 24b. Script → TableOccurrence (Go to Related Record — Sprungziel-TO)
-- Extrahiert aus XMLStepReferences (Ref_Type = 'tableOccurrence'). GTRR legt das
-- Bezugs-TO als <TableOccurrenceReference> ab; ohne diese Regel verpuffte die Referenz
-- komplett (kein Konsument für Ref_Type='tableOccurrence') — ein TO, das nur als
-- GTRR-Sprungziel dient, erschien dadurch in Where-used/Dead-Code als ungenutzt.
-- Rolle analog zu navigates_to_field/navigates_to_layout. TO-UUIDs sind in
-- ObjectCatalog eindeutig (keine Klon-Mehrfachtreffer → kein Row-Multiply); COALESCE
-- fängt das seltene datei-externe (nicht importierte) Sprungziel als Nicht-Cross-File ab.
SELECT
    xsr.Script_UUID as Source_UUID,
    'Script' as Source_Type,
    xsr.Ref_UUID as Target_UUID,
    'TableOccurrence' as Target_Type,
    'operational' as Link_Type,
    'navigates_to_to' as Link_Role,
    NULL as Link_Subrole,
    xsr.File_Name as Source_File,
    COALESCE(oc_target.File_Name, xsr.File_Name) as Target_File,
    (xsr.File_Name != COALESCE(oc_target.File_Name, xsr.File_Name)) as Is_Cross_File
FROM XMLStepReferences xsr
LEFT JOIN ObjectCatalog oc_target ON xsr.Ref_UUID = oc_target.Object_UUID AND oc_target.Object_Type = 'TableOccurrence'
WHERE xsr.Ref_Type = 'tableOccurrence'

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
-- Clone-Scoping „prefer-local-else-home": ein Lookup-Quellfeld
-- liegt MEIST in derselben Datei, kann aber legitim datei-übergreifend sein
-- (z. B. eine zentrale Daten-Datei). Hartes File_Name=-Scoping wäre falsch
-- (killte die legitimen Cross-File-Lookups). Stattdessen: existiert eine
-- gleichdateiliche Ziel-Kopie, gewinnt sie; sonst die (deterministisch erste)
-- Cross-File-Kopie. Der Object_Type-Guard verhindert UUID-Kollision mit Nicht-Feldern.
LEFT JOIN ObjectCatalog oc_target
    ON f.Lookup_Field_UUID = oc_target.Object_UUID
   AND oc_target.Object_Type = 'Field'
WHERE f.AutoEnter_Type = 'Looked_up'
  AND f.Lookup_Field_UUID IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY f.Field_UUID, f.File_Name
    ORDER BY (oc_target.File_Name = f.File_Name) DESC, oc_target.File_Name
  ) = 1

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
-- Clone-Scoping „prefer-local-else-home" (analog zu lookup_source, Block 25):
-- die Lookup-Beziehungs-TO liegt meist lokal, kann aber legitim cross-file sein.
-- Gleichdateilige Kopie gewinnt, sonst deterministisch erste Cross-File-Kopie.
LEFT JOIN ObjectCatalog oc_target
    ON f.Lookup_TO_UUID = oc_target.Object_UUID
   AND oc_target.Object_Type = 'TableOccurrence'
WHERE f.AutoEnter_Type = 'Looked_up'
  AND f.Lookup_TO_UUID IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY f.Field_UUID, f.File_Name
    ORDER BY (oc_target.File_Name = f.File_Name) DESC, oc_target.File_Name
  ) = 1

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

-- 28b. PrivilegeSet → Variable (reads_variable) — Custom Record Privilege Calc
-- Gespiegelt vom Field-/CF-
-- Pendant (Block 26/27), gefiltert auf den neuen Context_Type. Schließt die
-- Where-Used-Lücke für Variablen, die NUR in einer Record-Access-Calc gelesen
-- werden (z.B. $$__Rechte_Bearbeiten). Record-Calcs lesen nur → immer
-- reads_variable. Source_UUID = Context_UUID = PrivilegeSet_UUID.
--
-- Bidirektional traversierbar: Vorwärts (Set → Variable) via
-- Source_UUID, Rückwärts (Where-Used) via Target_UUID — keine zweite Kante nötig.
-- Link_Subrole bleibt NULL (konsistent mit der reads_variable-Familie 26/27/28);
-- die feinere Operation:Tabelle-Auflösung lebt in VariableUsages.Context_Name.
SELECT DISTINCT
    vu.Context_UUID as Source_UUID,
    'PrivilegeSet' as Source_Type,
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
WHERE vu.Context_Type = 'record_access_calc'
  AND vu.Variable_Scope IN ('global', 'local', 'superglobal')
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
-- Erweiterte Referenz-Auflösung
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
-- Built-in FunctionRef-Aufrufe als
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
-- Plugin-Funktionsaufrufe (granular
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
  AND (msm.SubName IS NOT NULL OR pfu.Plugin_Function_Name != 'MBS')

UNION ALL

-- 35. PrivilegeSet → Field (restricts_field)
-- Quelle: PrivilegeSetFieldAccess (Custom Record Privileges, Feld-Ebene).
-- Eigener Link_Role (NICHT reads_field): dies ist eine Zugriffs-EINSCHRÄNKUNG,
-- keine Nutzung. Damit bleibt Where-Used-/Dead-Code-Analyse unberührt — ein für
-- ein Set gesperrtes Feld gilt dadurch NICHT als "genutzt".
-- Scope: nur Abweichungen vom vollen Zugriff (Access_Mode <> 'ReadWrite'), d.h.
-- jede echte Restriktion (NoAccess/ReadOnly); voll-offene Felder erzeugen keine
-- Links (kein Signal, nur Volumen). Link_Subrole trägt den Access-Modus.
-- New-Default-Zeilen fallen über Field_UUID IS NOT NULL automatisch raus.
SELECT DISTINCT
    pfa.PrivilegeSet_UUID as Source_UUID,
    'PrivilegeSet' as Source_Type,
    pfa.Field_UUID as Target_UUID,
    'Field' as Target_Type,
    'operational' as Link_Type,
    'restricts_field' as Link_Role,
    pfa.Access_Mode as Link_Subrole,
    pfa.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (pfa.File_Name != oc_target.File_Name) as Is_Cross_File
FROM PrivilegeSetFieldAccess pfa
JOIN ObjectCatalog oc_target
  ON pfa.Field_UUID = oc_target.Object_UUID
 AND oc_target.Object_Type = 'Field'
WHERE pfa.Field_UUID IS NOT NULL
  AND pfa.Access_Mode <> 'ReadWrite'

UNION ALL

-- 36. PrivilegeSet → Layout/ValueList/Script (restricts_object)
-- Quelle: PrivilegeSetObjectAccess (Custom Privileges, Stufe 3). Analog zu
-- Block 35: eigener Link_Role, nur Restriktionen (Access_Mode <> 'ReadWrite').
-- Target_Type = Object_Class (entspricht direkt den ObjectCatalog-Typen
-- 'Layout'/'ValueList'/'Script'); Link_Subrole trägt den Access-Modus.
-- PrivilegeSets sind datei-lokal → Is_Cross_File praktisch FALSE, wird aber
-- konsistent über den ObjectCatalog-JOIN berechnet.
-- Hinweis: Der Custom-Zugriffsbaum listet auch Folder/Separatoren (mit eigener
-- UUID); diese sind im ObjectCatalog als Typ 'Folder' registriert, nicht als
-- 'Layout'/'Script'/'ValueList'. Der Inner-JOIN auf Object_Type=Object_Class
-- lässt sie daher bewusst weg — Folder-Zugriff ist rein strukturell.
SELECT DISTINCT
    poa.PrivilegeSet_UUID as Source_UUID,
    'PrivilegeSet' as Source_Type,
    poa.Object_UUID as Target_UUID,
    poa.Object_Class as Target_Type,
    'operational' as Link_Type,
    'restricts_object' as Link_Role,
    poa.Access_Mode as Link_Subrole,
    poa.File_Name as Source_File,
    oc_target.File_Name as Target_File,
    (poa.File_Name != oc_target.File_Name) as Is_Cross_File
FROM PrivilegeSetObjectAccess poa
JOIN ObjectCatalog oc_target
  ON poa.Object_UUID = oc_target.Object_UUID
 AND oc_target.Object_Type = poa.Object_Class
WHERE poa.Object_UUID IS NOT NULL
  AND poa.Access_Mode <> 'ReadWrite';

-- ========================================
-- groups_into-Links: PluginFunction → PluginComponent (structural)
-- ========================================
-- Jede MBS-Plugin-Funktion ist
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

-- ========================================
-- CustomMenuSet → CustomMenu (contains_menu, structural)
-- ========================================
-- Member-Referenzen (CustomMenuList/CustomMenuReference) tragen nur @id (kein UUID) →
-- Auflösung per (Menu_ID, File_Name) gegen CustomMenuCatalog. Built-in-Menüs (z.B.
-- id 1 "[Standard FileMaker Menus]", "[Spelling]") sind KEINE Katalog-Objekte → der
-- JOIN lässt sie weg (nur echte Custom Menus werden verlinkt). Menü-Sets sind datei-
-- lokal → Is_Cross_File = FALSE.
INSERT INTO ObjectLinks (Source_UUID, Source_Type, Target_UUID, Target_Type,
                          Link_Type, Link_Role, Link_Subrole,
                          Source_File, Target_File, Is_Cross_File)
WITH menuset_members AS (
    SELECT MenuSet_UUID, File_Name, UNNEST(Member_Menu_IDs) AS Menu_ID
    FROM CustomMenuSetCatalog
    WHERE Member_Menu_IDs IS NOT NULL
)
SELECT DISTINCT
    m.MenuSet_UUID  as Source_UUID,
    'CustomMenuSet' as Source_Type,
    cm.Menu_UUID    as Target_UUID,
    'CustomMenu'    as Target_Type,
    'structural'    as Link_Type,
    'contains_menu' as Link_Role,
    NULL            as Link_Subrole,
    m.File_Name     as Source_File,
    cm.File_Name    as Target_File,
    FALSE           as Is_Cross_File
FROM menuset_members m
JOIN CustomMenuCatalog cm
  ON cm.Menu_ID = m.Menu_ID AND cm.File_Name = m.File_Name;

-- Indexes für ObjectLinks
CREATE INDEX idx_objectlinks_source ON ObjectLinks(Source_UUID);
CREATE INDEX idx_objectlinks_target ON ObjectLinks(Target_UUID);
CREATE INDEX idx_objectlinks_type ON ObjectLinks(Link_Type);
CREATE INDEX idx_objectlinks_composite ON ObjectLinks(Source_Type, Target_Type);
CREATE INDEX idx_objectlinks_file ON ObjectLinks(Source_File, Target_File);
CREATE INDEX idx_objectlinks_crossfile ON ObjectLinks(Is_Cross_File);


-- ========================================
-- Klon-Robustheit: prefer-local-else-keep-cross-file (operationale Links)
-- ========================================
-- In geklonten/modularen Lösungen ("Kopie speichern unter…") ist Object_UUID NICHT
-- eindeutig — die Objekt-Identität ist das Paar (Object_UUID, File_Name). Die
-- generischen oc_target-JOINs oben binden ein Ziel allein über die UUID; existiert
-- dieselbe UUID in mehreren Klon-Dateien, fächert EINE operationale Kante über alle
-- diese Dateien (z.B. portal_context/right_table/left_table/context_table →
-- TableOccurrence, triggers_script/calls_script → Script). Das sind Klon-Artefakte:
-- eine Beziehung/ein Layout/ein Button referenziert die Kopie in der EIGENEN Datei.
--
-- Regel: existiert für eine Kante (Source_UUID, Source_File, Link_Role, Link_Subrole,
-- Target_UUID) ein datei-LOKALES Ziel (Target_File = Source_File), gewinnt dieses
-- (prefer-local) und alle cross-file Zeilen derselben Kante werden entfernt. Existiert
-- KEIN lokales Ziel, bleibt die Kante als echte Cross-File-Referenz erhalten (z.B.
-- externer Scriptaufruf / Set Field in eine zentrale Daten-/Archiv-Datei) — wir raten
-- NICHT willkürlich einen Klon (keep-cross-file). Ist das Cross-File-Ziel selbst
-- geklont, bleibt es bewusst mehrdeutig (dokumentierte Modellgrenze).
--
-- Containment/strukturelle Links sind bereits datei-gleich gejoint (Is_Cross_File=0)
-- → unberührt (Filter Link_Type='operational'). NULL-Ziel-Rollen (BuiltinFunction/
-- PluginFunction/calls_function: Target_File IS NULL) haben nie ein lokales Sibling
-- (NULL = Source_File ist nie wahr) → ebenfalls unberührt. Auf klon-freien Lösungen
-- existiert keine geteilte UUID → der DELETE trifft nichts (No-Op, bit-identisch).
DELETE FROM ObjectLinks ol
WHERE ol.Link_Type = 'operational'
  AND ol.Target_File IS DISTINCT FROM ol.Source_File
  AND EXISTS (
        SELECT 1 FROM ObjectLinks loc
        WHERE loc.Link_Type    = 'operational'
          AND loc.Source_UUID  = ol.Source_UUID
          AND loc.Source_File  = ol.Source_File
          AND loc.Link_Role    = ol.Link_Role
          AND loc.Link_Subrole IS NOT DISTINCT FROM ol.Link_Subrole
          AND loc.Target_UUID  = ol.Target_UUID
          AND loc.Target_File  = loc.Source_File
      );


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
