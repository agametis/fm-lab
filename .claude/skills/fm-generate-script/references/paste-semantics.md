# Paste semantics — failure catalog and delivery recipes

Why a snippet that *pastes* cleanly can still be broken: FileMaker validates
in three stages (paste, save, runtime) and fails silently in several known
patterns. The machine-readable versions of these rules live in
`fm_spec.duckdb` (`step_constraints`, `step_xml_map`) and are enforced
by `fmgen.py gate`; this file is the human-readable background.

Sources: fm-lab corpus roundtrips (fm-spec, evidence `paired`), the andykear
FileMaker-XMLsnippet spec (CC BY 4.0, Andy Kear — vendored under
`project/inspiration/andykear/`), fmCheckMate fixtures (MIT), own findings.

## Silent failures (paste succeeds, content wrong)

| Pattern | Effect | Guard |
|---|---|---|
| Set Variable (141) `Name` element missing/mangled | variable name silently dropped; markdown/HTML layers can strip `<Name>` to `<n>` — never route the XML through a rendering layer | gate G107; construct the tag programmatically |
| Perform JavaScript in Web Viewer (175): flat `Parameter` elements | pastes cleanly, passes **no** arguments — needs `Parameters Count="N"` container with `P` children | constraint catalog |
| Install OnTimer Script (148): top-level `Calculation` | binds to the script-parameter slot, timer never fires at the intended rate — interval must be `Interval/Calculation` | constraint catalog |
| Element order wrong (e.g. Set Field `Field` before `Calculation`) | options silently dropped or misassigned | gate G106 checks order against `step_xml_map.element_order` |
| Wrong step id with plausible name | FileMaker trusts the id, not the name (classic: 23 = Show All Records, not New Record = 7) | gate G104/G105; ids only from the reference |

## Save-invalid (paste + roundtrip OK, file refuses to save)

| Pattern | Detail |
|---|---|
| Set Variable value `Self` | FileMaker silently drops the whole `Value` element on save → "invalid script step" |
| Commit/Revert Transaction (206/207) inside If/Else | pastes and roundtrips byte-identical, then the FILE fails to save — keep transaction closers flat, branch to a flat commit (lint L008) |
| Add Account (134) bare form | AccountName, Password and PrivilegeSet are required; PrivilegeSet resolves **by id** — name fallback invalid |
| Bare skeletons of steps with required content | a `<Step>` without its required child elements can be save-invalid even when paste accepts it |

## Runtime traps

- **Unresolved references**: FileMaker pastes unknown field/layout/script
  names as broken references (`<Field missing>`); that is why P4 resolution
  errors stop the pipeline.
- **PrivilegeSet & other by-id-strict elements**: resolved by id at paste
  time; a wrong id silently binds to the wrong privilege set.
- **Localized calc text**: German FileMaker *exports* clipboard calcs
  localized (`Hole`), SaXML stores EN. Generated snippets use canonical EN
  function names (registry convention) — if a paste test shows EN calcs
  failing in a localized client, escalate; do not silently switch locale.

## Redelivery

Pasting the same snippet twice creates a duplicate script (FileMaker appends
" 2"). Snippet paste cannot modify an existing script. For iterations: delete
the old copy first, or paste into a folder and swap manually. Say this in
every delivery.

## Delivery paths (descending preference)

1. **fmIDE present** (check like the `fm-open` skill does): set clipboard
   text, then fmp-URL `Convert Clipboard` + `Paste` — no plugin needed.
2. **MBS installed**: `MBS("Clipboard.SetMonitorEnabled"; 1)` once, then
   plain-text XML on the clipboard converts on paste; or
   `MBS("Clipboard.SetFileMakerData"; "com.filemaker.script"; $xml)`.
3. **Manual**: hand over the XML file; BaseElements plugin or the
   plugin-less pasteboard recipes are documented alternatives.

No XML declaration on the clipboard path (`fmgen.py` default); add
`--xml-decl` only for file-based tooling that requires it.

## Verify (copy-back diff)

After pasting: save, select the pasted script, copy, paste the clipboard XML
into a scratch file and diff against the generated XML. Expect normalization
noise (whitespace, attribute order); structural differences mean a real
problem. Long term this closes the loop via re-export + `convert-xml` +
catalog diff.
