-- Relationships that sort their related records, extended by consumer
-- context (community pattern, Claris "Top Tips" cloud-performance KB):
-- a relationship-level sort runs for EVERY consumer of the relation, while a
-- portal-level sort costs only where it is displayed. The two consumer
-- columns make the recommendation decidable per row:
--   consumer_portals  = portals whose context is the sorted side's TO
--   portals_own_sort  = of those, portals that carry their own sort anyway
-- A sorted relationship whose portals all sort themselves (or that has no
-- portal consumer at all) pays the relationship sort for nothing visible.
-- Approximation, documented: a portal displaying the sorted TO is counted as
-- consumer regardless of which relationship path its layout context uses.
WITH sorted_rels AS (
    SELECT DISTINCT File_Name, Rel_ID, Left_TO_Name, Right_TO_Name,
           Left_Sort_Enabled, Right_Sort_Enabled,
           CASE WHEN Left_Sort_Enabled = 'True' THEN Left_TO_UUID END AS sorted_left_uuid,
           CASE WHEN Right_Sort_Enabled = 'True' THEN Right_TO_UUID END AS sorted_right_uuid
    FROM RelationshipCatalog
    WHERE Left_Sort_Enabled = 'True' OR Right_Sort_Enabled = 'True'
),
portal_ctx AS (
    SELECT ol.Source_UUID AS portal_uuid, ol.Target_UUID AS to_uuid
    FROM ObjectLinks ol
    JOIN ObjectCatalog s ON ol.Source_UUID = s.Object_UUID AND s.Object_Type = 'LayoutObject'
    WHERE ol.Link_Role = 'portal_context'
),
portal_sorted AS (
    SELECT DISTINCT Source_UUID AS portal_uuid FROM ObjectLinks WHERE Link_Role = 'sorts_by_field'
),
consumers AS (
    SELECT sr.File_Name, sr.Rel_ID,
           CAST(count(DISTINCT pc.portal_uuid) AS INTEGER) AS consumer_portals,
           CAST(count(DISTINCT pc.portal_uuid) FILTER (WHERE ps.portal_uuid IS NOT NULL) AS INTEGER) AS portals_own_sort
    FROM sorted_rels sr
    JOIN portal_ctx pc ON pc.to_uuid IN (sr.sorted_left_uuid, sr.sorted_right_uuid)
    LEFT JOIN portal_sorted ps ON ps.portal_uuid = pc.portal_uuid
    GROUP BY 1, 2
)
SELECT 'relationship-with-sort' AS rule_id, 'info' AS severity,
    r.File_Name AS file_name, 'rel_' || r.Rel_ID || '_' || r.File_Name AS nav_uuid,
    r.Left_TO_Name AS left_to, r.Right_TO_Name AS right_to,
    CASE WHEN r.Left_Sort_Enabled = 'True' AND r.Right_Sort_Enabled = 'True' THEN 'both sides'
         WHEN r.Left_Sort_Enabled = 'True' THEN 'left' ELSE 'right' END AS sorted_side,
    COALESCE(c.consumer_portals, 0) AS consumer_portals,
    COALESCE(c.portals_own_sort, 0) AS portals_own_sort,
    row_number() OVER (ORDER BY r.File_Name, r.Left_TO_Name, r.Rel_ID) AS row_key
FROM sorted_rels r
LEFT JOIN consumers c ON c.File_Name = r.File_Name AND c.Rel_ID = r.Rel_ID
WHERE (getvariable('file') IS NULL OR r.File_Name = getvariable('file'))
  -- Chip filter: 'portals' = at least one consumer portal, 'sorted-portals' =
  -- at least one of them sorts itself (the strongest "move the sort to the
  -- portal" candidates). The summary keeps its totals unfiltered.
  AND (getvariable('consumer_filter') IS NULL
       OR (getvariable('consumer_filter') = 'portals' AND COALESCE(c.consumer_portals, 0) > 0)
       OR (getvariable('consumer_filter') = 'sorted-portals' AND COALESCE(c.portals_own_sort, 0) > 0))
ORDER BY r.File_Name, r.Left_TO_Name, r.Rel_ID
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
