---
name: fm-generate-script
version: 0.9.0
description: Generates FileMaker scripts as paste-ready fmxmlsnippet XML through a reference-driven pipeline - canonical text draft, deterministic lint, object-reference resolution against the DuckDB catalog (real IDs, machine-readable resolution report), table-driven XML emission from fm_spec.duckdb, and a three-layer validation gate. Successor of filemaker-script-erzeugen. Triggers (English) - "create a FileMaker script", "generate a script for X", "build an fmxmlsnippet". Triggers (German) - "erstelle ein FileMaker-Script", "generiere ein Script fuer X", "baue ein Script-Snippet".
---

# fm-generate-script — reference-driven FileMaker script generation

Every artifact goes through this pipeline. Never hand-write snippet XML from
memory: the XML shape comes from `fm_spec.duckdb` (table-driven), the
object IDs come from `db/fm_catalog.duckdb` (resolved, not guessed).

## Pipeline (mandatory)

```
P0 CONTEXT   conventions + target objects from catalog/registry
P1 DRAFT     script in canonical text form (one step per line)
P2-P6        scripts/fmgen.py run  (normalize -> lint -> resolve -> emit -> gate)
P7 DELIVER   snippet + resolution report + gate protocol + redelivery warning
```

A failure in lint/resolve/gate goes back to P1 with the findings — never
"continue with warning" unless the user explicitly decides to.

### P0 — Context

1. Read the conventions block in `docs/agents/codegen-registry.md`
   (function-name locale, naming language). Fill gaps by inspecting the
   catalog (existing script names, comments) — never from the conversation
   language. If `variable_init_check` is `on` there, pass `--check-var-init`
   to `fmgen.py` (or export `FMGEN_CHECK_VAR_INIT=1`) — it is a house
   convention and is off by default.
2. Identify the target file and every object the script will touch (layouts,
   fields, scripts, value lists) and verify them in `ObjectCatalog` **before**
   drafting. Ask the user which file is the target if ambiguous.

### P1 — Draft (canonical text form)

Write the draft to a `.fmscript` file (scratchpad or `output/codegen/`).
Rules (fm-spec `script-text-notation.md` v0.1, condensed):

- One step per line, step name first — any of the 11 locales works, it is
  canonicalized by lookup. Multi-line calculations are fine.
- One bracket group: `Step Name [ param ; Label: value ; ... ]`.
- Fields `TO::Field`, layouts `"Name" (TO)`, scripts `"Name"`,
  variables `$x` / `$$x`. Comments `# text`, disabled steps `// ` prefix.
- **Calculations use canonical EN function names** (`Get`, not `Hole`) —
  see the conventions block in `codegen-registry.md`. The lint warns on
  localized names (L007).
- References to objects the script itself creates or that must be created
  first: `{{NEW:Field:TO::Name}}` — they surface in the report as
  "create before paste".
- The same declaration works **inside a calculation**, but only for custom
  functions: `{{NEW:CustomFunction:CleanTags}} ( $x )` marks a function that
  is not in the catalog yet. It is stripped before emission (the snippet
  contains `CleanTags ( $x )`), listed as "create before paste", and exempt
  from the existence and arity checks — snippet-wide, so declaring it once
  covers every use in the draft. **Unmarked** calls stay fully checked; a typo
  like `Substitue (` remains a hard error. Creating the function before the
  paste is on you.
- Dialog-only options use extension labels: `Button1: "OK"`,
  `Input1: TO::Field`, `Input1Label: "..."`.

### P2–P6 — Run the pipeline

```bash
python3 .claude/skills/fm-generate-script/scripts/fmgen.py run \
    draft.fmscript --file "<TargetFile>" --out-dir output/codegen/<name>
```

Produces `<name>.xml` (snippet), `.ir.json` (parsed IR + lint findings),
`.resolved.json` (IR with real IDs + resolution report), `.gate.json`
(check-by-check protocol). Exit 2 = errors, fix the draft and re-run;
exit 3 = environment problem (databases missing).

Individual phases for debugging: `fmgen.py parse|resolve|emit|gate` (see
`--help`). Databases resolve to `reference/fm_spec.duckdb` and
`db/fm_catalog.duckdb` from the repo root; override with `--reference-db` /
`--catalog-db` or `FMGEN_REFERENCE_DB` / `FMGEN_CATALOG_DB`. With an active
session pin (`FMLAB_SOLUTION`/`FMLAB_CONTEXT`, CLAUDE.md §2) pass
`--catalog-db solutions/<id>/db/fm_catalog.duckdb` so references resolve
against the pinned solution.

**When the emitter reports "not supported by the table-driven emitter"**
(multi-instance structures beyond the covered set, exotic steps): author that
step's XML manually against the reference —
`SELECT snippet_template, saxml_example FROM step_xml_map WHERE step_id = ?`
— splice it in, and ALWAYS run `fmgen.py gate` on the final XML. Say in the
delivery that this step was hand-authored.

**Degradation:** if `fm_catalog.duckdb` has no data for the target file,
resolution falls back to name-only placeholders (`id="1"`) and says so in the
report — deliver only with an explicit caveat. If the reference DB is missing
entirely, stop and offer `install-claris-docs`.

### P7 — Delivery

Always include, in this order:

1. The snippet file path (and the XML inline if short).
2. The resolution report: resolved refs (real IDs), new objects to create
   before paste, assumptions.
3. Gate protocol summary — each failed/skipped check by name; never claim
   "validated" when a check was skipped. Report `warning` checks explicitly,
   they are findings the user has to act on:
   - `G109-doc-only` — enum values documented by Claris but not
     roundtrip-verified; never present them as verified.
   - `G304-calc-arity` — a custom function is called with the wrong number of
     arguments. `warning` means the catalog declares no parameters for it (it
     may be a custom-function folder, which the catalog cannot distinguish);
     `fail` means a genuine count mismatch.
   - `G305-var-init` — a variable is written as a step target without a
     preceding `Set Variable`. Opt-in convention (P0); `skipped` when it is off
     or when the gate ran without the IR.
4. Redelivery warning: pasting twice duplicates the script. Snippet paste can
   only ADD scripts, not edit in place.
5. Verification recommendation: paste, save, copy back to clipboard, diff
   against the generated XML (see `references/paste-semantics.md` §Verify).

Paste path: FileMaker Pro > Scripts panel > paste (Cmd/Ctrl+V). With MBS
installed, `MBS("Clipboard.SetMonitorEnabled"; 1)` enables XML<->clipboard
conversion; without plugins see `references/paste-semantics.md` §Delivery.

### Optional target: fmIDE ActionScript (`fmgen.py actionscript`)

Experimental second emission target (reference schema >= 1.8.0 required —
tables `action_catalog`/`step_action_map`). Two modes:

```bash
fmgen.py actionscript DRAFT.ir.json                 # translate parsed steps
fmgen.py actionscript --wrap-snippet S.xml --script-name "Target"  # delivery wrapper
```

Output JSON payload: `actions` (the interpreter's native JSON array),
`fmjaml` (authoring notation, array forms only), `findings`,
`capability_notes`. Gate: unknown action / registry-only / support=No are
hard errors (G-A01..A03); steps without action mapping or without curated
`param_map` abort deterministically (G-A04/G-A05) — exactly like unknown
step IDs in the snippet path. Values are FM calc expressions (fmIDE
evaluates them); literals must be quoted, the `fmxmlsnippet` parameter is
consumed raw and rendered as an fmJAML heredoc.

Delivery of an ActionScript is OUT of scope of this skill's validation: it
requires a running fmIDE (>= 0.60) in the target file under [Full Access],
macOS + MBS for most IDE actions, `fmurlscript` for the fmp-URL channel —
report `capability_notes` to the user with the artifact. Roundtrip
verification against a live fmIDE is pending; treat the target as
experimental.

## Editing existing scripts

Before touching any existing artifact file, create a backup next to it:
`<name>_backup_<YYYY-MM-DD>_<HH-MM-SS>.xml`. Remember: a re-pasted snippet is
a NEW copy of the script — in-place edits are a future delivery path (fmIDE
ActionScript / FMUpgradeTool), not part of this skill yet.

## References

- `references/paste-semantics.md` — silent-failure and save-invalid catalog,
  delivery/verification recipes (sources incl. andykear spec, CC BY 4.0).
- `references/mbs-guidelines.md` — when (not) to use MBS, object lifecycle,
  path conversion.
- `references/worked-example.md` — full pipeline walkthrough with artifacts.
- Function/step documentation: use the `filemaker-function-reference` and
  `mbs-function-reference` skills; grammar ad hoc via
  `duckdb reference/fm_spec.duckdb -c "..."`.
