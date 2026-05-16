---
name: create-custom-dashboard
description: Erstellt interaktiv ein neues Custom-Dashboard-Bundle für das fm-lab Dashboard-System. Befragt den Benutzer nach dem gewünschten Dashboard-Inhalt, entwirft SQL-Queries, zeigt Musterergebnisse, schlägt eine Darstellungsform vor, fragt nach einem Namen und erzeugt das vollständige Bundle-Verzeichnis unter `rest-api/templates/dashboards/<id>/`. Wird ausgelöst durch `/create-custom-dashboard` oder Anfragen wie "erstelle ein neues Dashboard für X", "neues Dashboard", "baue ein Dashboard das X zeigt".
---

# Custom Dashboard erstellen

Führe den Benutzer interaktiv durch die Erstellung eines neuen Dashboard-Bundles. Das Ergebnis ist ein vollständiges Bundle-Verzeichnis unter `rest-api/templates/dashboards/<id>/` mit `manifest.json`, `layout.json` und mindestens einer SQL-Datei unter `data/`.

## Grundregeln

- **Sprache**: Deutsch
- **Datenbank**: `db/fm_catalog.duckdb` (Master — NICHT `rest-api/db/`)
- **Read-Only**: Niemals UPDATE/INSERT/DELETE auf der Datenbank
- **Interaktiv**: Schritt 3 und 4 warten auf Bestätigung des Benutzers, bevor Dateien geschrieben werden
- **SQL-Stil**: analog zu `rest-api/templates/dashboards/home/data/*.sql`
- **DuckDB-Path**: Wenn `duckdb` nicht im PATH, bekannte Orte prüfen: `~/.duckdb/cli/latest/duckdb`, `/opt/homebrew/bin/duckdb`, `/usr/local/bin/duckdb`

---

## Workflow

### Schritt 1 — Dashboard-Ziel klären

Falls der Benutzer beim Aufruf bereits ein Thema mitgegeben hat (z.B. `/create-custom-dashboard Variablen-Analyse`), dieses direkt als Ausgangspunkt nehmen: "Für ein Variablen-Dashboard würde ich folgende Daten zeigen: …" und direkt Schritt 2 beginnen.

Falls kein Thema mitgegeben wurde, **eine** kurze Frage stellen:
> "Was soll das Dashboard zeigen? (z.B.: Variablen-Überblick, Scripts ohne Kommentar, Lookup-Felder, Beziehungs-Statistiken, …)"

**BLOCKIEREND** falls kein Thema vorhanden: Auf Antwort warten.

---

### Schritt 2 — SQL-Query entwerfen, ausführen und Ergebnis zeigen

Anhand des Ziels einen SQL-Query entwerfen, der die relevanten Daten aus `db/fm_catalog.duckdb` liefert.

#### Query-Designregeln

- Spaltennamen: kurz, lowercase, ohne Leerzeichen (`script_count`, `name`, `uuid`, `file`)
- Bei Multi-Zeilen-Ergebnissen immer Spalte `uuid` einschließen, wenn das Objekt im ObjectCatalog existiert — ermöglicht `openObject`-Navigation
- Parametrisierung via `getvariable('param_name')` für optionale Filter (z.B. `file`, `limit`)
- Parameter mit Default: `CAST(COALESCE(getvariable('limit'), '25') AS INTEGER)` bzw. `(getvariable('file') IS NULL OR File_Name = getvariable('file'))`
- CTEs für Zwischenergebnisse bevorzugen
- Orientierung an `sql/sample_queries.sql` und den bestehenden Bundle-SQLs

#### Query ausführen (LIMIT 10 für Preview)

```bash
~/.duckdb/cli/latest/duckdb db/fm_catalog.duckdb -c "<SQL mit LIMIT 10>"
```

Bei Query-Fehler: einmal korrigieren und erneut ausführen. Nach zwei Fehlern den Benutzer einbinden.

#### Ergebnis aufbereiten

| Situation | Ausgabe |
|-----------|---------|
| ≤ 10 Zeilen, ≤ 8 Spalten | Ergebnis vollständig als Markdown-Tabelle |
| > 10 Zeilen | "Query liefert viele Ergebnisse. Erste 10 als Vorschau:" + Tabelle |
| > 8 Spalten | Wichtigste Spalten zeigen, Rest erwähnen |
| 0 Zeilen | Benutzer informieren, alternativen Query oder anderen Datenbankinhalt vorschlagen |

Abschließend eine kurze Einschätzung: "Das sind N Zeilen mit X Spalten — das Ergebnis eignet sich gut für [Primitive]."

---

### Schritt 3 — Darstellungsform vorschlagen (BLOCKIEREND)

Basierend auf dem Query-Ergebnis eine Darstellungsform empfehlen:

#### Entscheidungslogik

| Bedingung | Empfehlung |
|-----------|------------|
| 1 Zeile, 1–6 numerische/aggregierte Spalten | **KPIStrip** |
| 1 Spalte `content` (Freitext) | **Markdown** |
| Mehrere Zeilen, enthält `uuid` + `name`, primär zur Navigation | **List** (klickbar via `openObject`) |
| Mehrere Zeilen, 3–8 gemischte Spalten, Analyse-Fokus | **Table** |
| Viele Zeilen (>50), uuid vorhanden | **Table** mit `onRowClick` |
| Viele Objekte zur Navigation (Queries, Dashboards) | **TileGrid** |

Wenn List und Table beide passen, beide vorschlagen:
> "**List**: kompakt, gut für Navigation (Klick → Detailansicht). **Table**: zeigt alle Spalten, besser für Datenanalyse."

Ausgabe:
1. Empfehlung mit kurzem Grund
2. Ggf. Alternative mit Beschreibung
3. Frage: "Soll ich [Empfehlung] verwenden, oder bevorzugst Du eine andere Darstellung?"

**BLOCKIEREND**: Auf Antwort des Benutzers warten.

---

### Schritt 4 — Dashboard-Name vorschlagen (BLOCKIEREND)

Einen kompakten, aussagekräftigen Namen vorschlagen:

**Regeln für die ID** (= Verzeichnisname):
- Lowercase, nur ASCII (a–z, 0–9, `_`), max. 30 Zeichen
- Keine Präfixe `home_`, `_generic`, `home` (reserviert)
- Gut: `variable_hotspots`, `unused_scripts`, `lookup_fields`, `relation_overview`

**Regeln für den Titel**:
- Deutsch, max. 50 Zeichen, menschenlesbar
- Gut: "Variablen-Hotspots", "Scripts ohne Aufrufer", "Lookup-Felder"

Ausgabe:
> "Vorgeschlagener Name: `<id>` / Titel: „<title>""
> "Passt das so, oder möchtest Du einen anderen Namen?"

**BLOCKIEREND**: Auf Antwort des Benutzers warten. Bei eigenem Namen: in konforme ID konvertieren (lowercase, Leerzeichen → `_`, ä→ae, ö→oe, ü→ue, ß→ss).

---

### Schritt 5 — Bundle erzeugen

Erst wenn Inhalt, Darstellung **und** Name bestätigt sind, die Dateien schreiben.

#### 5.1 Verzeichnis prüfen

```bash
ls "rest-api/templates/dashboards/"
```

Falls eine Bundle mit der gewählten ID bereits existiert: Benutzer fragen, ob überschrieben oder die ID umbenannt werden soll.

#### 5.2 SQL-Datei erstellen

Pfad: `rest-api/templates/dashboards/<id>/data/<dataset_name>.sql`

```sql
-- @template_type: report
-- @description: <kurze Beschreibung des Datasets>
-- @params: <param_name> (optional, default <wert>), ...

<finaler SQL-Query — ohne LIMIT-Beschränkung des Previews, aber mit parametrisiertem LIMIT>
```

Falls mehrere logisch getrennte Datasets sinnvoll sind (z.B. ein Aggregat-KPI + eine Detailliste), separate SQL-Dateien erstellen.

#### 5.3 manifest.json erstellen

Pfad: `rest-api/templates/dashboards/<id>/manifest.json`

```json
{
  "id": "<id>",
  "version": "1.0.0",
  "title": "<title>",
  "description": "<1-2 Sätze, was das Dashboard zeigt>",
  "author": "fm-lab custom",
  "icon": "<Lucide-Icon-Name>",
  "tags": ["custom", "<thematisches Tag>"],
  "entry": "layout.json",
  "datasets": [
    { "id": "<dataset_name>", "source": "bundle:data/<dataset_name>.sql" }
  ],
  "params": [
    { "name": "file", "type": "string", "required": false,
      "description": "Optionaler Dateifilter." }
  ],
  "permissions": { "read_only": true, "allow_navigation": true }
}
```

**Icon-Auswahl** (Lucide React Icons — passende Beispiele):
`database`, `code`, `layout-list`, `git-fork`, `table-2`, `search`, `variable`, `function-square`, `tag`, `alert-triangle`, `link`, `box`, `layers`, `filter`
Bei Unsicherheit: `database` als sicherer Default.

**Datasets-Quellen**:
- `bundle:data/<name>.sql` — SQL im selben Bundle (Standard)
- `custom:<template-name>` — bestehendes Template aus `rest-api/templates/sql-custom/`
- `report:<template-name>` — bestehendes Template aus `rest-api/templates/sql/`
- `builtin:list_dashboards` / `builtin:list_custom_queries` / `builtin:files` — Server-Builtins

#### 5.4 layout.json erstellen

Pfad: `rest-api/templates/dashboards/<id>/layout.json`

Immer `Grid(columns:12)` als Root. Jede inhaltliche Einheit in eine `Card` wrappen.

**Grundstruktur**:
```json
{
  "schemaVersion": 1,
  "root": {
    "type": "Grid",
    "props": { "columns": 12, "gap": 16 },
    "children": [
      {
        "type": "Card",
        "props": { "span": 12, "title": "<Kartentitel>" },
        "data": { "dataset": "<dataset_name>" },
        "children": [
          { "type": "<Primitive>", "props": { ... } }
        ]
      }
    ]
  }
}
```

**Primitive-Props-Vorlagen**:

*KPIStrip* (1-Zeilen-Aggregat):
```json
{ "type": "KPIStrip", "props": { "items": [
  { "label": "Scripts",      "field": "scripts",      "format": "number" },
  { "label": "Ohne Aufruf",  "field": "unused_count", "format": "number" }
]}}
```

*List* (klickbar, benötigt `uuid`-Spalte im Query):
```json
{ "type": "List", "props": {
  "rowTemplate": {
    "primary":   "{{name}}",
    "secondary": "{{file}} · {{step_count}} Schritte",
    "onClick":   { "action": "openObject",
                   "args": { "uuid": "{{uuid}}", "type": "Script" } }
  },
  "empty": { "message": "Keine Einträge gefunden." }
}}
```

*Table* (analyse-fokussiert):
```json
{ "type": "Table", "props": {
  "rowKey": "<eindeutige Spalte>",
  "density": "comfortable",
  "columns": [
    { "field": "name",  "label": "Name" },
    { "field": "count", "label": "Anzahl", "align": "right" },
    { "field": "file",  "label": "Datei" }
  ],
  "onRowClick": { "action": "openObject",
                  "args": { "uuid": "{{uuid}}", "type": "{{type}}" } }
}}
```

*TileGrid* (Navigation):
```json
{ "type": "TileGrid", "props": { "tile": {
  "title":    "{{name}}",
  "subtitle": "{{description}}",
  "icon":     "{{icon}}",
  "onClick":  { "action": "runQuery",
                "args": { "query": "{{name}}" } }
}}}
```

**Span-Werte**: `12` = volle Breite, `6` = halbe Breite, `4` = Drittel, `8` + `4` = zwei Drittel + Drittel. Mehrere gleichbreite Cards nebeneinander: `Stack` oder direkte Kinder im Grid.

#### 5.5 Abschlussmeldung ausgeben

```
Dashboard-Bundle erstellt: rest-api/templates/dashboards/<id>/
  ├── manifest.json
  ├── layout.json
  └── data/
      └── <dataset_name>.sql

Dashboard-ID:  <id>
Titel:         <title>
Darstellung:   <Primitive>
Dataset:       <dataset_name> (Preview: N Zeilen)

Das Dashboard ist sofort unter /api/dashboards/<id> verfügbar — Browser-Reload (Ctrl+R) reicht.
Server-Neustart ist nicht nötig: Bundles und SQL-Templates werden mtime-basiert hot-reloaded.
```

---

## Konventionen auf einen Blick

### Primitive-Registry (v1)

| Primitive  | Wann verwenden                              | Wichtige Props               |
|------------|---------------------------------------------|------------------------------|
| Grid       | Root-Container (immer)                      | `columns`, `gap`             |
| Card       | Rahmen mit Titel um jeden Inhalt            | `span`, `title`, `variant`   |
| Stack      | Mehrere Cards vertikal stapeln              | `gap`, `align`               |
| Row        | Horizontale Gruppe                          | `gap`, `align`               |
| KPI        | Eine einzelne Kennzahl                      | `label`, `field`, `format`   |
| KPIStrip   | 2–8 Kennzahlen nebeneinander                | `items[]`                    |
| List       | Klickbare Liste (uuid im Query nötig)       | `rowTemplate`, `empty`       |
| TileGrid   | Kachel-Navigation                           | `tile`, `minTileWidth`       |
| Table      | Tabellarische Anzeige, mehrere Spalten      | `columns[]`, `rowKey`, `density` |
| Markdown   | Hilfetext, statischer Inhalt                | `content`                    |
| NavButton  | Navigationsschaltfläche                     | `label`, `icon`, `onClick`   |
| Spacer     | Leerraum                                    | `size`                       |
| Image      | Bild aus Bundle (`asset:`)                  | `src`, `alt`, `width`        |
| Empty      | Platzhalter bei leerem Dataset              | `message`                    |

### Click-Actions (Whitelist)

| Action            | Args                             | Effekt                                    |
|-------------------|----------------------------------|-------------------------------------------|
| `openObject`      | `uuid`, `type`, `file?`          | Detail-View des Objekts öffnen            |
| `openDashboard`   | `id`, `params?`                  | Anderes Dashboard laden                   |
| `applyFilter`     | `q?`, `type?`, `file?`           | Suchfilter im Header setzen               |
| `runQuery`        | `query`, `params?`               | Custom-Template im `_generic`-Bundle öffnen |
| `openUrl`         | `url` (nur https://)             | Externe URL mit Bestätigung               |
| `copyToClipboard` | `value`                          | Wert in Zwischenablage kopieren           |

### Token-Substitution

`{{field}}` wird zur Rendering-Zeit gegen den Feldwert der jeweiligen Datenzeile ersetzt.
Optionale Filter: `{{ field | upper }}`, `{{ field | number:2 }}`, `{{ field | date:relative }}`, `{{ field | truncate:50 }}`, `{{ field | default:"-" }}`

### Format-Werte für KPI/Table-Spalten

`number`, `badge`, `date:relative`, `date:short`, `boolean`

---

## Beispiel-Durchlauf

**Benutzer**: `/create-custom-dashboard Scripts ohne Kommentar`

**Schritt 1** — Thema klar, direkt weiter.

**Schritt 2** — Query entwerfen:

```sql
-- @template_type: report
-- @description: Scripts ohne Kommentar-Schritt an erster Position.
-- @params: file (optional)

SELECT
    s.Script_UUID                 AS uuid,
    s.Script_Name                 AS name,
    s.File_Name                   AS file,
    COUNT(st.Step_UUID)           AS step_count
FROM ScriptCatalog s
LEFT JOIN StepsForScripts st ON st.Script_UUID = s.Script_UUID
WHERE (s.Folder_Type IS NULL)
  AND NOT s.Is_Separator
  AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
  AND s.Script_UUID NOT IN (
      SELECT Script_UUID FROM StepsForScripts
      WHERE Step_Name = 'Comment' AND Step_Index = 1
  )
GROUP BY ALL
ORDER BY step_count DESC
LIMIT CAST(COALESCE(getvariable('limit'), '50') AS INTEGER);
```

Preview ausführen → Tabelle zeigen → "47 Scripts gefunden. Empfehle **List** (klickbar)."

**Schritt 3** — "List empfohlen, alternativ Table. Bitte bestätigen."
→ Benutzer: "List passt."

**Schritt 4** — "Vorgeschlagener Name: `scripts_without_comment` / Titel: „Scripts ohne Kommentar""
→ Benutzer: "Ja."

**Schritt 5** — Bundle-Dateien erstellen:
- `rest-api/templates/dashboards/scripts_without_comment/data/scripts_without_comment.sql`
- `rest-api/templates/dashboards/scripts_without_comment/manifest.json`
- `rest-api/templates/dashboards/scripts_without_comment/layout.json`

---

## Wichtige Hinweise

- **Erst Preview, dann speichern**: Dateien werden erst in Schritt 5 geschrieben, nach Bestätigung der Darstellung (Schritt 3) und des Namens (Schritt 4).
- **Kein freier SQL im Bundle**: Queries ausschließlich als `.sql`-Dateien unter `data/`. Kein SQL-Code in `manifest.json` oder `layout.json`.
- **Mehrere Datasets**: Falls der Benutzer mehr als eine Datenperspektive wünscht (z.B. Übersichts-KPI + Detailliste), mehrere SQL-Dateien und Datasets anlegen. In `layout.json` jedes Dataset in eine eigene `Card`.
- **Cross-File**: Falls die Datenbank mehrere FileMaker-Dateien enthält, immer einen optionalen `file`-Parameter im Query einplanen.
- **Schrittreihenfolge einhalten**: Der interaktive Dialog in Schritten 3 und 4 ist nicht optional — kein direktes Bundle-Schreiben ohne Bestätigung.
