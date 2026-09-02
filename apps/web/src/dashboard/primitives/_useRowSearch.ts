import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

/**
 * Optionen für `useRowSearch`.
 *
 * - `searchable: true`        → Suchfeld immer sichtbar.
 * - `searchable: false`       → Suchfeld nie sichtbar.
 * - `searchable: 'auto' | undefined` → automatisch sichtbar, sobald die
 *   Eingangs-Liste mehr Einträge als `autoThreshold` hat. Der Default ist 0:
 *   das Suchfeld steht damit über jeder nicht-leeren Liste. Bundles, die es
 *   erst ab einer bestimmten Länge wollen, setzen `searchAutoThreshold`.
 *
 * `placeholder` überschreibt den Default-Hinweistext im `<input>`.
 *
 * `searchParam` macht einen URL-Parameter zur Quelle der Wahrheit für den
 * Suchbegriff (statt des lokalen States). Damit übersteht die Eingabe Reload
 * und Zurück-Navigation, ist per Link teilbar und kann beim Wechsel auf eine
 * andere Seite mitgenommen werden. Opt-in: ohne die Option bleibt alles wie
 * bisher — der Param-Name wird vom Layout deklariert, nie hier hartkodiert.
 */
export interface RowSearchOptions {
  searchable?: boolean | 'auto';
  autoThreshold?: number;
  placeholder?: string;
  searchParam?: string;
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

const DEFAULT_THRESHOLD = 0;

/**
 * Technische Spalten, die ihren Namen nicht ändern können, weil er Vertrag ist:
 *   `nav_uuid`  Anker der Analysis-Tests (Default von `analysis.scope.anchor`,
 *               von der Scope-Prüfung erwartet und von der Findings-Navigation
 *               im Frontend gelesen) — auch in User-Bundles unter tests-custom/
 *   `row_key`   Zeilen-Identität der Findings-Datasets
 *   `uuid`      Objekt-UUID der Custom-Queries (steht in deren @click_args)
 * AutoTable schließt `uuid` aus demselben Grund namentlich aus; hier gilt
 * dieselbe Liste, damit Table/List/TileGrid sich gleich verhalten.
 */
const EXCLUDED_FIELDS = new Set(['uuid', 'nav_uuid', 'row_key']);

/**
 * Generischer Volltext-Filter für Listen-Primitives (Table, List, TileGrid).
 * Eine Row matched, sobald irgendeines ihrer Feld-Werte den Suchstring
 * (case-insensitive) enthält. Nur skalare Werte werden durchsucht — Objekte
 * und Arrays werden über `JSON.stringify` flachgemacht (defensiv).
 *
 * Felder mit `_`-Präfix gelten als technisch (Navigations-Argumente, interne
 * IDs, Konventionsspalten wie `_chip_facets`) und bleiben außen vor — dieselbe
 * Konvention, die AutoTable schon für die Spaltenauswahl verwendet; dazu die
 * namentlich festgelegten Vertragsspalten aus `EXCLUDED_FIELDS`. Ohne diese
 * Grenze schlägt jede Suche fehl, deren Begriff zufällig in einem Klick-
 * Argument steckt: `type=PluginFunction` in jeder Zeile lässt die Suche nach
 * „plugin" jede Zeile treffen, die Liste bleibt unverändert und wirkt tot.
 *
 * Bei leerem Query wird die Originalliste referenziell zurückgegeben — kein
 * unnötiger Re-Render in nachgelagerten Memos.
 */
export function useRowSearch<T extends Record<string, unknown>>(
  rows: T[],
  options: RowSearchOptions = {},
): RowSearchResult<T> {
  const { t } = useTranslation();
  const { searchable, autoThreshold = DEFAULT_THRESHOLD, placeholder, searchParam } = options;
  const effectivePlaceholder = placeholder ?? (t('searchPlaceholder') as string);
  const [localQuery, setLocalQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-Modus (searchParam gesetzt) vs. Komponenten-State. Beide Hooks laufen
  // unbedingt — nur welcher Wert gilt, hängt an der Option.
  const query = searchParam ? (searchParams.get(searchParam) ?? '') : localQuery;
  const setQuery = useCallback(
    (next: string) => {
      if (!searchParam) {
        setLocalQuery(next);
        return;
      }
      // `replace`, damit nicht jeder Tastenanschlag einen History-Eintrag
      // erzeugt — sonst wäre „Zurück" ein Rückwärts-Tippen.
      setSearchParams(
        prev => {
          const merged = new URLSearchParams(prev);
          if (next) merged.set(searchParam, next);
          else merged.delete(searchParam);
          return merged;
        },
        { replace: true },
      );
    },
    [searchParam, setSearchParams],
  );

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
    placeholder: effectivePlaceholder,
    totalCount: rows.length,
  };
}

function rowMatches(row: Record<string, unknown>, needle: string): boolean {
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('_') || EXCLUDED_FIELDS.has(key.toLowerCase())) continue;
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
