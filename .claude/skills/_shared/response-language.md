# Shared: Response language

Shared policy for `fm-summarize` and `fm-analyze`. Reply in the language the user used for
their prompt — that is the primary signal (English question → English answer, Spanish →
Spanish, even if the project default is German). Explicit overrides ("antworte auf
Deutsch", "answer in English", "responde en español") take precedence over the detected
prompt language.

## What gets translated to the response language

- Markdown section headers of the report (e.g. EN `### Purpose` ↔ DE `### Zweck` ↔ ES
  `### Propósito` ↔ FR `### Objectif` ↔ IT `### Scopo` ↔ NL `### Doel` ↔ PT
  `### Propósito` ↔ SV `### Syfte` ↔ JA `### 目的` ↔ KO `### 목적` ↔ ZH `### 目的`) — the
  English headers in the skill templates are illustrative
- Prose: purpose, business context, notes, descriptive remarks, open questions, hedging
- Generic table column headings (Field / Action / Comment, …)

## What stays original / English regardless of response language

- **FileMaker identifiers** (script, field, layout, table, TO, relationship, and variable
  names like `$$Modul`, `$kundenID`) — must match the actual FileMaker source 1:1
- **`Link_Role` values** (`calls_script`, `sets_field`, `displays_field`,
  `navigates_to_layout`, `triggers_script`, …) — technical labels of the data model
- **SQL queries, column names, table names of the DuckDB catalog** — always English (DDL
  identifiers)
- **CLI flags** (`--short`) and skill-call tokens (`/fm-summarize`, `/fm-analyze`)

## Hedging vocabulary (for interpreting skills)

A skill that interprets (fm-analyze) MUST mark conclusions that are not hard facts with
hedging vocabulary **in the response language**, and keep fact (from the DB) and
interpretation (from naming/context) clearly separated. fm-summarize interprets only the
Purpose line and otherwise reports facts.

| Lang | Hedging terms |
|---|---|
| EN | presumably, indicates, suggests, appears to |
| DE | vermutlich, deutet darauf hin, weist auf … hin, wirkt wie |
| ES | presumiblemente, indica, sugiere, parece |
| FR | vraisemblablement, indique, suggère, semble |
| IT | presumibilmente, indica, suggerisce, sembra |
| NL | vermoedelijk, wijst op, suggereert, lijkt |
| PT | presumivelmente, indica, sugere, parece |
| SV | förmodligen, tyder på, antyder, verkar |
| JA | おそらく, 示唆している, ～と思われる |
| KO | 아마도, 시사한다, ～로 보인다 |
| ZH | 可能, 表明, 暗示, 似乎 |
