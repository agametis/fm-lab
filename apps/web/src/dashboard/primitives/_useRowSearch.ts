import { useMemo, useState } from 'react';

/**
 * Optionen für `useRowSearch`.
 *
 * - `searchable: true`        → Suchfeld immer sichtbar.
 * - `searchable: false`       → Suchfeld nie sichtbar.
 * - `searchable: 'auto' | undefined` → automatisch sichtbar, sobald die
 *   Eingangs-Liste mehr Einträge als `autoThreshold` (Default 10) hat.
 *
 * `placeholder` überschreibt den Default-Hinweistext im `<input>`.
 */
export interface RowSearchOptions {
  searchable?: boolean | 'auto';
  autoThreshold?: number;
  placeholder?: string;
}

export interface RowSearchResult<T> {
  /** Soll das Suchfeld gerendert werden? */
  visible: boolean;
  /** Aktueller Suchstring (kontrollierter Input). */
  query: string;
  setQuery: (q: string) => void;
  /** Eingangsliste, ggf. gefiltert. Identität referentiell stabil pro Render. */
  filtered: T[];
  /** Placeholder-Text für den `<input>`. */
  placeholder: string;
  /** Anzahl der Eingangs-Rows (vor Filter) — für Anzeigen wie „X von Y". */
  totalCount: number;
}

const DEFAULT_THRESHOLD = 10;
const DEFAULT_PLACEHOLDER = 'Suchen …';

/**
 * Generischer Volltext-Filter für Listen-Primitives (Table, List, TileGrid).
 * Eine Row matched, sobald irgendeines ihrer Feld-Werte den Suchstring
 * (case-insensitive) enthält. Nur skalare Werte werden durchsucht — Objekte
 * und Arrays werden über `JSON.stringify` flachgemacht (defensiv).
 *
 * Bei leerem Query wird die Originalliste referenziell zurückgegeben — kein
 * unnötiger Re-Render in nachgelagerten Memos.
 */
export function useRowSearch<T extends Record<string, unknown>>(
  rows: T[],
  options: RowSearchOptions = {},
): RowSearchResult<T> {
  const { searchable, autoThreshold = DEFAULT_THRESHOLD, placeholder = DEFAULT_PLACEHOLDER } = options;
  const [query, setQuery] = useState('');

  const visible =
    searchable === true
      ? true
      : searchable === false
        ? false
        : rows.length > autoThreshold; // 'auto' oder undefined

  const filtered = useMemo(() => {
    if (!visible) return rows;
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row => rowMatches(row, needle));
  }, [rows, query, visible]);

  return {
    visible,
    query,
    setQuery,
    filtered,
    placeholder,
    totalCount: rows.length,
  };
}

function rowMatches(row: Record<string, unknown>, needle: string): boolean {
  for (const value of Object.values(row)) {
    if (value == null) continue;
    if (typeof value === 'object') {
      // Defensiv: verschachtelte Objekte/Arrays in String wandeln. Selten in
      // Dashboard-Datasets (DuckDB liefert primitive Skalare); abgesichert
      // für JSON-Spalten.
      if (JSON.stringify(value).toLowerCase().includes(needle)) return true;
      continue;
    }
    if (String(value).toLowerCase().includes(needle)) return true;
  }
  return false;
}
