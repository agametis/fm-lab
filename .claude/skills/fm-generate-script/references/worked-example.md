# Worked example — full pipeline run

Real run against the current master catalog (solution file `Buchhaltung`,
FM 22.0.4; fm_spec consumer variant). Object names/IDs reflect that
solution — treat them as illustrative.

## P1 draft (`draft_test.fmscript`)

German step names, canonical EN calc functions, layout/field/script names
from the catalog:

```
# Testscript: Beleg-Layout öffnen und Lieferant stempeln
Fehleraufzeichnung setzen [ On ]
Variable setzen [ $belegId ; Value: Get ( ScriptParameter ) ]
Gehe zu Layout [ "Beleg" (Belege Eingang) ]
Wenn [ Get ( LastError ) <> 0 ]
  Eigenes Dialogfeld anzeigen [ Title: "Fehler" ; Message: "Layout nicht erreichbar" ]
  Aktuelles Script verlassen [ Text Result: "ERROR" ]
Ende (wenn)
Feldwert setzen [ Belege Eingang::Lieferant ; "Testwert" ]
Script ausführen [ Specified: From list ; "Suchen" ; Parameter: $belegId ]
```

## P2–P6

```bash
python3 .claude/skills/fm-generate-script/scripts/fmgen.py run \
    draft_test.fmscript --file Buchhaltung --out-dir output/codegen/test
# fmgen parse:   10 step(s), 0 error(s)
# fmgen resolve: 3 resolved, 0 unresolved, 0 new
# fmgen emit:    10 step(s) emitted
# fmgen gate:    PASS (11 checks, 0 failed, 0 skipped)
```

Resolution report (`.resolved.json`, excerpt): layout `"Beleg"` -> id 7 +
UUID, field `Belege Eingang::Lieferant` -> Field_ID 194, script `"Suchen"`
-> Script_ID 305; assumption `target file 'Buchhaltung' per FilesCatalog,
FM 22.0.4`.

## Emitted snippet (excerpt)

```xml
<fmxmlsnippet type="FMObjectList">
  <Step enable="True" id="86" name="Set Error Capture">
    <Set state="True"/>
  </Step>
  <Step enable="True" id="141" name="Set Variable">
    <Value>
      <Calculation><![CDATA[Get ( ScriptParameter )]]></Calculation>
    </Value>
    <Repetition>
      <Calculation><![CDATA[1]]></Calculation>
    </Repetition>
    <Name>$belegId</Name>
  </Step>
  <Step enable="True" id="6" name="Go to Layout">
    <LayoutDestination value="SelectedLayout"/>
    <Layout id="7" name="Beleg"/>
  </Step>
  <Step enable="True" id="76" name="Set Field">
    <Calculation><![CDATA["Testwert"]]></Calculation>
    <Field table="Belege Eingang" id="194" repetition="0" name="Lieferant"/>
  </Step>
</fmxmlsnippet>
```

Note: ids are REAL (resolved), the step names in the emitted XML are the
canonical EN emission names from `step_xml_map` regardless of draft locale,
and defaults (Repetition 1, LayoutDestination) come from the reference
templates — none of this is prompt knowledge.

## Gate protocol (11 checks, all pass)

Layer 1: wellformed, wrapper, step ids, name attributes, structure/element
order, Set-Variable Name element, CDATA count. Layer 2: save constraints
(flat transactions, `Self` value, pair balance). Layer 3: resolution report
clean, version gate (every step's origin_version <= FM 22.0.4).

## What failure looks like

- Typo layout name -> resolve exit 2, report entry with
  `"suggestion": "Beleg Bearbeiten"`; pipeline stops before emission.
- `Ersetzen($t;".";"_")` -> L007 warning (localized name) + L006 error
  (Replace needs 4 args).
- `Commit Transaction` inside `If` -> L008 error (save-invalid nesting).
- Foreign XML with legacy id 78 / wrong element order / missing `Name` tag
  -> gate FAIL G104/G106/G107.
