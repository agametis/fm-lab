-- @template_type: report
-- @description: Custom function with parameter list, raw code, and tokenized chunks
-- @params: uuid (required)
-- @output_format: tokens
-- @author: Marcel
-- @version: 1.1
-- @tags: customfunctions, ddr, tokens

WITH cf AS (
  SELECT
    cf.CF_UUID,
    cf.CF_Name,
    cf.File_Name,
    cf.Parameters,
    cf.DDR_Hash,
    ccf.Calculation_Code
  FROM CustomFunctionsCatalog cf
  LEFT JOIN CalcsForCustomFunctions ccf
    ON cf.CF_UUID = ccf.CF_UUID
   AND cf.File_Name = ccf.File_Name
  WHERE cf.CF_UUID = getvariable('uuid')
    -- Klon-Disambiguierung: LIMIT 1 würde sonst einen beliebigen Klon liefern.
    AND (getvariable('file') IS NULL OR cf.File_Name = getvariable('file'))
  LIMIT 1
),
-- Calc_Hash is not unique across DDR_Calculations: multiple Calc_UUIDs may share
-- a hash (semantic dedup). Pick exactly one Calc_UUID for the JOIN to avoid
-- a cross product over identical chunk sequences.
calc_uuid AS (
  SELECT MIN(d.Calc_UUID) AS Calc_UUID
  FROM DDR_Calculations d, cf
  WHERE d.Calc_Hash = cf.DDR_Hash
)
SELECT
  cf.CF_UUID AS object_uuid,
  cf.CF_Name AS object_name,
  cf.File_Name AS object_file,
  cf.Parameters AS parameters,
  cf.Calculation_Code AS plain_text,
  d.Chunk_Index AS chunk_index,
  d.Chunk_Type AS chunk_type,
  d.Chunk_Content AS chunk_content
FROM cf
LEFT JOIN calc_uuid ON TRUE
LEFT JOIN DDR_Calculations d
  ON d.Calc_UUID = calc_uuid.Calc_UUID
ORDER BY d.Chunk_Index NULLS FIRST;
