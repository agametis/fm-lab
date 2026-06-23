import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TableOccurrence } from './useRelationshipGraph';
import { useUrlState } from './useUrlState';

export type GraphSearchAPI = {
  query: string;
  setQuery: (q: string) => void;
  matchUuids: Set<string>;
  matches: TableOccurrence[];
  selectedUuid: string | null;
  selectNext: () => void;
  selectPrev: () => void;
  clear: () => void;

  isPreSelectActive: boolean;
  preSelectName: string | null;
  exitPreSelect: () => void;
};

/**
 * Steuert Such-Filterung, Selektion und Pre-Select-Modus für das Beziehungsdiagramm.
 *
 * Pre-Select-Modus: Eine über `initialPreSelectUuid` (z.B. aus `?to=`-URL-Parameter)
 * vorgegebene TO bildet die Single-Set-Fundmenge und ist sofort selektiert. Der Modus endet
 * bei Tipp-Eingabe, ESC, exitPreSelect() oder einem Wechsel der TO-Liste.
 */
export function useGraphSearch(
  tos: TableOccurrence[],
  initialPreSelectUuid: string | null
): GraphSearchAPI {
  // Suche liegt in der URL — Stack erhält State beim Zurück. selectedUuid und
  // preSelectUuid bleiben transient/effektgesteuert (preSelect kommt aus
  // ?to=-Parameter via initialPreSelectUuid und wird vom View-Wrapper verwaltet).
  const [query, setQueryState] = useUrlState<string>('q', '');
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [preSelectUuid, setPreSelectUuid] = useState<string | null>(initialPreSelectUuid);

  // Pre-Select bei Wechsel der eingangsseitigen UUID übernehmen (z.B. neue Datei + Deep-Link)
  // und auch dann zurücksetzen, wenn der Pre-Select aufgelöst werden soll (z.B. Datei-Wechsel ohne ?to=).
  const lastInitialRef = useRef(initialPreSelectUuid);
  useEffect(() => {
    if (initialPreSelectUuid !== lastInitialRef.current) {
      lastInitialRef.current = initialPreSelectUuid;
      setPreSelectUuid(initialPreSelectUuid);
      setQueryState('');
      setSelectedUuid(initialPreSelectUuid);
    }
  }, [initialPreSelectUuid]);

  const tosByUuid = useMemo(() => {
    const m = new Map<string, TableOccurrence>();
    for (const t of tos) m.set(t.uuid, t);
    return m;
  }, [tos]);

  // Pre-Select gilt nur, wenn die UUID auch in der aktuellen TO-Liste vorkommt.
  const effectivePreSelect = preSelectUuid && tosByUuid.has(preSelectUuid)
    ? preSelectUuid
    : null;

  const isPreSelectActive = effectivePreSelect !== null && query === '';

  const matches = useMemo<TableOccurrence[]>(() => {
    if (isPreSelectActive) {
      const t = tosByUuid.get(effectivePreSelect!);
      return t ? [t] : [];
    }
    if (query === '') return tos;
    const q = query.toLowerCase();
    return tos.filter(t => t.name.toLowerCase().includes(q));
  }, [isPreSelectActive, effectivePreSelect, tos, tosByUuid, query]);

  const matchUuids = useMemo(() => {
    const s = new Set<string>();
    for (const t of matches) s.add(t.uuid);
    return s;
  }, [matches]);

  // Selektion synchronisieren mit Fundmenge:
  //  - matches.length === 1 → diese eine TO automatisch selektieren (deckt auch Pre-Select ab)
  //  - sonst: Selektion verwerfen, wenn sie nicht mehr Teil der Fundmenge ist
  useEffect(() => {
    if (matches.length === 1) {
      const onlyUuid = matches[0].uuid;
      if (selectedUuid !== onlyUuid) {
        setSelectedUuid(onlyUuid);
      }
      return;
    }
    if (selectedUuid !== null && !matchUuids.has(selectedUuid)) {
      setSelectedUuid(null);
    }
  }, [matches, matchUuids, selectedUuid]);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    if (q !== '' && preSelectUuid !== null) {
      setPreSelectUuid(null);
    }
  }, [preSelectUuid]);

  const selectByOffset = useCallback((offset: 1 | -1) => {
    if (matches.length === 0) return;
    const currentIdx = selectedUuid
      ? matches.findIndex(t => t.uuid === selectedUuid)
      : -1;
    let nextIdx: number;
    if (currentIdx < 0) {
      nextIdx = offset === 1 ? 0 : matches.length - 1;
    } else {
      nextIdx = (currentIdx + offset + matches.length) % matches.length;
    }
    setSelectedUuid(matches[nextIdx].uuid);
  }, [matches, selectedUuid]);

  const selectNext = useCallback(() => selectByOffset(1), [selectByOffset]);
  const selectPrev = useCallback(() => selectByOffset(-1), [selectByOffset]);

  const clear = useCallback(() => {
    setQueryState('');
    setSelectedUuid(null);
    setPreSelectUuid(null);
  }, []);

  const exitPreSelect = useCallback(() => {
    setPreSelectUuid(null);
    setSelectedUuid(null);
  }, []);

  const preSelectName = isPreSelectActive && effectivePreSelect
    ? tosByUuid.get(effectivePreSelect)?.name ?? null
    : null;

  return {
    query,
    setQuery,
    matchUuids,
    matches,
    selectedUuid,
    selectNext,
    selectPrev,
    clear,
    isPreSelectActive,
    preSelectName,
    exitPreSelect,
  };
}
