-- Local CSS as a ratio, aggregated PER LAYOUT rather than per object.
--
-- Local overrides are near-universal in practice (well over 90 % of all
-- objects in a mature solution), so an object-level findings list would be a
-- dump of the whole catalog rather than a set of defects. The useful signal is
-- the share per layout, and the min_share slider sets where "styled by hand"
-- starts. Layouts without objects are left out — a share of zero out of zero
-- is not a finding.
--
-- Findings are layout-level: object_uuid stays NULL and the row click opens
-- the layout without an object highlight.
-- Translated from fmCheckMate ReportLocalCSS (traffic-light idea).
WITH per_layout AS (
    SELECT lo.File_Name, lo.Layout_ID,
           COUNT(*) AS objects_total,
           COUNT(*) FILTER (WHERE lo.Object_XML LIKE '%<LocalCSS%') AS objects_with_css
    FROM LayoutObjects lo
    GROUP BY lo.File_Name, lo.Layout_ID
)
SELECT 'layout-local-css' AS rule_id, 'info' AS severity,
    p.File_Name AS file_name, ly.L_UUID AS nav_uuid, ly.L_Name AS layout_name,
    NULL AS object_uuid,
    p.objects_total, p.objects_with_css,
    ROUND(100.0 * p.objects_with_css / p.objects_total, 1) AS share_pct,
    p.objects_with_css || ' of ' || p.objects_total || ' objects on this layout carry local CSS ('
      || ROUND(100.0 * p.objects_with_css / p.objects_total, 1) || ' %)' AS message,
    row_number() OVER (ORDER BY (1.0 * p.objects_with_css / p.objects_total) DESC,
                                p.objects_with_css DESC, p.File_Name, ly.L_Name) AS row_key
FROM per_layout p
JOIN Layouts ly ON p.Layout_ID = ly.L_ID AND p.File_Name = ly.File_Name
WHERE p.objects_total > 0
  AND p.objects_with_css > 0
  AND 100.0 * p.objects_with_css / p.objects_total
      >= CAST(COALESCE(getvariable('min_share'), '50') AS DOUBLE)
  AND (getvariable('file') IS NULL OR p.File_Name = getvariable('file'))
  AND (getvariable('scope_uuids') IS NULL
       OR ly.L_UUID IN (SELECT unnest(string_split(getvariable('scope_uuids'), ','))))
ORDER BY row_key
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
