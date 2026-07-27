# ref_element_semantics

Part of the [FM-Lab schema](../Schema.md) · Emission layer · `reference/fm_spec.duckdb` (fm-spec language reference)

How the reference elements inside step XML (Field, Table, Layout, …) are resolved: which solution-catalog table they resolve against, the resolution strategy, and the fmIDE URL parameter they map to. The small glue table between the language reference and a concrete solution catalog.

## Columns

| Column | Type |
|---|---|
| `element` | `VARCHAR` |
| `resolution` | `VARCHAR` |
| `catalog_table` | `VARCHAR` |
| `fmide_url_param` | `VARCHAR` |

**See also:** [step_xml_map](step_xml_map.md)
