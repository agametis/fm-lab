-- ============================================
-- build_resolutions.sql
-- ============================================
-- Datei-übergreifende Heimat-Auflösungs-Tabellen.
-- Wird nach allen File-Imports vom Batch-Skript einmalig aufgerufen
-- (auch im Single-File-Modus). Vollständiger Neuaufbau, keine Migration.
--
-- Erzeugt:
--   - ObjectHomes: kanonische Heimat-Datei pro Object-UUID (alle Schema-Objekt-Typen)
--   - TableOccurrenceResolution: TO → BaseTable + Heimat-Datei (DS-basiert)
--
-- Siehe: project/prd_rest_api_token_extended_infos.md §4.1, §4.2

-- --------------------------------------------
-- ObjectHomes — Single Source of Truth pro Objekt
-- --------------------------------------------
DROP TABLE IF EXISTS ObjectHomes;
CREATE TABLE ObjectHomes (
    Object_UUID  VARCHAR PRIMARY KEY,
    Object_Type  VARCHAR NOT NULL,
    Object_Name  VARCHAR NOT NULL,
    Home_File    VARCHAR NOT NULL,
    Source       VARCHAR NOT NULL    -- 'direct' | 'resolved_via_basetable'
);

-- Block 1: Direkte Heimat aus ObjectCatalog.
-- Field-/Script-UUIDs sind global eindeutig (PRD §2.1, §2.2) — ein Eintrag pro Objekt.
-- Plugin-Functions sind kein FileMaker-Schema-Objekt → nicht enthalten.
-- Variables sind kein Schema-Objekt → nicht enthalten (siehe Validierungsfilter §6.1).
INSERT INTO ObjectHomes
SELECT
    oc.Object_UUID,
    oc.Object_Type,
    oc.Object_Name,
    oc.File_Name AS Home_File,
    'direct' AS Source
FROM ObjectCatalog oc
WHERE oc.Object_Type IN (
    'Field', 'Script', 'Layout', 'CustomFunction', 'ValueList',
    'Theme', 'CustomMenu', 'ScriptTrigger', 'Account', 'PrivilegeSet',
    'ExternalDataSource', 'BaseDirectory', 'LayoutPart',
    'BaseTable', 'TableOccurrence', 'Relationship'
)
ON CONFLICT (Object_UUID) DO NOTHING;

-- Block 2: BaseTable-Heimat über Feld-Anzahl auflösen.
-- Schatten-BTs in referenzierenden Files können EINIGE Schatten-Felder haben
-- (typischerweise wenige, z.B. 3 Felder vs. 158 in der echten Heimat).
-- Die "lokal-Felder-Detektion" (NOT EXISTS) versagt deshalb. Stattdessen:
-- Unter allen gleichnamigen BTs ist diejenige mit den meisten Feldern die echte Heimat.
-- Falls mehrere BTs gleich viele Felder haben (Edge-Case): ORDER BY File_Name LIMIT 1
-- für Determinismus (PRD §7.8).
UPDATE ObjectHomes oh
SET Home_File = sub.real_home,
    Source    = 'resolved_via_basetable'
FROM (
    WITH bt_with_field_count AS (
        SELECT
            bt.BT_UUID,
            bt.BT_Name,
            bt.File_Name,
            (SELECT COUNT(*) FROM FieldsForTables ff
             WHERE ff.Table_UUID = bt.BT_UUID AND ff.File_Name = bt.File_Name) AS field_count
        FROM BaseTableCatalog bt
    ),
    bt_canonical AS (
        SELECT BT_Name, File_Name AS canonical_file, field_count
        FROM bt_with_field_count
        QUALIFY ROW_NUMBER() OVER (PARTITION BY BT_Name ORDER BY field_count DESC, File_Name) = 1
    )
    SELECT
        oh_inner.Object_UUID,
        bt_canonical.canonical_file AS real_home
    FROM ObjectHomes oh_inner
    JOIN BaseTableCatalog bt_self
      ON bt_self.BT_UUID = oh_inner.Object_UUID
    JOIN bt_canonical
      ON bt_canonical.BT_Name = bt_self.BT_Name
    WHERE oh_inner.Object_Type = 'BaseTable'
      AND oh_inner.Home_File <> bt_canonical.canonical_file
      AND bt_canonical.field_count > 0  -- echte BT muss mind. 1 Feld haben
) sub
WHERE oh.Object_UUID = sub.Object_UUID
  AND sub.real_home IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_objecthomes_type ON ObjectHomes(Object_Type);
CREATE INDEX IF NOT EXISTS idx_objecthomes_name ON ObjectHomes(Object_Name);


-- --------------------------------------------
-- TableOccurrenceResolution — TO Cross-File-Mapping
-- --------------------------------------------
DROP TABLE IF EXISTS TableOccurrenceResolution;
-- Local_BT_UUID/Canonical_BT_Name sind NULLable, weil verwaiste TableOccurrences
-- (TO ohne BaseTable-Verknüpfung — im XML mit fehlendem BT_UUID) vorkommen.
CREATE TABLE TableOccurrenceResolution (
    TO_UUID           VARCHAR NOT NULL,
    File_Name         VARCHAR NOT NULL,
    TO_Name           VARCHAR NOT NULL,
    Local_BT_UUID     VARCHAR,
    Canonical_BT_Name VARCHAR,
    Home_File         VARCHAR NOT NULL,
    Resolution_Type   VARCHAR NOT NULL,    -- 'local' | 'cross_file_ds' | 'orphan'
    Data_Source_Name  VARCHAR,
    PRIMARY KEY (TO_UUID, File_Name)
);

INSERT INTO TableOccurrenceResolution
SELECT
    toc.TO_UUID,
    toc.File_Name,
    toc.TO_Name,
    toc.BT_UUID  AS Local_BT_UUID,
    toc.BT_Name  AS Canonical_BT_Name,
    -- Path kann komplex sein: einzelner Pfad mit Leerzeichen im Dateinamen
    -- (z.B. 'file:Belegpositionen Einkauf'), Pfad mit Verzeichnis-Slashes
    -- ('file:../ERP/Artikel'), oder Multi-Path-Liste mit Fallbacks
    -- ('file:Artikel file:../ERP/Artikel'). Schritt 1: Alles ab '<space>file:'
    -- entfernen, damit nur der primäre Pfad bleibt. Schritt 2: 'file:'-Prefix
    -- abschneiden und letzten Path-Component (basename) extrahieren — Slashes
    -- markieren Verzeichnis-Hierarchie, der Dateiname kommt zuletzt.
    COALESCE(
        regexp_replace(
            regexp_extract(
                regexp_replace(eds.Path, '\s+file:.*$', ''),
                '^file:(?:.*/)?(.+)$',
                1
            ),
            '\.fmp12$', ''   -- Suffix entfernen, da File_Name in unseren Tabellen ohne ".fmp12" gespeichert ist
        ),
        toc.File_Name
    ) AS Home_File,
    CASE
        WHEN toc.DS_UUID IS NOT NULL AND eds.Path IS NOT NULL THEN 'cross_file_ds'
        WHEN toc.DS_UUID IS NULL                              THEN 'local'
        ELSE 'orphan'
    END AS Resolution_Type,
    toc.DS_Name AS Data_Source_Name
FROM TableOccurrenceCatalog toc
LEFT JOIN ExternalDataSourceCatalog eds
  ON toc.DS_UUID  = eds.DS_UUID
 AND toc.File_Name = eds.File_Name
ON CONFLICT (TO_UUID, File_Name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_tor_to_uuid ON TableOccurrenceResolution(TO_UUID);
CREATE INDEX IF NOT EXISTS idx_tor_file    ON TableOccurrenceResolution(File_Name);
