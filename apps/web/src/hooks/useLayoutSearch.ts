import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LayoutObject } from './useLayoutData';
import { useUrlState, stringSetCodec } from './useUrlState';

const EMPTY_TYPES = new Set<string>();

export type LayoutSearchAPI = {
  query: string;
  setQuery: (q: string) => void;

  activeTypes: Set<string>;
  toggleType: (type: string) => void;
  setTypes: (types: string[], active: boolean) => void;
  clearTypes: () => void;

  matchUuids: Set<string>;
  matches: LayoutObject[];

  selectedUuid: string | null;
  selectNext: () => void;
  selectPrev: () => void;
  clear: () => void;

  filterActive: boolean;
};

/**
 * Konsolidierter Such-Text pro Layout-Objekt:
 * deckt Feldname, Script-Caption, Text-Inhalt, Object_Name und Object_Type ab,
 * sodass eine einzelne Substring-Eingabe alle relevanten Bezeichnungen findet.
 */
function buildSearchText(o: LayoutObject): string {
  return [
    o.field_name ?? '',
    o.script_name ?? '',
    o.text_content ?? '',
    o.object_name ?? '',
    o.object_type,
  ].join(' ').toLowerCase();
}

/**
 * Steuert Such-Filter, Typ-Pillen-Filter und Selektion (TAB-Cursor) für die Layout-Ansicht.
 *
 * Sortierung der Fundmenge entspricht der SVG-Render-Reihenfolge: (Nesting_Level, Object_ID).
 * Die Daten kommen bereits sortiert aus dem SQL-Template, deshalb reicht ein einfacher Filter.
 *
 * Cross-Reference Highlight:
 * `externalMatchUuids` injiziert eine Vor-Auswahl, die als weicher Filter wirkt,
 * solange der User nicht selbst interagiert. Sobald der User aktiv sucht oder
 * einen Typ-Filter aktiviert, wird der `?ref=`-Param ATOMAR im selben URL-Update
 * mitentfernt — der Referenz-Modus war kontextuell, neue Interaktion beendet ihn.
 *
 * Warum atomar? Andernfalls würde der separate `setRefParam('')`-Call aus
 * DetailView (anderes useSearchParams-Hook) mit dem Filter-`setSearchParams`
 * kollidieren — beide Hook-Instanzen halten je eine eigene Memo-Closure auf
 * `searchParams`, und der zweite Aufruf würde den Stand des ersten überschreiben.
 */
export function useLayoutSearch(
  objects: LayoutObject[],
  externalMatchUuids?: Set<string> | null,
  onUserInteraction?: () => void,
): LayoutSearchAPI {
  // Such- und Filter-State liegt in der URL — Stack erhält den State beim
  // Zurück-Navigieren. selectedUuid bleibt transient (Cursor pro TAB-Schritt
  // soll nicht in jedem Render die URL fluten).
  //
  // Lesen via useUrlState, Schreiben für User-Interaktionen via setSearchParams
  // direkt (atomarer Multi-Param-Update mit ref-Clear).
  const [query, setQueryState] = useUrlState<string>('q', '');
  const [activeTypes, setActiveTypes] = useUrlState<Set<string>>('types', EMPTY_TYPES, stringSetCodec);
  const [, setSearchParams] = useSearchParams();
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  // Bei Layout-Wechsel: nur Selektion zurücksetzen — Suche/Filter bleiben durch
  // URL-Persistenz intakt; auto-select-Effekt greift im neuen Match-Set.
  useEffect(() => {
    setSelectedUuid(null);
  }, [objects]);

  // Stable empty-set Identität für externalMatchUuids, damit useMemo nicht
  // bei jedem Render neue Refs sieht, wenn das Set extern leer übergeben wird.
  const externalHasItems = !!(externalMatchUuids && externalMatchUuids.size > 0);

  const matches = useMemo<LayoutObject[]>(() => {
    const typeFiltered = activeTypes.size === 0
      ? objects
      : objects.filter(o => activeTypes.has(o.object_type));

    let result = typeFiltered;
    if (query !== '') {
      const q = query.toLowerCase();
      result = result.filter(o => buildSearchText(o).includes(q));
    } else if (activeTypes.size === 0 && externalHasItems) {
      // Ref-Vorauswahl wirkt NUR, solange weder Suche noch Typ-Filter aktiv sind.
      // Sobald der User selbst filtert, gewinnt seine Wahl — der ref-Param wird
      // zusätzlich im URL-Update mit entfernt (siehe runUserUpdate unten).
      result = result.filter(o => externalMatchUuids!.has(o.object_uuid));
    }
    return result;
  }, [objects, activeTypes, query, externalHasItems, externalMatchUuids]);

  const matchUuids = useMemo(() => {
    const s = new Set<string>();
    for (const o of matches) s.add(o.object_uuid);
    return s;
  }, [matches]);

  // Selektion mit Fundmenge synchronisieren — analog useGraphSearch:
  //  - genau 1 Treffer → diesen automatisch selektieren (rote Umrandung sofort)
  //  - selektierte UUID nicht mehr in der Fundmenge → Selektion verwerfen
  useEffect(() => {
    if (matches.length === 1) {
      const only = matches[0].object_uuid;
      if (selectedUuid !== only) setSelectedUuid(only);
      return;
    }
    if (selectedUuid !== null && !matchUuids.has(selectedUuid)) {
      setSelectedUuid(null);
    }
  }, [matches, matchUuids, selectedUuid]);

  // Live-Ref auf externalHasItems, damit der atomare Setter den aktuellen Wert
  // ohne Re-Bind sieht — sonst müsste jeder Callback bei jedem ref-Toggle neu
  // erstellt werden.
  const refActiveRef = useRef(externalHasItems);
  refActiveRef.current = externalHasItems;
  const interactionRef = useRef(onUserInteraction);
  interactionRef.current = onUserInteraction;

  /**
   * Atomarer URL-Update für User-Interaktionen: führt einen Updater auf den
   * URLSearchParams aus UND entfernt im selben Tick den `?ref=`-Param, falls
   * gerade ein Cross-Reference Highlight aktiv ist. Beide Mutationen landen
   * in EINEM `setSearchParams`-Call — keine Race-Condition zwischen separaten
   * useUrlState-Hook-Instanzen.
   */
  const runUserUpdate = useCallback(
    (updater: (p: URLSearchParams) => void) => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        updater(next);
        if (refActiveRef.current && next.has('ref')) {
          next.delete('ref');
        }
        return next;
      }, { replace: true });
      // Audit-Hook für Konsumenten, die wissen wollen, dass die Interaktion
      // den Referenz-Modus beendet hat (z.B. für Analytics oder Logging).
      if (refActiveRef.current) interactionRef.current?.();
    },
    [setSearchParams],
  );

  const setQuery = useCallback((q: string) => {
    // Programmatic Clear (z.B. via ESC-Stack) soll NICHT den ref entfernen —
    // dafür nimmt es den ungetrappten Setter aus useUrlState.
    if (q === '') {
      setQueryState('');
      return;
    }
    runUserUpdate(p => {
      p.set('q', q);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runUserUpdate]);

  const toggleType = useCallback((type: string) => {
    runUserUpdate(p => {
      const current = new Set(
        (p.get('types') ?? '').split(',').map(s => s.trim()).filter(Boolean),
      );
      if (current.has(type)) current.delete(type);
      else current.add(type);
      if (current.size === 0) p.delete('types');
      else p.set('types', Array.from(current).join(','));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runUserUpdate]);

  // Bulk-Setter für Gruppen-Pillen: aktiviert oder deaktiviert mehrere Typen auf einen Schlag,
  // ohne die anderen aktiven Typen zu verlieren.
  const setTypes = useCallback((types: string[], active: boolean) => {
    runUserUpdate(p => {
      const current = new Set(
        (p.get('types') ?? '').split(',').map(s => s.trim()).filter(Boolean),
      );
      if (active) {
        for (const t of types) current.add(t);
      } else {
        for (const t of types) current.delete(t);
      }
      if (current.size === 0) p.delete('types');
      else p.set('types', Array.from(current).join(','));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runUserUpdate]);

  const clearTypes = useCallback(() => {
    // clearTypes wird vom ESC-Stack und vom "Filter zurücksetzen"-Link genutzt
    // — beides ist eine programmatische Zurücknahme, nicht die Anlage eines
    // neuen Filters. ref bleibt unverändert.
    setActiveTypes(EMPTY_TYPES);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectByOffset = useCallback((offset: 1 | -1) => {
    if (matches.length === 0) return;
    const currentIdx = selectedUuid
      ? matches.findIndex(o => o.object_uuid === selectedUuid)
      : -1;
    let nextIdx: number;
    if (currentIdx < 0) {
      nextIdx = offset === 1 ? 0 : matches.length - 1;
    } else {
      nextIdx = (currentIdx + offset + matches.length) % matches.length;
    }
    setSelectedUuid(matches[nextIdx].object_uuid);
  }, [matches, selectedUuid]);

  const selectNext = useCallback(() => selectByOffset(1), [selectByOffset]);
  const selectPrev = useCallback(() => selectByOffset(-1), [selectByOffset]);

  const clear = useCallback(() => {
    setQueryState('');
    setSelectedUuid(null);
  }, []);

  const filterActive = query !== '' || activeTypes.size > 0 || externalHasItems;

  return {
    query,
    setQuery,
    activeTypes,
    toggleType,
    setTypes,
    clearTypes,
    matchUuids,
    matches,
    selectedUuid,
    selectNext,
    selectPrev,
    clear,
    filterActive,
  };
}
