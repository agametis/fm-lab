---
name: fm-open
version: 0.8.9
description: >
  Opens a FileMaker object directly in FileMaker Pro via an fmIDE fmp:// URL,
  after verifying through the FM-Lab REST API that the fmIDE plugin is enabled
  and the fmIDE script exists in the target file. Use fm-show instead to display
  the object in the FM-Lab web frontend (detail/references/graph). Triggers
  (English): "/fm-open", "/fmide-open", "open this in FileMaker", "jump to the
  script in FileMaker", "open in fmIDE". Triggers (German): "öffne das in
  FileMaker", "spring zum Script in FileMaker", "in fmIDE öffnen". Triggers
  (Spanish): "abre esto en FileMaker", "abrir en fmIDE". Triggers (French):
  "ouvre ça dans FileMaker", "ouvrir dans fmIDE". Triggers (Italian): "apri
  questo in FileMaker", "aprire in fmIDE". Triggers (Dutch): "open dit in
  FileMaker", "openen in fmIDE". Triggers (Portuguese): "abra isto no
  FileMaker", "abrir no fmIDE". Triggers (Swedish): "öppna detta i FileMaker",
  "öppna i fmIDE". Triggers (Japanese): "これをFileMakerで開いて",
  "fmIDEで開く". Triggers (Korean): "이것을 FileMaker에서 열어 줘", "fmIDE에서
  열기". Triggers (Chinese): "在 FileMaker 中打开这个", "在 fmIDE 中打开".
---

# fm-open — Open a FileMaker object in FileMaker Pro

## Purpose

Jumps from the conversation straight into FileMaker Pro: resolves the discussed
object, asks the FM-Lab REST API for its fmIDE `fmp://` URL, and opens it.
API-first: the API is the only instance that knows whether the fmIDE plugin is
enabled and whether the fmIDE script exists in the target file — this skill
evaluates its response and reports failures in plain language instead of firing
blindly. Neighbour skill: **fm-show** opens the same object in the FM-Lab web
frontend (use it for types fmIDE cannot address, e.g. variables).
Answer the user in the user's language; this document is English by convention.

## Prerequisites

- Master DB `db/fm_catalog.duckdb` (object resolution; with an active session
  pin — `FMLAB_SOLUTION`/`FMLAB_CONTEXT`, CLAUDE.md §2 — resolve against the
  literal bundle path `solutions/<id>/db/fm_catalog.duckdb`). Missing → abort
  with a pointer to the `convert-xml` skill.
- FM-Lab REST API on `http://localhost:3003` (preferred path). Not running →
  see error table (offer `rest-api-start` or the degraded mode).
- FileMaker Pro with the fmIDE script in the target file — verified via the API,
  never assumed.

## Arguments & modes

| Argument / flag | Effect | Default |
|---|---|---|
| _(none)_ | Object from conversation context | — |
| `<name>` | Object name (exact match, then fuzzy) | — |
| `<uuid>` | UUID directly (8-4-4-4-12 hex; 32-char no-dash md5 = synthetic healed twin → guard 1b) | — |
| `--file <File>` | Clone disambiguation (UUID shared across files) | from context/selection |
| `--list` | Show context objects as a table, open nothing | off |
| `--dry-run` | Display the fmp:// URL, do not open | off |

Examples: `/fm-open` · `/fm-open Umsatzsteuer Nr prüfen` ·
`/fm-open 8075DF6B-… --file Kunden` · `/fm-open --dry-run`

A bare number right after a `--list` output is a list index, not an object name.

## Workflow

### 1 — Resolve the object

Follow `.claude/skills/_shared/resolve-object.md` (read it now if not loaded).
Result: `Object_UUID`, `Object_Type`, `Object_Name`, `File_Name` — all four
required. `--list` mode: render the context objects as the shared selection-list
table, add an fmIDE column (✓/✗ per the type support the API reports), then stop.

### 1b — Synthetic-UUID guard (UUID healing, schema 1.19.0)

A resolved `Object_UUID` **without dashes** (32-char md5 hex instead of
8-4-4-4-12) is a synthetic FM-Lab identity: the object is a healed intra-file
duplicate twin — the UUID does **not exist in the FileMaker source**, so an
`fmp://` jump cannot work. Never build a URL for it. Instead fetch the original
UUID from the census:

```bash
duckdb db/fm_catalog.duckdb -readonly -c "SELECT Object_UUID AS original_uuid, Discriminator, Heal_Status FROM DuplicateAbsorptionDetails WHERE Healed_UUID = '<uuid>' AND File_Name = '<File_Name>';"
```

Explain to the user: this object is a healed duplicate twin; in the source file
its ORIGINAL UUID is assigned to ≥2 objects, so an fmIDE jump via the original
UUID opens *one* of them (typically the survivor), not necessarily this one.
Offer: (a) open via the original UUID anyway (say the ambiguity out loud),
(b) `/fm-show` to inspect the twin in FM-Lab instead. Stop here unless the user
picks (a).

### 2 — API preflight

```bash
curl -s --max-time 1 http://localhost:3003/api/fmide/status
```

If that fails, retry once with base `http://api:3003` (compose service DNS —
in the Docker stack the agent may sit in a sibling container of the API).
Whichever base answered is used for every API call in step 3.
`/status` is a public route — it answers **even when the fmIDE plugin is
disabled** and returns per-file `script_present` / `script_valid` /
`fmide_version` from the server cache. API unreachable → say so out loud and
offer: (a) start the REST API (via the `rest-api-start` command if available,
otherwise the setup's usual server start) and retry, or (b) degraded mode —
build the URL locally per `references/build_fmp_url_local.md` (read it only
then), always prefixed with
`REST API unreachable — URL built locally, plugin/script status unverified.`

### 3 — Fetch the URI (the decision point)

```bash
curl -s "http://localhost:3003/api/fmide/uri?uuid=<UUID>&file=<File_Name>"
```

Deliberately `/uri` (JSON) instead of `/goto` (302 redirect): the JSON carries
every gating field. Evaluate in this order:

| Response | Meaning | Reaction (message to the user) |
|---|---|---|
| HTTP 404, `error.code=PLUGIN_DISABLED` | fmIDE plugin disabled in FM-Lab | "fmIDE plugin is disabled — enable it in FM-Lab Settings → Plugins. Nothing was opened." (use the API's `hint` field if present) |
| HTTP 404, `error.code=OBJECT_NOT_FOUND` | UUID not in catalog | Stale context after a re-import → offer a name search |
| HTTP 409, `error.code=AMBIGUOUS_UUID` | Clone UUID, no `file` param | Present `error.details.matched_files` as a selection list, re-request with `&file=` (never hit when Step 1 resolved File_Name) |
| 200, `data.supported=false` | Object_Type not addressable by fmIDE | Name the type + one sentence: fmIDE addresses objects via name parameters and has none for this type. Point to `/fm-show` |
| 200, `data.script_present=false` | fmIDE script missing in the target file | "File <X> has no fmIDE script — install fmIDE there first." Do not open |
| 200, `data.script_valid=false` | Script exists but lacks the fmIDE signature | Warn (probably a name collision or outdated copy); open only if the user confirms |
| 200, `data.fmp_url` set, all green | Ready | Continue with step 4 |

### 4 — Open

```bash
.claude/skills/_shared/scripts/open_url.sh "<fmp_url>"
```

The script picks the platform mechanism (`$BROWSER` dev-container helper →
`open` → `xdg-open` → `start`) and prints which one it used. Exit 3 = no
mechanism: show the URL as a clickable link for manual opening.
`--dry-run`: skip the script, display the URL followed by
`(--dry-run: URL not invoked)`.

## Output

Success is a single line, no table, no heading:

```
fmIDE → Script "Umsatzsteuer Nr prüfen" opened in Kunden (via $BROWSER).
```

`open_url.sh` returns immediately; there is no feedback channel from FileMaker —
do not claim more than "opened".

## Error cases

| Symptom | Cause | Reaction |
|---|---|---|
| DB missing / ObjectCatalog empty | no import yet | Abort → `convert-xml` |
| No object in context, no argument | nothing discussed yet | Usage hint (see resolve-object.md) |
| Name/UUID ambiguous | duplicates / clone files | Selection list, wait |
| API unreachable | server not running | Offer a server start (`rest-api-start` if available) or degraded mode (step 2) |
| `PLUGIN_DISABLED` | plugin off | Enable-hint, nothing opened |
| `script_present=false` | fmIDE not installed in file | Install-hint, nothing opened |
| `supported=false` | type outside fmIDE's reach | Explain + point to `/fm-show` |
| `open_url.sh` exit 3 | headless / plain Docker without a running open-bridge | Print the fmp:// URL for manual opening + hint: `bash tools/fmlab.sh open-bridge` (host) enables auto-opening |

## Do not do

- No file changes — this skill is read-only plus one open invocation.
- Never start the REST API silently; starting it is the user's call.
- Never open the first row of an ambiguous match blindly.

## References

- `.claude/skills/_shared/resolve-object.md` — read before resolving (step 1).
- `.claude/skills/_shared/scripts/open_url.sh` — the only open mechanism (step 4).
- `references/build_fmp_url_local.md` — read ONLY when the REST API is down and
  the user opts into the degraded local URL construction.
