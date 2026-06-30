import { createContext, useContext } from 'react';
import type { ScriptRef } from './types';

/**
 * React-Context für Cross-Reference Highlight.
 *
 * Vermeidet Prop-Drilling durch ScriptViewer → ScriptLine → ScriptLineContent →
 * RefSpan und durch CustomFunctionViewer → TokenSpan. Der Context-Wert ist eine
 * Set<UUID>; ein leeres Set deaktiviert Highlight in den Konsumenten.
 *
 * Konsumenten: `RefSpan` und `TokenSpan` setzen die Klasse `fm-ref--highlighted`
 * auf Tokens, deren `uuid` im Set steht.
 */
export const HighlightRefContext = createContext<Set<string> | null>(null);

export function useHighlightRefUuids(): Set<string> | null {
  return useContext(HighlightRefContext);
}

/**
 * Hilfsprädikat: prüft, ob eine UUID im Set steht. Verträgt null-Context
 * und null-UUIDs, damit Aufrufer keine eigene Defensive brauchen.
 */
export function isUuidHighlighted(
  set: Set<string> | null,
  uuid: string | null | undefined,
): boolean {
  if (!set || !uuid) return false;
  return set.has(uuid);
}

/**
 * Such-/Filter-Highlight im ScriptViewer (zusätzliche Filterleiste analog zur
 * Referenzen-Ansicht). Der Context hält ein Prädikat, das pro Ref entscheidet,
 * ob ein orange Such-Highlight gesetzt werden soll. `null` = kein aktiver Filter.
 *
 * Bewusst unabhängig vom HighlightRefContext: beide können parallel greifen
 * (Cross-Reference-Highlight + Volltextsuche) und sollen sich visuell nicht
 * gegenseitig überschreiben.
 */
export type ScriptSearchPredicate = (ref: ScriptRef) => boolean;

export const ScriptSearchContext = createContext<ScriptSearchPredicate | null>(null);

export function useScriptSearchPredicate(): ScriptSearchPredicate | null {
  return useContext(ScriptSearchContext);
}

/**
 * Raw Query-String aus der Suchleiste (lowercase, trimmed) oder null.
 * Wird von CommentBody konsumiert: Kommentartexte haben keine Refs und
 * können vom Prädikat-basierten Such-Highlight nicht erfasst werden —
 * Substring-Matches auf dem rohen Text brauchen den Query selbst.
 */
export const ScriptSearchQueryContext = createContext<string | null>(null);

export function useScriptSearchQuery(): string | null {
  return useContext(ScriptSearchQueryContext);
}

/**
 * Raw Query-String für die Literal-Text-Suche in Step-Zeilen. Anders als der
 * ScriptSearchQueryContext (nur Kommentare) zielt dieser Context auf die
 * Nicht-Ref-Literalsegmente einer Step-Zeile — Parameterwerte, eingefügte
 * Strings, Step-Namen. Damit findet die In-Skript-Suche auch Text, der nicht
 * als Ref tokenisiert ist (z.B. ein XML-Literal im Wert eines Set-Variable-
 * Steps) und spiegelt so die globale Suche, die auf dem vollen Step_Text matcht.
 * `null` = inaktiv (Pillen-Filter aktiv oder kein Query).
 */
export const ScriptLineSearchQueryContext = createContext<string | null>(null);

export function useScriptLineSearchQuery(): string | null {
  return useContext(ScriptLineSearchQueryContext);
}
