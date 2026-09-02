import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '../../config/apiBase';
import { useApiLang } from '../../hooks/useApiLang';
import type { DatasetResult } from '../../api/dashboardApi';

/**
 * Rubrikübergreifende Eintragssuche für die `List` (Opt-in per Layout-Prop).
 *
 * Der Server liefert KEINE Zeilen, sondern nur eine Annotation zu den Zeilen,
 * die die Liste längst hat: pro Treffer-Rubrik eine Belegzeile und die
 * Trefferzahl. Weil die Belegzeile ein normales (nicht `_`-präfixiertes) Feld
 * ist, matcht die generische Zeilensuche die Rubrik von selbst — die
 * Vereinigung aus Namens- und Eintragstreffer braucht keine eigene
 * Filterlogik, die Zeile trägt ihre eigene Begründung.
 */
export interface EntrySearchProps {
  /** Dataset, aus dem `entry_search` + `entry_search_url` gelesen werden. */
  metaDataset?: string;
  /** Ab wie vielen Zeichen gesucht wird (Server setzt dieselbe Grenze durch). */
  minChars?: number;
  /** Wie viele Treffer die Belegzeile nennt, bevor sie auf „+n" kürzt. */
  sample?: number;
  /** URL-Param des Kästchen-Zustands (Default `entries`). */
  param?: string;
  /** Beschriftung des Kästchens (sonst i18n-Default). */
  label?: string;
}

export interface CategoryHit {
  category_id: string;
  hit_count: number;
  sample: string[];
}

export interface EntrySearchState {
  /** Rendert das Kästchen? (Set-Capability + konfigurierte Prop) */
  available: boolean;
  /** Kästchen gesetzt? */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** Läuft gerade eine Anfrage? */
  loading: boolean;
  /** Annotation greift gerade (Kästchen an + Eingabe lang genug + Treffer da). */
  active: boolean;
  /** Treffer je Rubrik-ID; leer solange nichts geholt wurde. */
  hits: Map<string, CategoryHit>;
  minChars: number;
  sampleSize: number;
  /** Der Suchbegriff, auf den sich die Annotation bezieht (getrimmt). */
  term: string;
}

const DEBOUNCE_MS = 250;
const DEFAULT_MIN_CHARS = 3;
const DEFAULT_SAMPLE = 5;
const DEFAULT_PARAM = 'entries';

/**
 * Holt die Aggregation `GET <entry_search_url>?q=&group=category&sample=`.
 *
 * Zwei Eigenschaften sind bewusst so gebaut:
 *   - Die vorige Annotation bleibt stehen, solange eine neue Anfrage läuft.
 *     Sonst klappten Belegzeilen bei jedem Tastenanschlag ein und aus.
 *   - Jede neue Eingabe bricht die Vorgängeranfrage ab, damit eine langsame
 *     ältere Antwort keine neuere überschreibt.
 */
export function useEntrySearch(
  props: EntrySearchProps | undefined,
  meta: Record<string, unknown> | undefined,
  fallbackQuery: string,
  searchParam?: string,
): EntrySearchState {
  const lang = useApiLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hits, setHits] = useState<Map<string, CategoryHit>>(new Map());
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const minChars = props?.minChars ?? DEFAULT_MIN_CHARS;
  const sampleSize = props?.sample ?? DEFAULT_SAMPLE;
  const param = props?.param ?? DEFAULT_PARAM;
  const url = (meta?.entry_search_url as string | null | undefined) ?? null;
  const available = !!props && !!meta?.entry_search && !!url;

  const enabled = available && searchParams.get(param) === '1';
  // Im URL-Modus ist der Param die Quelle der Wahrheit — dieselbe, aus der
  // gleich auch `useRowSearch` liest. So annotieren wir immer gegen den
  // Begriff, der die Liste tatsächlich filtert, ohne eine Render-Runde
  // hinterherzuhinken. Ohne URL-Param greift der nachgereichte State.
  const term = (searchParam ? (searchParams.get(searchParam) ?? '') : fallbackQuery).trim();
  const shouldFetch = enabled && term.length >= minChars;

  const setEnabled = (on: boolean) => {
    setSearchParams(
      prev => {
        const merged = new URLSearchParams(prev);
        if (on) merged.set(param, '1');
        else merged.delete(param);
        return merged;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    if (!shouldFetch || !url) {
      // Kästchen aus oder Eingabe zu kurz: Annotation fällt weg, ohne dass je
      // eine Anfrage rausging (A4).
      abortRef.current?.abort();
      abortRef.current = null;
      setLoading(false);
      setHits(prev => (prev.size ? new Map() : prev));
      return;
    }

    let ctrl: AbortController | null = null;
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      const qs = new URLSearchParams({
        q: term,
        group: 'category',
        sample: String(sampleSize),
        lang,
      });
      const signal = ctrl.signal;
      fetch(`${API_BASE}${url}?${qs.toString()}`, { signal })
        .then(res => res.json())
        .then(json => {
          if (signal.aborted) return;
          const rows = (json?.success ? json.data : []) as CategoryHit[];
          const next = new Map<string, CategoryHit>();
          for (const r of rows ?? []) {
            if (r?.category_id) next.set(String(r.category_id), r);
          }
          setHits(next);
          setLoading(false);
        })
        .catch(() => {
          if (signal.aborted) return;
          // Netzfehler: vorige Annotation halten, Ladezustand beenden. Die
          // Liste bleibt bedienbar, nur die Belege sind womöglich veraltet.
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      // Eingabe geändert, bevor die Antwort da war: die Vorgängeranfrage wird
      // abgebrochen, damit eine langsame ältere Antwort keine neuere
      // überschreibt. Die bereits gezeigte Annotation bleibt stehen.
      ctrl?.abort();
    };
  }, [shouldFetch, url, term, sampleSize, lang]);

  return useMemo(
    () => ({
      available,
      enabled,
      setEnabled,
      loading,
      active: shouldFetch,
      hits,
      minChars,
      sampleSize,
      term,
    }),
    // setEnabled schließt über setSearchParams (stabil je Render-Zyklus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, enabled, loading, shouldFetch, hits, minChars, sampleSize, term],
  );
}

/**
 * Belegzeile: die ersten `sample` Treffer kommagetrennt, danach die Restanzeige.
 * Der Server liefert das Sample bereits in der Anzeigereihenfolge
 * (Präfix-Treffer zuerst, darin alphabetisch).
 */
export function formatHitSample(hit: CategoryHit): string {
  const shown = hit.sample ?? [];
  const rest = Math.max(0, (hit.hit_count || 0) - shown.length);
  const list = shown.join(', ');
  return rest > 0 ? `${list} … +${rest}` : list;
}

/**
 * Hängt den Suchbegriff an die Navigations-Argumente einer Rubrikzeile, damit
 * die Eintragsliste ihn beim Öffnen übernimmt (A7). Die `navigate`-Action
 * kennt `q` und baut daraus den Query-String der Zielroute.
 *
 * Ohne gesetztes Kästchen wird das nie aufgerufen — der Rubrik-Klick trägt
 * dann keinen Param (A8).
 */
export function withSearchArg(actionArgs: unknown, query: string): string {
  const base = typeof actionArgs === 'string' ? actionArgs : '';
  if (!base || !query) return base;
  return `${base}&q=${encodeURIComponent(query)}`;
}

/** Erste Zeile eines Meta-Datasets (Konvention wie in AutoTable). */
export function metaRow(
  datasets: Record<string, DatasetResult>,
  id: string | undefined,
): Record<string, unknown> | undefined {
  if (!id) return undefined;
  return datasets[id]?.data?.[0];
}
