# fm-spec — the FileMaker language reference

**fm-spec** is FM-Lab's sister project. Where the object catalog describes *your* solution, fm-spec describes *FileMaker itself*: a universal, machine-readable semantic reference for the FileMaker language. It covers native script steps and calculation functions with stable IDs, official Claris documentation links, localized names, structured parameters, XML mappings and compatibility metadata. It is solution-independent by design — the same reference applies to every solution you ever analyze.

The reference is not written by hand and not scraped from a single place. It is assembled from manufacturer documentation and cross-checked against structural evidence from full-surface FileMaker corpora, then verified per FileMaker version. Every step and option carries its own `evidence` and `verified_version` marker, so a consumer can tell a confirmed fact from an assumption. The result is a single build artifact — `reference/fm_spec.duckdb` — deployed into FM-Lab by a scripted pipeline alongside a `fm_spec.meta.json` sidecar that records schema version and FileMaker coverage.

Inside FM-Lab, fm-spec is what turns generated code from plausible into correct. It backs the documentation lookup skills with an indexed local cache, and it is the backbone of the code-generation gate: script steps are resolved by ID rather than by name, options are validated against their declared types and allowed values, and XML is emitted from stored templates instead of string-built by a model. Because names are a localized display layer over stable IDs, the same generated artifact works regardless of the language the developer's FileMaker runs in.

---

## Simplified schema

The database is organized in four layers, all keyed by `step_id` (script steps) or `function_id` (functions). This page is the conceptual map — every table below links to its detailed schema description, and the complete table set (24 tables, including the category, per-parameter locale and legacy-ID satellites) is documented in the [schema reference](../schema/Schema.md).

**Canonical core** — the stable identity of every language element: [script_steps](../schema/fm-spec-tables/script_steps.md) (207 script steps with stable IDs, canonical names and XML element names) and [functions](../schema/fm-spec-tables/functions.md) (367 calculation functions), plus [step_options](../schema/fm-spec-tables/step_options.md) / [step_option_values](../schema/fm-spec-tables/step_option_values.md) (the full option grammar per step) and [function_parameters](../schema/fm-spec-tables/function_parameters.md) (parameter positions with optional/variadic flags).

**Language layer** — names and prose are a projection, never an identity: [script_steps_lang](../schema/fm-spec-tables/script_steps_lang.md) and [functions_lang](../schema/fm-spec-tables/functions_lang.md) carry the localized display names, descriptions and [official doc](../docsets/Doc%20Set%20claris-help.md) URLs (11 locales for steps, 10 for functions); [script_step_name_lookup](../schema/fm-spec-tables/script_step_name_lookup.md) and [function_name_lookup](../schema/fm-spec-tables/function_name_lookup.md) reverse any name in any locale back to the canonical ID.

**Emission layer** — how a step becomes XML: [step_xml_map](../schema/fm-spec-tables/step_xml_map.md) (snippet template, element order and a SaXML example per step), [step_constraints](../schema/fm-spec-tables/step_constraints.md) (structural rules a valid snippet must satisfy) and [step_compat](../schema/fm-spec-tables/step_compat.md) (where a step runs: Pro, Server, Go, WebDirect, Cloud, Data API, CWP).

**Action layer** — the fmIDE ActionScript vocabulary: [action_catalog](../schema/fm-spec-tables/action_catalog.md) (actions, their classification, accepted literals and plugin requirements) and [step_action_map](../schema/fm-spec-tables/step_action_map.md) (action ↔ step mapping including parameter mapping).

[reference_meta](../schema/fm-spec-tables/reference_meta.md) holds the build stamp: schema version, FileMaker coverage, source commit and the attribution pointer.


Schema content for every single script step together with its XML representations and parameter definitions is available in FM-Lab's web frontend as an interactive schema viewer, reachable from the fm-spec panel on the Settings page.

---

## Version Coverage

At this moment fm-spec holds full coverage of FileMaker v22.

All XML snippets are validated against a full-surface test corpus and by manual fmxmlsnippet comparison — 206 of 207 script steps are paired against real FileMaker output at version 22.0.2; the remaining one (`Configure Persistent Data`) rests on vendor documentation alone.

An update for the next FileMaker v26 release is on the roadmap.

---

## Outlook: what else this enables

The current build is used for lookups and for script generation, but the schema carries more than either consumes today. A few directions worth noting:

- **Round-trip editing.** With `xml_name`, `element_order` and the option grammar in one place, an agent can parse an existing snippet back into canonical text, modify it, and re-emit it — instead of generating from scratch every time.
- **Deterministic linting.** [step_options](../schema/fm-spec-tables/step_options.md) and [step_compat](../schema/fm-spec-tables/step_compat.md) already express enough to answer "is this option allowed here?" and "will this step run on Server?" without a model in the loop. That is a static check waiting to be wired into a rule set.
- **Locale-independent authoring.** The name-lookup tables let a developer write in their own language while the emitted artifact stays canonical — and read a foreign-language solution in their own.
- **Other output formats.** The emission layer is table-driven, so a new target format (fmJAML, SaXML for Claris patch tool, a diff-friendly text notation) is a new template column, not a new code path.
- **Other language specifications.** There are other initiatives in the FileMaker community space to build language dictionaries for reference and for agentic coding. As soon as stable standards are established, they could be mapped to the internal structure as an alternative way of exchanging code artifacts.
- **Grounding beyond FileMaker.** The same pattern — stable IDs, evidence markers, localized projection — is what makes any vendor API safely addressable by an agent. FileMaker is the first instance, not the only possible one.

---

## Sources & attribution

fm-spec is built from manufacturer documentation and from openly licensed community projects. The shipped database is source-neutral: it contains no citations, author names or corpus artifacts, and points at its attribution file through `reference_meta.attribution`.

Full source list, licenses and attribution: [reference/SOURCES.md](../../reference/SOURCES.md)
