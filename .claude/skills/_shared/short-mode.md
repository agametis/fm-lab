# Shared: Short mode (`--short`)

Shared activation and output rules for the short mode of `fm-summarize` and `fm-analyze`.
Each skill keeps its own **mode-differences table**, **reduced-query list** and **example
outputs** — this file defines only what is identical between the two.

## Activation

1. **Explicit flag** `--short` — position is free (before or after the object name):
   `/<skill> <object> --short`, `/<skill> --short <object>`, `/<skill> --short <UUID>`.
2. **Natural language** — activate short mode automatically when the request contains one
   of the trigger words below, even without `--short`. Detection is **case-insensitive**
   and language-agnostic; the keyword may appear anywhere in the prompt.

| Lang | Trigger words |
|---|---|
| EN | short, brief, brief summary, brief analysis, short description, concise, concise analysis, 1-2 sentences, in a few sentences, rough, overview, TL;DR, TLDR |
| DE | kurz, knapp, knappe Zusammenfassung, knappe Analyse, Kurzbeschreibung, Kurzanalyse, 1-2 Sätze, in wenigen Sätzen, grob, überblicksartig |
| ES | breve, corto, resumen breve, análisis breve, descripción breve, conciso, en pocas frases, 1-2 frases |
| FR | bref, court, résumé bref, analyse brève, description brève, concis, en quelques phrases, 1-2 phrases |
| IT | breve, corto, riepilogo breve, analisi breve, descrizione breve, conciso, in poche frasi, 1-2 frasi |
| NL | kort, beknopt, korte samenvatting, korte analyse, korte beschrijving, in een paar zinnen, 1-2 zinnen |
| PT | breve, curto, resumo breve, análise breve, descrição breve, conciso, em poucas frases, 1-2 frases |
| SV | kort, kortfattat, kort sammanfattning, kort analys, kort beskrivning, koncis, med några meningar, 1-2 meningar |
| JA | 短く, 簡潔に, 簡単に, 要約, 簡易分析, 短い説明, 概要, 1-2文で |
| KO | 짧게, 간단히, 간략히, 요약, 간단 분석, 짧은 설명, 개요, 1-2문장으로 |
| ZH | 简短, 简要, 简单介绍, 简要分析, 简短说明, 概要, 1-2句话 |

## Output rules (both skills)

Short mode is **1-2 paragraphs of prose**. The section structure of standard mode is
dropped entirely. Prohibited:

- No Markdown headers (`##`, `###`)
- No lists / bullet points
- No tables
- No code blocks
- No UUID display (technical detail belongs in standard mode)

**Identification is unaffected**: even in short mode the object must first be uniquely
resolved (Step 1 is indispensable).

**If short mode delivers too little information**: append ONE hint sentence such as
*"For the full detail call `/<skill> <name>` without `--short`."*
