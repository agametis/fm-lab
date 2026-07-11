# Data Sources & Attribution

This file documents the sources behind the bundled FileMaker reference database
(`rest-api/db/fm_reference.duckdb`). The shipped data is **source-neutral**: it
contains no source citations, author/company names or corpus artifacts. The
database points at this file through its `reference_meta.attribution` key.

## Manufacturer documentation (normative)

- **Claris FileMaker Pro help** (help.claris.com) — names, descriptions,
  parameter prose, version information and per-object documentation deep links.
  Documentation content © Claris International Inc. FileMaker and Claris are
  trademarks of Claris International Inc. This project is not affiliated with,
  authorized, or endorsed by Claris.

## CC BY 4.0 (attribution required)

- **"Canonical XML Format for FileMaker Script Steps"** — Andrew Kear, Clockwork
  Creative Technology. Licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Used for
  roundtrip-verified fmxmlsnippet skeletons, paste/silent-failure semantics and
  save constraints.

## MIT

- **fmCheckMate-XSLT** — MrWatson (mrwatson-de). Full-surface test corpus used
  as primary structural evidence for the step grammar and options.
- **fm-xml-export-exploder** — Malte Bastian (bc-m). Used to validate the SaXML
  parameter-type classification.
- **ooe-fm** ("One Of Everything") — Mislav Kos (Soliant Consulting). Used for
  SaXML version diffs.

---

Example payloads (`step_xml_map.saxml_example`) were originally derived from the
MIT-licensed full-surface corpus. Since reference schema 1.7.1 all payload
content (comments, calculations, URLs) is synthetic and instance identity is
removed; the corpus attribution therefore covers structural evidence only, not
any shipped content.
