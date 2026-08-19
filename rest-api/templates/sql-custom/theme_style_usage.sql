-- @template_type: report
-- @title: Theme and style usage per layout
-- @description: Which theme each layout runs on, how many of its objects override the theme with local CSS, and how many objects reference a named style. Reads as a styling map of the solution — a layout on a deprecated theme with a high override share is one that was styled object by object instead of through the theme, and is the expensive kind to restyle later. An inventory, not a defect list. Based on the fmCheckMate check "ListThemesAndStylesUsage" — https://github.com/mrwatson-de/fmCheckMate-XSLT
-- @icon: palette
-- @category: Layouts
-- @display: table
-- @chip_filter: theme
-- @chip_param: theme
-- @params: file (optional), limit (optional, default 500), theme (optional), min_share (optional, percentage floor for the local-CSS share)
-- @click_action: openObject
-- @click_args: uuid={{_nav_uuid}}&type=Layout&file={{file_name}}
-- @output_format: file_name, layout_name, theme, objects, css_overrides, css_share_pct, named_style_refs, _message, _chip_facets, _row_total
-- @object_types: Layout
-- @output_types: count, inventory-table
-- @scope: solution, file, object, object-list, cluster
-- @default_result: { "aggregate": "row_count", "type": "number", "name": "layouts_listed", "meaning": "Layouts in the styling inventory (inventory — not a defect count)" }
-- @author: fm-lab core
-- @version: 1.0
-- @tags: layouts, themes, styling, inventory, fmcheckmate
--
-- The theme comes from the resolved theme column of the layout, not from the
-- raw reference: the Classic theme is serialised as an EMPTY theme reference,
-- so reading the raw name would report the most common theme of all as "none".
--
-- Named styles are counted from the name attribute of the object's LocalCSS
-- element. On a Classic-themed solution that count is near zero by nature —
-- Classic has no named styles — which is itself the answer to "which styles do
-- we use". The names are entity-encoded in the raw XML and are therefore only
-- counted here, never joined against catalog names.
--
-- The theme chips switch SERVER-SIDE (`@chip_param: theme`) and carry the true
-- counts of the whole scope, not of the loaded page. That takes two convention
-- columns: `_chip_facets` (one entry per theme, counted over `base` — which
-- carries every filter EXCEPT the theme itself, otherwise each chip would only
-- ever show its own selection) and `_row_total` (rows before the LIMIT, counted
-- over `sel`, i.e. WITH the theme filter, so the header names the truncation
-- and only then). Both are computed before the LIMIT and repeat in every row.
WITH per_layout AS (
    SELECT lo.File_Name, lo.Layout_ID,
           COUNT(*) AS objects,
           COUNT(*) FILTER (WHERE lo.Object_XML LIKE '%<LocalCSS%') AS css_overrides,
           SUM(len(regexp_extract_all(lo.Object_XML, '<LocalCSS name="[^"]+"'))) AS named_style_refs
    FROM LayoutObjects lo
    GROUP BY 1, 2
),
base AS (
    SELECT
        ly.File_Name AS file_name,
        ly.L_UUID AS _nav_uuid,
        ly.L_Name AS layout_name,
        COALESCE(ly.L_Theme_Resolved_Name, '(none)') AS theme,
        COALESCE(p.objects, 0) AS objects,
        COALESCE(p.css_overrides, 0) AS css_overrides,
        CASE WHEN COALESCE(p.objects, 0) = 0 THEN 0
             ELSE ROUND(100.0 * p.css_overrides / p.objects, 1) END AS css_share_pct,
        CAST(COALESCE(p.named_style_refs, 0) AS INTEGER) AS named_style_refs,
        ly.L_Name || ' on ' || COALESCE(ly.L_Theme_Resolved_Name, '(none)') || ' — '
          || COALESCE(p.css_overrides, 0) || ' of ' || COALESCE(p.objects, 0)
          || ' objects styled locally' AS _message
    FROM Layouts ly
    LEFT JOIN per_layout p ON p.Layout_ID = ly.L_ID AND p.File_Name = ly.File_Name
    WHERE (ly.Folder_Type IS NULL OR ly.Folder_Type = 'False') AND NOT ly.Is_Separator
      AND (getvariable('min_share') IS NULL
           OR (COALESCE(p.objects, 0) > 0
               AND 100.0 * p.css_overrides / p.objects >= CAST(getvariable('min_share') AS DOUBLE)))
      AND (getvariable('file') IS NULL OR ly.File_Name = getvariable('file'))
      AND (getvariable('scope_uuids') IS NULL
           OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
),
sel AS (
    SELECT * FROM base
    WHERE (getvariable('theme') IS NULL OR theme = getvariable('theme'))
)
SELECT s.*,
    (SELECT json_group_object(theme, n)
       FROM (SELECT theme, count(*) AS n FROM base GROUP BY 1)) AS _chip_facets,
    (SELECT count(*) FROM sel) AS _row_total
FROM sel s
ORDER BY css_overrides DESC, objects DESC, file_name, layout_name
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
