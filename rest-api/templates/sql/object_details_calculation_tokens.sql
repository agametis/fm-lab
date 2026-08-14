-- @template_type: report
-- @description: Standalone calculation by hash (Calculations have no top-level UUID)
-- @params: hash (required)
-- @output_format: tokens
-- @author: Marcel
-- @version: 1.2
-- @tags: calculations, ddr, tokens

-- Calc_Hash is NOT unique: multiple Calc_UUIDs may share a hash. Usually these are
-- identical multi-file copies of the same calc (any pick is equivalent), but the hash
-- can also collide across genuinely different formulas. The owner-based resolution used
-- by the field/CF/menu token templates (via v_calc_anchors) is NOT available here: this
-- endpoint (/api/get-calc) is keyed by hash alone with no owning object, so the minimal
-- (Calc_UUID, File_Name) pair is a best-effort pick. Callers that know the owner should
-- use the object-scoped templates.
WITH calc_uuid AS (
  SELECT Calc_UUID, File_Name
  FROM DDR_Calculations
  WHERE Calc_Hash = getvariable('hash')
  ORDER BY Calc_UUID, File_Name
  LIMIT 1
)
SELECT
  d.Calc_Hash AS hash,
  d.Chunk_Index AS chunk_index,
  d.Chunk_Type AS chunk_type,
  d.Chunk_Content AS chunk_content,
  -- Fachlicher Container-Plugin-Funktionsname (MBS) aus MBS_SubnameMap —
  -- positionsgenau (Calc_UUID + Chunk_Index) und inklusive der P3.5-Klartext-
  -- Recovery. Autoritativ gegenüber der Nachbar-Chunk-Heuristik des Formatters,
  -- die bei DDR-Chunk-Verlust (Kommentar am Aufruf, verschachtelte Aufrufe)
  -- prinzipbedingt leer ausgeht. NULL = kein MBS-Ref oder echt dynamisches
  -- 1. Argument.
  msn.SubName AS sub_function
FROM DDR_Calculations d
JOIN calc_uuid c ON d.Calc_UUID = c.Calc_UUID AND d.File_Name = c.File_Name
LEFT JOIN MBS_SubnameMap msn
       ON msn.Calc_UUID = d.Calc_UUID
      AND msn.File_Name = d.File_Name
      AND msn.Plugin_Chunk_Index = d.Chunk_Index
ORDER BY d.Chunk_Index;
