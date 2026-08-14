-- @template_type: report
-- @description: UUID-precise occurrences of duplicated UUIDs within single files, captured by the import census (DuplicateAbsorptionDetails). Since UUID healing (schema 1.19.0) the twins are HEALED instead of absorbed: each occurrence exists in the catalog (kept-original under the source UUID, healed under a deterministic replacement UUID in Healed_UUID). Navigation targets the occurrence's own object (for script steps via the containing script with a step anchor); heal_status 'absorbed' marks the remaining collapse cases (double serialization, FM_UUID_HEAL=0 runs, pre-healing DBs).
-- @params: file (optional), limit (optional, default 500)
WITH params AS (
    SELECT NULLIF(CAST(getvariable('file') AS VARCHAR), '') AS file_filter
),
det AS (
    SELECT
        d.File_Name,
        d.Catalog,
        d.Object_UUID,
        d.Object_Name,
        d.Object_Type,
        d.Occurrence_Seq,
        d.Parent_Name,
        d.Position,
        d.Display_Text,
        d.Heal_Status,
        d.Healed_UUID,
        d.Discriminator,
        -- Catalog UUID of THIS occurrence: healed twins live under the replacement
        -- UUID, kept-original under the source UUID (UUID healing, schema 1.19.0)
        COALESCE(d.Healed_UUID, d.Object_UUID) AS catalog_uuid,
        st.Script_UUID AS step_script_uuid,
        st.Script_Name AS step_script_name,
        oc.Object_Type AS survivor_type,
        oc.Object_Name AS survivor_name
    FROM DuplicateAbsorptionDetails d
    LEFT JOIN StepsForScripts st
           ON d.Catalog = 'StepsForScripts'
          AND st.Step_UUID = COALESCE(d.Healed_UUID, d.Object_UUID)
          AND st.File_Name = d.File_Name
    LEFT JOIN ObjectCatalog oc
           ON d.Catalog <> 'StepsForScripts'
          AND oc.Object_UUID = COALESCE(d.Healed_UUID, d.Object_UUID)
          AND oc.File_Name = d.File_Name
    CROSS JOIN params p
    WHERE (p.file_filter IS NULL OR d.File_Name = p.file_filter)
)
SELECT
    'uuid-intrafile-duplicate' AS rule_id,
    'warning' AS severity,
    File_Name AS file,
    Catalog AS catalog,
    Object_UUID AS dup_uuid,
    Object_Name AS name,
    Object_Type AS type,
    Occurrence_Seq AS occ,
    Parent_Name AS parent,
    Position AS position,
    Display_Text AS display,
    COALESCE(Heal_Status, 'absorbed') AS heal_status,
    Healed_UUID AS healed_uuid,
    Discriminator AS discriminator,
    COALESCE(step_script_name, survivor_name) AS surviving,
    COALESCE(step_script_uuid, CASE WHEN survivor_type IS NOT NULL THEN catalog_uuid END) AS nav_uuid,
    COALESCE(CASE WHEN step_script_uuid IS NOT NULL THEN 'Script' END, survivor_type) AS nav_type,
    CASE WHEN step_script_uuid IS NOT NULL THEN catalog_uuid END AS step_uuid,
    row_number() OVER (ORDER BY File_Name, Catalog, Object_UUID, Occurrence_Seq) AS row_key
FROM det
ORDER BY File_Name, Catalog, Object_UUID, Occurrence_Seq
LIMIT CAST(COALESCE(NULLIF(CAST(getvariable('limit') AS VARCHAR), ''), '500') AS INTEGER);
