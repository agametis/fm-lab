-- Options of the person filter: one entry per person (spelling variants merged
-- by the curated aliases of v_change_meta_authors). Technical authors only with
-- technical=include, matching the list.
SELECT a.Person_Key AS value, any_value(a.Display_Name) AS label
FROM v_change_meta_authors a
GROUP BY a.Person_Key
HAVING COALESCE(NULLIF(CAST(getvariable('technical') AS VARCHAR), ''), 'hide') = 'include'
    OR bool_or(NOT a.Is_Technical)
ORDER BY lower(any_value(a.Display_Name)), a.Person_Key;
