-- streamify-Override für LayoutObjects.
-- Ersetzt den read_xml_objects-DOM-Read (ganzes Dokument) durch per-Record-SAX-
-- Streaming auf dem vom Renamer eindeutig gemachten Anker LC_Layout. Nur die ersten
-- CTEs (raw_layouts/layouts_resolved/layout_parts) ändern sich; die rekursive
-- Objekt-Extraktion + INSERT bleiben identisch zur Basis. Ergebnis ist bit-identisch
-- zur DOM-Basis BIS AUF die Roh-Spalte Object_XML (SAX-Serialisierung, semantisch
-- äquivalent — Downstream-Invarianz bewiesen).
WITH RECURSIVE filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
-- STREAMING: ein Record je LC_Layout; PartsList-Subtree als VARCHAR (Klasse-C).
layouts_resolved AS (
    SELECT
        "id"::BIGINT as Layout_ID,
        '<PartsList>' || PartsList || '</PartsList>' as parts_wrapped
    FROM read_xml(
        getvariable('fm_xml'),
        record_element='LC_Layout',
        maximum_file_size=getvariable('dom_threshold'),
        streaming=getvariable('use_streaming'),
        columns={'id':'BIGINT','PartsList':'VARCHAR'}
    )
    WHERE PartsList IS NOT NULL
),
layout_parts AS (
    SELECT
        Layout_ID,
        unnest(xml_extract_elements(parts_wrapped, '/PartsList/Part')) as part_xml
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
        fm_canon_layout_type(
            xml_extract_text(object_xml, '/LayoutObject/@type')[1],
            xml_extract_text(object_xml, '/LayoutObject/@kind')[1]::INTEGER,
            object_xml) as Object_Type,
        xml_unescape(xml_extract_text(object_xml, '/LayoutObject/@name')[1]) as Object_Name,
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
        Layout_ID, Part_Type, Object_ID, Object_Type, Object_Name, Object_Kind,
        Object_Hash, Object_UUID, Bounds_Top, Bounds_Left, Bounds_Bottom, Bounds_Right,
        Parent_Object_ID, Nesting_Level, Z_Order,
        Hide_Calculation_Text, Tooltip_Calculation_Text, Label_Calculation_Text,
        ScriptTrigger_Parameter_Text, Text_Content, object_xml
    FROM root_objects

    UNION ALL

    SELECT
        parent.Layout_ID,
        parent.Part_Type,
        xml_extract_text(child_xml, '/LayoutObject/@id')[1]::BIGINT as Object_ID,
        fm_canon_layout_type(
            xml_extract_text(child_xml, '/LayoutObject/@type')[1],
            xml_extract_text(child_xml, '/LayoutObject/@kind')[1]::INTEGER,
            child_xml) as Object_Type,
        xml_unescape(xml_extract_text(child_xml, '/LayoutObject/@name')[1]) as Object_Name,
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
        COALESCE(
            xml_extract_text(child_xml, '/LayoutObject/Text/StyledText/Data')[1],
            xml_extract_text(child_xml, '/LayoutObject/Title/Text')[1]
        ) as Text_Content,
        child_xml as object_xml
    FROM nested_objects parent
    CROSS JOIN LATERAL unnest(
        -- DIREKTE Kind-Achsen (B-K1) — identisch zur DOM-Basis (Begründung dort).
        CASE
            WHEN parent.Object_Type = 'Popover Button'
                THEN xml_extract_elements(parent.object_xml, '/LayoutObject/PopoverButton/LayoutObject')
            WHEN parent.Object_Type = 'PopoverPanel'
                THEN xml_extract_elements(parent.object_xml, '/LayoutObject/ObjectList/LayoutObject')
            ELSE xml_extract_elements(parent.object_xml, '/LayoutObject/*/ObjectList/LayoutObject')
        END
    ) WITH ORDINALITY AS t(child_xml, z_order)
    WHERE parent.Object_Type IN (
        'Portal','Group','Tab Control','Panel','Container','Button Bar',
        'Slide Control','Grouped Button','PopoverPanel','Popover Button'
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
    -- NULL-PK-Guard (B-K2) — identisch zur DOM-Basis (Begründung dort).
    COALESCE(Object_UUID, md5(
        'LayoutObjectNoUUID|' ||
        COALESCE(Layout_ID::VARCHAR, '') || '|' ||
        COALESCE(Object_ID::VARCHAR, '') || '|' ||
        COALESCE(Object_Type, '') || '|' ||
        COALESCE(Part_Type, '') || '|' ||
        COALESCE(Nesting_Level::VARCHAR, '') || '|' ||
        COALESCE(Z_Order::VARCHAR, '')
    )) as Object_UUID,
    Bounds_Top,
    Bounds_Left,
    Bounds_Bottom,
    Bounds_Right,
    Parent_Object_ID,
    Nesting_Level,
    Z_Order,
    ws_restore(Hide_Calculation_Text) as Hide_Calculation_Text,
    ws_restore(Tooltip_Calculation_Text) as Tooltip_Calculation_Text,
    ws_restore(Label_Calculation_Text) as Label_Calculation_Text,
    ws_restore(ScriptTrigger_Parameter_Text) as ScriptTrigger_Parameter_Text,
    ws_restore(Text_Content) as Text_Content,
    ws_restore(object_xml::VARCHAR) as Object_XML,
    fn.File_Name as File_Name
-- DETERMINISTISCHES DEDUP (Chunk-Invarianz, These 1b) — identisch zur DOM-Basis:
-- mit den direkten Kind-Achsen (B-K1) bleibt nur die bekannte Doppel-Serialisierung
-- (Part-Root + GroupedButton-ObjectList, 12 Korpus-Fälle); pro (Layout_ID, Object_UUID)
-- gewinnt die flachste Emission (min Nesting_Level). NULL-UUID-Objekte bleiben erhalten.
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

-- Zensus (Dup-Absorption): deduplizierte Emissionsmenge des LayoutObjects-INSERTs —
-- SAX-Fassung, quellgleich zum Zensus im DOM-Block der Basis (dort begründet).
-- Schlanke Zweit-Rekursion über den LC_Layout-Stream (gleiche Kind-Achsen/Container-
-- Typen wie oben), nur Typ/UUID fürs Zählen; je (Layout_ID, Object_UUID) EINE
-- Emission, NULL-UUID-Objekte einzeln (md5-Fallback-PK).
WITH RECURSIVE census_parts AS (
    SELECT
        Layout_ID,
        unnest(xml_extract_elements(parts_wrapped, '/PartsList/Part')) as part_xml
    FROM (
        SELECT
            "id"::BIGINT as Layout_ID,
            '<PartsList>' || PartsList || '</PartsList>' as parts_wrapped
        FROM read_xml(
            getvariable('fm_xml'),
            record_element='LC_Layout',
            maximum_file_size=getvariable('dom_threshold'),
            streaming=getvariable('use_streaming'),
            columns={'id':'BIGINT','PartsList':'VARCHAR'}
        )
        WHERE PartsList IS NOT NULL
    )
),
census_objects AS (
    SELECT
        Layout_ID,
        fm_canon_layout_type(
            xml_extract_text(object_xml, '/LayoutObject/@type')[1],
            xml_extract_text(object_xml, '/LayoutObject/@kind')[1]::INTEGER,
            object_xml) as Object_Type,
        xml_extract_text(object_xml, '/LayoutObject/UUID')[1] as Object_UUID,
        object_xml
    FROM census_parts
    CROSS JOIN LATERAL unnest(
        xml_extract_elements(part_xml, '/Part/ObjectList/LayoutObject')
    ) AS t(object_xml)

    UNION ALL

    SELECT
        parent.Layout_ID,
        fm_canon_layout_type(
            xml_extract_text(child_xml, '/LayoutObject/@type')[1],
            xml_extract_text(child_xml, '/LayoutObject/@kind')[1]::INTEGER,
            child_xml) as Object_Type,
        xml_extract_text(child_xml, '/LayoutObject/UUID')[1] as Object_UUID,
        child_xml as object_xml
    FROM census_objects parent
    CROSS JOIN LATERAL unnest(
        CASE
            WHEN parent.Object_Type = 'Popover Button'
                THEN xml_extract_elements(parent.object_xml, '/LayoutObject/PopoverButton/LayoutObject')
            WHEN parent.Object_Type = 'PopoverPanel'
                THEN xml_extract_elements(parent.object_xml, '/LayoutObject/ObjectList/LayoutObject')
            ELSE xml_extract_elements(parent.object_xml, '/LayoutObject/*/ObjectList/LayoutObject')
        END
    ) AS t(child_xml)
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
INSERT INTO DuplicateAbsorptions
SELECT getvariable('fm_file'), 'LayoutObjects', 'Object_UUID,File_Name',
       COALESCE(getvariable('seq_offset'), 0)::BIGINT,
       COUNT(*) FILTER (WHERE Object_UUID IS NULL)
         + COUNT(DISTINCT (Layout_ID, Object_UUID)) FILTER (WHERE Object_UUID IS NOT NULL)
FROM census_objects
ON CONFLICT (Catalog, File_Name, Chunk_Seq) DO UPDATE SET Source_Records = EXCLUDED.Source_Records;
