-- streamify-Override für StepsForScripts (project/plan_xml_diff_streaming_preprocess.md).
-- read_xml_objects(ganzes Dokument) → per-Record-SAX-Streaming auf dem vom Renamer
-- eindeutig gemachten Anker SFS_Script. ScriptReference (nested-Attr-STRUCT, via
-- gepatchtem webbed) liefert Script_ID/Name/UUID; ObjectList-Subtree als VARCHAR
-- (Klasse-C) → Steps re-extrahiert. Step-Extraktion + INSERT identisch zur Basis.
-- Bit-identisch zur DOM-Basis bis auf die Roh-Spalten Step_XML/Parameters_XML
-- (SAX-Serialisierung, semantisch äquivalent — Downstream-Invarianz §8).
WITH filename_normalized AS (
    SELECT getvariable('fm_file') as File_Name
),
scripts_resolved AS (
    SELECT
        ScriptReference.id::BIGINT as Script_ID,
        ScriptReference.name as Script_Name,
        ScriptReference.UUID as Script_UUID,
        '<ObjectList>' || ObjectList || '</ObjectList>' as steps_wrapped
    FROM read_xml(
        getvariable('fm_xml'),
        record_element='SFS_Script',
        maximum_file_size=getvariable('dom_threshold'),
        streaming=getvariable('use_streaming'),
        columns={
            'ScriptReference': 'STRUCT(id BIGINT, name VARCHAR, UUID VARCHAR)',
            'ObjectList': 'VARCHAR'
        }
    )
    WHERE ObjectList IS NOT NULL
),
script_steps AS (
    SELECT
        Script_ID,
        Script_Name,
        Script_UUID,
        unnest(xml_extract_elements(steps_wrapped, '/ObjectList/Step')) as step_xml
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
