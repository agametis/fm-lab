-- @template_type: report
-- @title: Conditional formatting inventory
-- @description: Every conditional-formatting condition on a layout object, with its formula and the CSS it applies. Conditional formatting is invisible in Layout mode and invisible in the catalog's resolved links, so this inventory is the only place the rules become readable side by side — which is where duplicated conditions, formulas left over from a renamed field and colour rules nobody remembers become visible. Based on the fmCheckMate check "ListConditionalFormatting" — https://github.com/mrwatson-de/fmCheckMate-XSLT
-- @icon: palette
-- @category: Layouts
-- @display: table
-- @chip_filter: object_type
-- @chip_param: object_type
-- @params: file (optional), limit (optional, default 500), object_type (optional)
-- @click_action: openObject
-- @click_args: uuid={{_nav_uuid}}&type=Layout&file={{file_name}}&ref={{_object_uuid}}
-- @output_format: file_name, layout_name, object_type, object_name, condition_no, condition_calc, css, _message, _chip_facets, _row_total
-- @object_types: Layout
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "conditions", "meaning": "Conditional-formatting conditions in scope (inventory — not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: layouts, formatting, styling, inventory, fmcheckmate
--
-- SaveAsXML serialises conditional formatting as <Conditions><Formatting …>
-- with one <Condition type="…"> per rule, each carrying its <Calculation> and
-- the <LocalCSS> it applies. Note that <Conditions> also wraps the object's
-- Hide condition, so the extraction keys on <Condition type=, not on the
-- surrounding element.
--
-- Leaf filter, mandatory: the Object_XML of a container (portal, popover panel,
-- group, grouped button) contains the XML of all its children nested inside it.
-- Extracting without the filter would attribute every child's conditions to the
-- ancestor as well and roughly double the inventory.
--
-- The formula and the CSS come out of the raw XML and are therefore
-- entity-encoded; they are shown as text only and never joined against
-- catalog names.
--
-- The object-type chips switch SERVER-SIDE (`@chip_param: object_type`) over
-- the whole scope. `_chip_facets` counts over `base` — every filter EXCEPT the
-- object type itself, otherwise each chip would only ever show its own
-- selection — while `_row_total` counts over `sel`, i.e. WITH that filter, so
-- the header names the truncation and only then.
WITH leaf AS (
    SELECT lo.File_Name, lo.Layout_ID, lo.Object_UUID, lo.Object_Type, lo.Object_Name, lo.Object_XML
    FROM LayoutObjects lo
    WHERE lo.Object_XML LIKE '%<Condition type=%'
      AND NOT EXISTS (SELECT 1 FROM LayoutObjects k
                       WHERE k.File_Name = lo.File_Name
                         AND k.Layout_ID = lo.Layout_ID
                         AND k.Parent_Object_ID = lo.Object_ID)
),
blocks AS (
    SELECT l.File_Name, l.Layout_ID, l.Object_UUID, l.Object_Type, l.Object_Name,
           regexp_extract_all(l.Object_XML, '<Condition type=.*?</Condition>', 0, 's') AS block_list
    FROM leaf l
),
conds AS (
    -- unnest and generate_subscripts over the SAME list column stay aligned,
    -- which is what numbers the conditions in their serialisation order.
    SELECT b.File_Name, b.Layout_ID, b.Object_UUID, b.Object_Type, b.Object_Name,
           unnest(b.block_list) AS block,
           generate_subscripts(b.block_list, 1) AS condition_no
    FROM blocks b
),
base AS (
    SELECT
        c.File_Name AS file_name,
        ly.L_UUID AS _nav_uuid,
        ly.L_Name AS layout_name,
        c.Object_Type AS object_type,
        COALESCE(NULLIF(trim(c.Object_Name), ''), '(unnamed)') AS object_name,
        c.condition_no,
        replace(regexp_extract(c.block, '<Text><!\[CDATA\[(.*?)\]\]></Text>', 1, 's'), chr(10), ' ') AS condition_calc,
        replace(regexp_extract(c.block, '<LocalCSS[^>]*><!\[CDATA\[(.*?)\]\]></LocalCSS>', 1, 's'), chr(10), ' ') AS css,
        c.Object_Type || ' ' || COALESCE(NULLIF(trim(c.Object_Name), ''), '(unnamed)')
          || ' — condition ' || c.condition_no || ' when '
          || COALESCE(NULLIF(replace(regexp_extract(c.block, '<Text><!\[CDATA\[(.*?)\]\]></Text>', 1, 's'), chr(10), ' '), ''), '(no formula)') AS _message,
        c.Object_UUID AS _object_uuid
    FROM conds c
    JOIN Layouts ly ON c.Layout_ID = ly.L_ID AND c.File_Name = ly.File_Name
    WHERE (getvariable('file') IS NULL OR c.File_Name = getvariable('file'))
      AND (getvariable('scope_uuids') IS NULL
           OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
),
sel AS (
    SELECT * FROM base
    WHERE (getvariable('object_type') IS NULL OR object_type = getvariable('object_type'))
)
SELECT s.*,
    (SELECT json_group_object(object_type, n)
       FROM (SELECT object_type, count(*) AS n FROM base GROUP BY 1)) AS _chip_facets,
    (SELECT count(*) FROM sel) AS _row_total
FROM sel s
ORDER BY file_name, layout_name, object_name, condition_no
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
