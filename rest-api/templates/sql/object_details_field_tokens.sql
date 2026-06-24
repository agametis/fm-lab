-- @template_type: report
-- @description: Field with metadata, raw calculation text, and tokenized DDR chunks
-- @params: uuid (required)
-- @output_format: tokens
-- @author: Marcel
-- @version: 1.0
-- @tags: fields, ddr, tokens
-- @note: Liefert Calculation-Tokens für Calculated- und AutoEnter-Calculated-Felder.
--        Bei beiden gefüllt würde DDR_Hash (echte Calculated Fields) priorisiert.
--        Plain-Text aus Calculation_Text bzw. AE_Calc_Text (XML CDATA, vollständig).

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
    f.Calculation_Text,
    f.AE_Calc_Text,
    f.DDR_Hash,
    f.AE_Calc_Hash,
    COALESCE(f.DDR_Hash, f.AE_Calc_Hash) AS Effective_Hash,
    COALESCE(f.Calculation_Text, f.AE_Calc_Text) AS Effective_Text
  FROM FieldsForTables f
  JOIN ObjectCatalog oc ON f.Field_UUID = oc.Object_UUID AND f.File_Name = oc.File_Name
  WHERE oc.Object_UUID = getvariable('uuid')
    -- Klon-Disambiguierung: LIMIT 1 würde sonst einen beliebigen Klon liefern.
    AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
  LIMIT 1
),
-- Calc_Hash ist nicht eindeutig: mehrere Calc_UUIDs können sich einen Hash teilen
-- (semantische Dedup). Wir nehmen exakt eine Calc_UUID pro Hash, um doppelte
-- Chunk-Reihen zu vermeiden (analog object_details_customfunction_tokens.sql).
calc_uuid AS (
  SELECT MIN(d.Calc_UUID) AS Calc_UUID
  FROM DDR_Calculations d, fld
  WHERE d.Calc_Hash = fld.Effective_Hash
    AND fld.Effective_Hash IS NOT NULL
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
  fld.Effective_Text     AS plain_text,
  d.Chunk_Index          AS chunk_index,
  d.Chunk_Type           AS chunk_type,
  d.Chunk_Content        AS chunk_content
FROM fld
LEFT JOIN calc_uuid ON TRUE
LEFT JOIN DDR_Calculations d
  ON d.Calc_UUID = calc_uuid.Calc_UUID
ORDER BY d.Chunk_Index NULLS FIRST;
