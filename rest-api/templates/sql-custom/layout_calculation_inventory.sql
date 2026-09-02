-- @template_type: report
-- @title: Layout calculation inventory
-- @description: Every layout calculation (<<ƒ:…>>, German UI: Layoutformel) placed in a layout text object, one row per calculation instance with its formula, result type, evaluation context and the reconstructed layout anchor. Layout calculations live invisibly inside text blocks, so this inventory is where formulas scattered across layouts become readable side by side. Not to be confused with merge fields (<<Field>>) or merge variables (<<$$var>>) — those have their own inventories.
-- @icon: calculation
-- @category: Layouts
-- @display: table
-- @chip_filter: result_type
-- @chip_param: result_type
-- @params: file (optional), limit (optional, default 500), result_type (optional)
-- @click_action: openObject
-- @click_args: uuid={{_object_uuid}}&ref={{_nav_uuid}}&file={{file_name}}
-- @row_action: openObject
-- @row_action_args: uuid={{_nav_uuid}}&type=Layout&file={{file_name}}&ref={{_object_uuid}}
-- @row_action_label: Show in layout
-- @output_format: file_name, layout_name, object_name, formula, result_type, context_to, anchor, recovered, _message, _chip_facets, _row_total
-- @object_types: Layout
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "layout_calculations", "meaning": "Layout-calculation instances on layout text objects in scope (inventory — not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: layouts, merge, calculations, inventory
--
-- Companion of the merge-field and merge-variable inventories: same shape,
-- same scope model. One row per calculation INSTANCE (CalculationsCatalog,
-- role display_calculation) — a text block carrying several <<ƒ:…>> anchors
-- yields several rows, Calc_Index keeps the in-text order.
--
-- `anchor` reconstructs the layout text anchor '<<ƒ:' + result-type prefix +
-- formula + '>>' — the exact inverse of the converter derivation (schema
-- 1.27.0): Text has no prefix, Number/Date/Time/Timestamp map to
-- %N:/%D:/%I:/%M:, an unknown prefix is stored raw as '%X' in Result_Type and
-- travels through unchanged. Same bijection as the API's layoutFormula field.
--
-- `recovered` marks instances whose DDR chunk list was empty (a DDR defect on
-- typed layout calculations): formula and reference edges were rescued from
-- the layout text at import. Honest provenance, not a defect count.
--
-- The result-type chips switch SERVER-SIDE (`@chip_param: result_type`) over
-- the whole scope. `_chip_facets` counts over `base` — every filter EXCEPT the
-- result type itself — while `_row_total` counts over `sel` (WITH that
-- filter), so the header names the truncation and only then.
WITH base AS (
    SELECT
        cc.File_Name AS file_name,
        ly.L_UUID AS _nav_uuid,
        ly.L_Name AS layout_name,
        -- No object_type column: display_calculation instances live on Text
        -- objects by definition — a constant column carries no information.
        COALESCE(NULLIF(trim(lo.Object_Name), ''), '(unnamed)') AS object_name,
        replace(cc.Formula_Text, chr(10), ' ') AS formula,
        COALESCE(NULLIF(cc.Result_Type, ''), '(unknown)') AS result_type,
        cc.Context_TO_Name AS context_to,
        CASE WHEN cc.Formula_Text IS NULL OR cc.Formula_Text = '' THEN NULL
             ELSE '<<ƒ:' ||
                  CASE COALESCE(cc.Result_Type, '')
                      WHEN 'Number'    THEN '%N:'
                      WHEN 'Date'      THEN '%D:'
                      WHEN 'Time'      THEN '%I:'
                      WHEN 'Timestamp' THEN '%M:'
                      ELSE CASE WHEN starts_with(COALESCE(cc.Result_Type, ''), '%')
                                THEN cc.Result_Type || ':' ELSE '' END
                  END || replace(cc.Formula_Text, chr(10), ' ') || '>>'
        END AS anchor,
        CASE WHEN cc.DDR_Calc_UUID IS NULL THEN 'yes' ELSE 'no' END AS recovered,
        lo.Object_Type || ' ' || COALESCE(NULLIF(trim(lo.Object_Name), ''), '(unnamed)')
          || ' — layout calculation (' || COALESCE(NULLIF(cc.Result_Type, ''), 'unknown') || ') '
          || COALESCE(replace(cc.Formula_Text, chr(10), ' '), '(no formula)')
          || CASE WHEN cc.DDR_Calc_UUID IS NULL THEN ' (recovered)' ELSE '' END AS _message,
        cc.Owner_UUID AS _object_uuid,
        cc.Calc_Index AS _calc_order
    FROM CalculationsCatalog cc
    JOIN LayoutObjects lo ON cc.Owner_UUID = lo.Object_UUID AND cc.File_Name = lo.File_Name
    JOIN Layouts ly ON lo.Layout_ID = ly.L_ID AND lo.File_Name = ly.File_Name
    WHERE cc.Calc_Role = 'display_calculation'
      AND (getvariable('file') IS NULL OR cc.File_Name = getvariable('file'))
      AND (getvariable('scope_uuids') IS NULL
           OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
),
sel AS (
    SELECT * FROM base
    WHERE (getvariable('result_type') IS NULL OR result_type = getvariable('result_type'))
)
SELECT s.* EXCLUDE (_calc_order),
    (SELECT json_group_object(result_type, n)
       FROM (SELECT result_type, count(*) AS n FROM base GROUP BY 1)) AS _chip_facets,
    (SELECT count(*) FROM sel) AS _row_total
FROM sel s
ORDER BY file_name, layout_name, object_name, _object_uuid, _calc_order
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
