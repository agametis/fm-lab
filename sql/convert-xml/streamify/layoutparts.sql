-- streamify-Override für LayoutParts.
-- read_xml_objects(ganzes Dokument) → per-Record-SAX-Streaming auf LC_Layout;
-- PartsList-Subtree als VARCHAR (Klasse-C) → Parts re-extrahiert. LayoutParts speichert
-- KEINE Roh-XML-Spalte → voll bit-identisch zur DOM-Basis erwartet. Part-Extraktion
-- + INSERT identisch zur Basis.
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
layouts_resolved AS (
    SELECT
        "id"::BIGINT as Layout_ID,
        "name" as Layout_Name,
        '<PartsList>' || PartsList || '</PartsList>' as parts_wrapped
    FROM read_xml(
        getvariable('fm_xml'),
        record_element='LC_Layout',
        maximum_file_size=getvariable('dom_threshold'),
        streaming=getvariable('use_streaming'),
        columns={'id':'BIGINT','name':'VARCHAR','PartsList':'VARCHAR'}
    )
    WHERE "id" IS NOT NULL AND PartsList IS NOT NULL
),
layout_parts AS (
    SELECT
        Layout_ID,
        Layout_Name,
        unnest(xml_extract_elements(parts_wrapped, '/PartsList/Part')) as part_xml
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
