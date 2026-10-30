#!/usr/bin/env node
/**
 * Parsing-Script für MBS FileMaker Plugin Dokumentation
 *
 * Erzeugt die Komponenten-Zuordnungstabelle für alle Konsumenten, die ohne den
 * Doku-Mirror auskommen müssen (XML-Import-Pipeline, Objekt-Filter, Doc-Set).
 *
 * Erfasst werden Funktionen, bei denen die Namens-Heuristik nicht ausreicht:
 *   * Ausnahmen   — Namenspräfix ≠ Primärkomponente (inkl. Funktionen ohne Punkt)
 *   * Mehrfach    — Funktion ist in mehr als einer Komponente gelistet
 *
 * Spalten:
 *   Funktionsname  Name laut Doku-Seite
 *   Component      Primärkomponente (erste Nennung) — maßgeblich für Zuordnung,
 *                  Zählung und Filter
 *   Components     vollständige Liste aller Komponenten, komma-separiert; für
 *                  Zweit-Mitgliedschaften (identisch mit Component, wenn nur eine)
 *
 * Ausgabe: reference/mbs_component_exceptions.csv (RFC-4180-CSV, CRLF)
 *
 * Usage:
 *   node parse_mbs_components.mjs [PROJECT_ROOT]
 *
 *   PROJECT_ROOT kann auch über die Umgebungsvariable PROJECT_ROOT gesetzt werden.
 *   Fallback: aktuelles Verzeichnis
 *
 * Nur Node-Standardbibliothek (Node >= 22) — kein Python nötig.
 */

import fs from 'node:fs';
import path from 'node:path';

// Spezielle Seiten (keine Funktionen)
const SPECIAL_PAGES = new Set(['Components', 'All', 'New', 'MacOS', 'Windows']);

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const cp = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[ent] ?? NAMED_ENTITIES[ent.toLowerCase()] ?? m;
  });
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s"'>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let v = m[2] ?? '';
    if (v.startsWith('"') || v.startsWith("'")) v = v.slice(1, -1);
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(v);
  }
  return attrs;
}

// Tag-Tokenizer im Stil von html.parser: Kommentare/Doctype werden übersprungen,
// <script>/<style>-Inhalt ist reiner Text.
const TOKEN_RE = /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][^\s\/>]*)([^>]*)>/g;

/** Liefert Funktionsname und Components einer Doku-Seite. */
function parseFunctionPage(html) {
  let functionName = null;
  const components = [];
  let inH2 = false;
  let nextIsComponent = false;
  let rawText = null; // innerhalb <script>/<style>

  const handleData = (data) => {
    // Erster h2-Tag enthält den Funktionsnamen
    if (inH2 && !functionName) functionName = decodeEntities(data).trim();
  };

  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(html)) !== null) {
    const [token, slash, rawTag, attrSrc] = m;
    const tag = rawTag ? rawTag.toLowerCase() : null;
    if (rawText) {
      if (slash && tag === rawText) rawText = null;
      continue;
    }
    if (m.index > last) handleData(html.slice(last, m.index));
    last = m.index + token.length;
    if (!tag) continue; // Kommentar, Doctype, PI

    if (!slash) {
      if (tag === 'script' || tag === 'style') { rawText = tag; continue; }
      if (tag === 'h2') {
        inH2 = true;
      } else if (tag === 'td') {
        if (parseAttrs(attrSrc).class === 'grau') nextIsComponent = true;
      } else if (tag === 'a' && nextIsComponent) {
        const href = parseAttrs(attrSrc).href || '';
        if (href.startsWith('component_')) {
          // Extrahiere Component-Name aus href="component_Plugin.html"
          components.push(href.split('component_').join('').split('.html').join(''));
        }
      }
    } else if (tag === 'h2') {
      inH2 = false;
    } else if (tag === 'td') {
      nextIsComponent = false;
    }
  }
  if (!rawText && last < html.length) handleData(html.slice(last));

  return { functionName, components };
}

/** Analysiert alle HTML-Dateien und extrahiert nur die Ausnahmen. */
function analyzeFunctions(docsPath) {
  const exceptions = [];
  let totalFunctions = 0;

  let htmlFiles = [];
  try {
    htmlFiles = fs.readdirSync(docsPath).filter((f) => f.endsWith('.html')).sort();
  } catch {
    // Verzeichnis fehlt → keine Dateien (wie Path.glob)
  }
  console.log(`Analysiere ${htmlFiles.length} HTML-Dateien...`);

  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const file of htmlFiles) {
    const fullPath = path.join(docsPath, file);
    let functionName;
    let components;
    try {
      ({ functionName, components } = parseFunctionPage(decoder.decode(fs.readFileSync(fullPath))));
    } catch (err) {
      console.log(`Fehler beim Parsen von ${fullPath}: ${err.message}`);
      continue;
    }

    if (!functionName || SPECIAL_PAGES.has(functionName)) continue;

    totalFunctions += 1;

    // Hauptkomponente (erste in der Liste); Unknown-Einträge überspringen
    const primaryComponent = components.length ? components[0] : 'Unknown';
    if (primaryComponent === 'Unknown') continue;

    // Funktionen ohne Punkt sind immer Ausnahmen
    const isException = functionName.includes('.')
      ? functionName.split('.')[0] !== primaryComponent
      : true;

    // Mehrfach-Mitgliedschaft: MBS listet manche Funktionen auf mehreren
    // Komponentenseiten (z.B. FM.ExecuteFileSQL unter FM und FMSQL). Die
    // Primärkomponente allein würde die Zweit-Rubrik leer lassen.
    const isMulti = components.length > 1;

    if (isException || isMulti) {
      exceptions.push({
        Funktionsname: functionName,
        Component: primaryComponent,
        Components: components.join(', '),
      });
    }
  }

  const multi = exceptions.filter((e) => e.Components.includes(', ')).length;
  console.log(`Gesamt analysiert: ${totalFunctions} Funktionen`);
  console.log(`Zuordnungen erfasst: ${exceptions.length} (davon ${multi} mit mehreren Komponenten)`);

  return exceptions;
}

function csvField(value) {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Schreibt die Zuordnungen als CSV (Funktionsname, Component, Components). */
function writeCsv(exceptions, outputFile) {
  if (!exceptions.length) {
    console.log('Keine Ausnahmen zum Schreiben.');
    return;
  }

  const fieldnames = ['Funktionsname', 'Component', 'Components'];
  const lines = [fieldnames.join(',')];
  for (const e of exceptions) lines.push(fieldnames.map((f) => csvField(e[f])).join(','));
  fs.writeFileSync(outputFile, lines.join('\r\n') + '\r\n', 'utf8');

  console.log(`\nKomponenten-CSV erstellt: ${outputFile}`);
  console.log(`Anzahl Zuordnungen: ${exceptions.length}`);

  // Statistiken nach Component (stabile Sortierung: bei Gleichstand Reihenfolge des Auftretens)
  const counts = new Map();
  for (const e of exceptions) counts.set(e.Component, (counts.get(e.Component) || 0) + 1);
  console.log('\nTop 10 Components mit Zuordnungen:');
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([comp, count]) => console.log(`  ${comp.padEnd(20)} ${String(count).padStart(4)} Zuordnungen`));
}

// PROJECT_ROOT: 1. Kommandozeilenparameter, 2. Umgebungsvariable, 3. aktuelles Verzeichnis
const projectRoot = path.resolve(process.argv[2] || process.env.PROJECT_ROOT || process.cwd());
const docsPath = path.join(projectRoot, 'docs', 'mbs', 'Documents');
const outputFile = path.join(projectRoot, 'reference', 'mbs_component_exceptions.csv');

console.log('MBS Component Exceptions Parser');
console.log('='.repeat(50));
console.log('Erfasst Ausnahmen (Prefix != Component) und Mehrfach-Zuordnungen');
console.log(`PROJECT_ROOT: ${projectRoot}`);
console.log();

writeCsv(analyzeFunctions(docsPath), outputFile);

console.log(`\nFertig! Datei erstellt: ${outputFile}`);
