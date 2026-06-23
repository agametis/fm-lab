// Token-Renderer-Logik: aus rohem Text + Ref-Liste eine Sequenz von
// gefärbten Spans bauen.
//
// Kern-Algorithmus:
//   1. Refs nach Match-Länge absteigend sortieren (Substring-Konflikte vermeiden)
//   2. Pro Ref alle Vorkommen finden, bereits-belegte Spans tracken
//   3. Field-Lookback: "Tab::Name" zusammenfassen, wenn Ref nur "Name" matcht
//   4. Plugin: subFunction matchen statt name (für MBS-Container)
//   5. Lücken zwischen Refs werden in Sub-Tokens (string/number/operator/text) zerlegt

import type { ScriptRef } from './types';

export type Piece =
  | { type: 'text'; content: string }
  | { type: 'string'; content: string }
  | { type: 'number'; content: string }
  | { type: 'operator'; content: string }
  | { type: 'ref'; content: string; ref: ScriptRef };

interface Span {
  start: number;
  end: number; // exklusiv
  ref: ScriptRef;
}

/**
 * Eindeutiger Match-Text für eine Ref. Für Plugin-Container ist es der
 * `subFunction`-Name (z.B. "List.AddPrefix"), sonst `name`.
 */
function refMatchText(ref: ScriptRef): string {
  if (ref.type === 'pluginFunction' && ref.subFunction) {
    return ref.subFunction;
  }
  // Felder: "TO::Field" — die volle Notation matcht zuverlässiger als nur Name.
  return ref.name;
}

/**
 * Findet alle nicht-überlappenden Vorkommen von `needle` in `haystack`,
 * unter Berücksichtigung bereits belegter Bereiche.
 */
function findFreeOccurrences(
  haystack: string,
  needle: string,
  occupied: Span[],
): Array<{ start: number; end: number }> {
  if (!needle) return [];
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    const end = idx + needle.length;
    // Überlappung mit existierenden Spans?
    const overlap = occupied.some(s => idx < s.end && end > s.start);
    if (!overlap) {
      out.push({ start: idx, end });
    }
    from = end;
  }
  return out;
}

/**
 * Field-Refs bekommen nur "Field"-Namen geliefert, ihr Tab-Präfix steht im
 * Text. Der Lookback erweitert die Range nach links auf "TO::Field", indem
 * gezielt der bekannte Tab-Name aus `ref.table` matcht wird — robuster als
 * ein greedy `([\w\s]+::)`-Pattern, das über Whitespace und Operatoren
 * hinweg in das vorige Token rutschen konnte (Bug bei If-Lines wie
 * `... = 1 and Artikel::Field` wurden als "1 and Artikel::Field" verbunden).
 *
 * Wir verwenden dies nur, wenn der Match-Text kein "::" enthält (sonst hat
 * der API-Formatter bereits "TO::Field" als Match-Text geliefert).
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extendFieldRangeLeft(
  text: string,
  match: { start: number; end: number },
  ref: ScriptRef,
) {
  if (!ref.table) return match;
  const before = text.slice(0, match.start);
  // Exakter Tab-Name als Anker — optionale Whitespaces vor und nach `::`.
  const re = new RegExp(`${escapeRegex(ref.table)}\\s*::\\s*$`);
  const m = re.exec(before);
  if (m) {
    return { start: match.start - m[0].length, end: match.end };
  }
  return match;
}

const SUBTOKEN_RE = /(".*?(?<!\\)")|(\d+(?:\.\d+)?)|(<>|≠|≥|≤|=|<|>|\+|-|\*|\/|&|;)/g;

function splitGap(text: string): Piece[] {
  if (!text) return [];
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(SUBTOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      out.push({ type: 'text', content: text.slice(last, idx) });
    }
    if (m[1] !== undefined) {
      out.push({ type: 'string', content: m[1] });
    } else if (m[2] !== undefined) {
      out.push({ type: 'number', content: m[2] });
    } else if (m[3] !== undefined) {
      out.push({ type: 'operator', content: m[3] });
    }
    last = idx + m[0].length;
  }
  if (last < text.length) {
    out.push({ type: 'text', content: text.slice(last) });
  }
  return out;
}

export function tokenizeLine(text: string, refs: ScriptRef[] | undefined): Piece[] {
  if (!text) return [];
  if (!refs || refs.length === 0) {
    return splitGap(text);
  }

  // Sort: längere Match-Texte zuerst, damit "Referenzliste Index" vor "Index" gefunden wird.
  const sorted = [...refs].sort(
    (a, b) => refMatchText(b).length - refMatchText(a).length,
  );

  const occupied: Span[] = [];

  for (const ref of sorted) {
    const needle = refMatchText(ref);
    const matches = findFreeOccurrences(text, needle, occupied);
    for (let m of matches) {
      // Field-Lookback nur, wenn Match-Text selbst kein "::" enthält.
      if (ref.type === 'field' && !needle.includes('::')) {
        m = extendFieldRangeLeft(text, m, ref);
      }
      occupied.push({ start: m.start, end: m.end, ref });
    }
  }

  // Spans nach Position sortieren
  occupied.sort((a, b) => a.start - b.start);

  // Pieces zusammenbauen
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const span of occupied) {
    if (span.start > cursor) {
      pieces.push(...splitGap(text.slice(cursor, span.start)));
    }
    pieces.push({
      type: 'ref',
      content: text.slice(span.start, span.end),
      ref: span.ref,
    });
    cursor = span.end;
  }
  if (cursor < text.length) {
    pieces.push(...splitGap(text.slice(cursor)));
  }

  return pieces;
}
