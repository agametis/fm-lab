-- @template_type: report
-- @description: Standalone calculation by hash (Calculations have no top-level UUID)
-- @params: hash (required)
-- @output_format: tokens
-- @author: Marcel
-- @version: 1.1
-- @tags: calculations, ddr, tokens

-- Calc_Hash is NOT unique: multiple Calc_UUIDs may share a hash. Usually these are
-- identical multi-file copies of the same calc (any pick is equivalent), but the hash
-- can also collide across genuinely different formulas. The owner-based resolution used
-- by the field/CF/menu token templates (via v_calc_anchors) is NOT available here: this
-- endpoint (/api/get-calc) is keyed by hash alone with no owning object, so MIN(Calc_UUID)
-- is a best-effort pick. Callers that know the owner should use the object-scoped templates.
WITH calc_uuid AS (
  SELECT MIN(Calc_UUID) AS Calc_UUID
  FROM DDR_Calculations
  WHERE Calc_Hash = getvariable('hash')
)
SELECT
  d.Calc_Hash AS hash,
  d.Chunk_Index AS chunk_index,
  d.Chunk_Type AS chunk_type,
  d.Chunk_Content AS chunk_content
FROM DDR_Calculations d
JOIN calc_uuid c ON d.Calc_UUID = c.Calc_UUID
ORDER BY d.Chunk_Index;
