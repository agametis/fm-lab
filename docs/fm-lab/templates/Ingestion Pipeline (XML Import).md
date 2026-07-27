# Ingestion Pipeline (XML Import)

**Directory:** `sql/convert-xml/*.sql` · **Run by:** the conversion pipeline
(orchestrated) — **not** the REST API

This is not analysis SQL but the **build** SQL that produces the DuckDB object
catalog every other tier queries. It turns a FileMaker `SaveCopyAsXML` export
into the resolved tables and edges (`ObjectCatalog`, `ObjectLinks`,
`FieldsForTables`, …). Part of the [SQL Templates](SQL%20Templates.md) family, documented here so
the full picture of "where SQL lives in FM-Lab" is complete.

## The phases

The phase files run in order:

| File | Phase |
|---|---|
| `convert_xml_01_extract.sql` | P1 · extract objects from the XML export |
| `convert_xml_02_resolve.sql` | P2 · resolve links (read-only) |
| `convert_xml_03_details.sql` | P3 · derived detail columns |
| `convert_xml_04_catalog.sql` | P4 · build `ObjectCatalog` / `ObjectLinks` |
| `convert_xml_05_homes.sql` | P5 · home / ownership resolution |
| `convert_xml_06_validate.sql` | P6 · validation gate |

There is also a `.streamify.sql` variant of P1
(`convert_xml_01_extract.streamify.sql`) for the split/streaming path used on
large exports.

## How it runs

You normally never invoke these by hand — the [XML conversion](../Wiki/katana-engine.md)
pipeline orchestrates them end to end (P1 → P6, plus the analysis views and
auto-clustering). Trigger it through the convert-xml skill or the web import
button; both share a lock file so a second caller fails fast.

The distinction from [CLI Analysis Scripts](CLI%20Analysis%20Scripts.md) is direction: those **read** the
catalog, these **produce** it. Once P6 passes, the catalog is ready for every
query tier — [Built-in Query Templates](Built-in%20Query%20Templates.md), [Custom Query Templates](Custom%20Query%20Templates.md) and the
[Dashboard Datasets](Dashboard%20Datasets.md).

## See also

- [SQL Templates](SQL%20Templates.md) — the overview of all template tiers
- [XML conversion](../Wiki/katana-engine.md) — the pipeline that orchestrates these phases
- [CLI Analysis Scripts](CLI%20Analysis%20Scripts.md) — the read-side counterpart
- [Folder structure](../Wiki/Folder%20structure.md) — the repository layout
