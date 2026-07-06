-- @template_type: report
-- @description: Field with metadata, raw calculation text, and tokenized DDR chunks
-- @params: uuid (required)
-- @output_format: tokens
-- @author: Marcel
-- @version: 1.0
-- @tags: fields, ddr, tokens
-- @note: Liefert Calculation-Tokens für Calculated- und AutoEnter-Calculated-Felder.
--        Calc-Instanz robust über v_calc_anchors (Owner-UUID + Owner-Datei) aufgelöst
--        — NICHT über den mehrdeutigen Calc_Hash (siehe Kommentar an der calc_uuid-CTE).
--        Plain-Text aus Calculation_Text bzw. AE_Calc_Text (XML CDATA, vollständig).
--        AE_ConstantData liefert den festen Vorgabewert bei AutoEnter „ConstantData".

WITH fld AS (
  SELECT
    f.Field_UUID,
    f.Field_Name,
    f.File_Name,
    f.Table_Name,
    f.Field_Type,
    f.Data_Type,
    f.Is_Global,
    f.Max_Repetitions,
    f.Field_Comment,
    f.AutoEnter_Type,
    f.AE_ConstantData,
    COALESCE(f.Calculation_Text, f.AE_Calc_Text) AS Effective_Text
  FROM FieldsForTables f
  JOIN ObjectCatalog oc ON f.Field_UUID = oc.Object_UUID AND f.File_Name = oc.File_Name
  WHERE oc.Object_UUID = getvariable('uuid')
    -- Klon-Disambiguierung: LIMIT 1 würde sonst einen beliebigen Klon liefern.
    AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
  LIMIT 1
),
-- Robuste Calc-Auflösung über die kanonische Anker-Registry v_calc_anchors.
-- NICHT über Calc_Hash: der Hash ist NICHT eindeutig — semantisch-triviale Formeln
-- (z.B. Auto-Enter-„Konto-Name") teilen sich einen Hash über viele fremde Owner
-- (~16 % der Calc-Felder betroffen); ein MIN(Calc_UUID) pro Hash lieferte die
-- Chunks eines FREMDEN Felds → falsche Formel. Auch Calc_UUID/Field_UUID allein
-- genügt nicht, weil Field_UUID bei Klonen mehrfach (über Dateien) vorkommt.
-- Erst die robuste Kombination Owner-UUID + Owner-Datei löst eindeutig auf (1:1),
-- und der DDR-JOIN wird ebenfalls datei-skopiert (analog custommenu-Templates).
calc_uuid AS (
  SELECT va.Calc_UUID, va.Owner_File AS File_Name
  FROM v_calc_anchors va, fld
  WHERE va.Owner_Type = 'Field'
    AND va.Owner_UUID = fld.Field_UUID
    AND va.Owner_File = fld.File_Name
  LIMIT 1
)
SELECT
  fld.Field_UUID         AS object_uuid,
  fld.Field_Name         AS object_name,
  fld.File_Name          AS object_file,
  fld.Table_Name         AS table_name,
  fld.Field_Type         AS field_type,
  fld.Data_Type          AS data_type,
  fld.Is_Global          AS is_global,
  fld.Max_Repetitions    AS max_repetitions,
  fld.Field_Comment      AS field_comment,
  fld.AutoEnter_Type     AS auto_enter_type,
  fld.AE_ConstantData    AS ae_constant_data,
  fld.Effective_Text     AS plain_text,
  d.Chunk_Index          AS chunk_index,
  d.Chunk_Type           AS chunk_type,
  d.Chunk_Content        AS chunk_content,
  cfh.Object_UUID        AS chunk_ref_uuid
FROM fld
LEFT JOIN calc_uuid ON TRUE
LEFT JOIN DDR_Calculations d
  ON d.Calc_UUID = calc_uuid.Calc_UUID
 AND d.File_Name = calc_uuid.File_Name
-- CustomFunctionRef-Chunks tragen anders als FieldRef nur den CF-Namen, keine
-- UUID. Für Cross-Navigation (klickbarer Link) UND Cross-Reference-Highlight
-- lösen wir den Namen file-lokal über ObjectHomes auf (CF-Namen sind je Datei
-- eindeutig — analog object_references_script.sql). Inner-Name wird aus dem
-- Chunk-Wrapper extrahiert und die Standard-XML-Entities werden dekodiert.
LEFT JOIN ObjectHomes cfh
  ON d.Chunk_Type    = 'CustomFunctionRef'
 AND cfh.Object_Type = 'CustomFunction'
 AND cfh.Home_File   = fld.File_Name
 AND cfh.Object_Name = replace(replace(replace(replace(replace(
       regexp_extract(d.Chunk_Content, '<Chunk[^>]*>(.*)</Chunk>', 1),
       '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', ''''), '&amp;', '&')
ORDER BY d.Chunk_Index NULLS FIRST;
