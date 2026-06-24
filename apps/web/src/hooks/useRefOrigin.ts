import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchBackReferences, type BackReferencesResponse } from '../api/backReferencesApi';

/**
 * Origin-Auflösung + Back-References-Lookup für Cross-Reference Highlight.
 *
 * Eingabe:
 *   - destinationUuid: aktuell geöffnetes Objekt (Pflicht für API-Call)
 *   - refParam:        `?ref=<uuid-or-name>` aus URL (nullable)
 *
 * Ausgabe:
 *   - status: 'idle' | 'loading' | 'resolved' | 'unresolved' | 'error'
 *   - origin: aufgelöstes Origin-Objekt (UUID, Type, Name, File) — nur bei status='resolved'
 *   - matchUuids: Set<UUID> aller Matches im Destination-Container
 *   - origin-Name als Fallback-Substring für Views ohne UUID-Match
 *
 * Caching: einfacher In-Memory-Cache pro `${dst}::${ref}` mit 5min TTL.
 */

export type RefOriginStatus = 'idle' | 'loading' | 'resolved' | 'unresolved' | 'error';

export interface RefOriginState {
  status: RefOriginStatus;
  origin: BackReferencesResponse['origin'];
  matchUuids: Set<string>;
  matchCount: number;
  matchStrategy: BackReferencesResponse['match_strategy'] | null;
  error: string | null;
}

const EMPTY_STATE: RefOriginState = {
  status: 'idle',
  origin: null,
  matchUuids: new Set<string>(),
  matchCount: 0,
  matchStrategy: null,
  error: null,
};

interface CacheEntry {
  ts: number;
  data: BackReferencesResponse;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): BackReferencesResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key: string, data: BackReferencesResponse): void {
  cache.set(key, { ts: Date.now(), data });
}

export function useRefOrigin(
  destinationUuid: string | undefined,
  refParam: string | null | undefined,
  destFile?: string | null,
): RefOriginState {
  const [state, setState] = useState<RefOriginState>(EMPTY_STATE);
  const fetchSeq = useRef(0);

  useEffect(() => {
    // Reset bei jedem Wechsel — neuer State-Snapshot, bevor evtl. Request läuft.
    if (!destinationUuid || !refParam) {
      setState(EMPTY_STATE);
      return;
    }

    // Klon-Disambiguierung: `destFile` skopiert die Destination-Seite (das aktuell
    // geöffnete, klon-aufgelöste Objekt) im Cache-Key UND im Back-Refs-Call. Der
    // Origin (refParam) ist oft nur Name/UUID ohne Datei → Graceful Downgrade.
    const cacheKey = `${destinationUuid}::${destFile ?? ''}::${refParam}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      setState(buildState(cached));
      return;
    }

    setState({ ...EMPTY_STATE, status: 'loading' });
    const seq = ++fetchSeq.current;

    fetchBackReferences(destinationUuid, refParam, 'auto', destFile)
      .then(data => {
        if (seq !== fetchSeq.current) return; // Veraltetes Result verwerfen
        cacheSet(cacheKey, data);
        setState(buildState(data));
      })
      .catch(err => {
        if (seq !== fetchSeq.current) return;
        setState({
          ...EMPTY_STATE,
          status: 'error',
          error: err instanceof Error ? err.message : 'Origin-Lookup fehlgeschlagen',
        });
      });
  }, [destinationUuid, refParam, destFile]);

  // matchUuids als stabile Set-Identität: solange Inhalt gleich ist, gleiche Ref.
  // Reduziert Re-Renders in Views, die das Set als Dependency nutzen.
  return useMemo(() => state, [state]);
}

function buildState(data: BackReferencesResponse): RefOriginState {
  // matchUuids enthält ZWEI Klassen von UUIDs:
  //   1. Container-interne Treffer (z.B. LayoutObject-UUIDs) — sichtbar als
  //      eigenes Sub-Objekt im View. Quelle: data.matches[].uuid.
  //   2. Origin-UUID selbst — für token-basierte Views (Script, CustomFunction):
  //      Die Tokens dort haben `ref.uuid === Origin.uuid`, also muss die
  //      Origin-UUID im Set sein, damit RefSpan/TokenSpan markieren kann.
  //   Beide Klassen sind disjunkt (Container-Kind ≠ Origin selbst), daher
  //   beeinflussen sie sich nicht. LayoutCanvas filtert sowieso nur gegen
  //   die eigenen Objekt-UUIDs — die zusätzliche Origin-UUID läuft dort ins
  //   Leere.
  //
  // Sonderfall — Token-Container-Self-Match (Script/CustomFunction):
  // back_references liefert für Token-Container einen Self-Link mit
  // uuid === destination.uuid als "1-Container-Match"-Repräsentant. Diese
  // UUID darf NICHT in matchUuids landen, sonst markiert RefSpan jeden
  // Token im View, der zufällig auf das Destination-Script selbst zeigt
  // (z.B. ein rekursiver Subscript-Call). Für die Token-Hervorhebung
  // reicht Klasse 2 (Origin-UUID).
  const uuids = new Set<string>();
  const containerUuids = new Set<string>();
  const destUuid = data.destination?.uuid;
  for (const m of data.matches) {
    if (destUuid && m.uuid === destUuid) {
      // Self-Match nicht ins Highlight-Set einfügen — er ist nur Container-
      // Match-Counter, kein konkretes Token im View.
      continue;
    }
    uuids.add(m.uuid);
    if (!data.origin || m.uuid !== data.origin.uuid) {
      containerUuids.add(m.uuid);
    }
  }
  if (data.origin) uuids.add(data.origin.uuid);

  // Self-Match-Erkennung für die Trefferzähler-Anzeige bleibt unverändert.
  const destSelfMatched = data.destination
    && data.matches.some(m => m.uuid === data.destination.uuid);

  return {
    status: data.origin ? 'resolved' : 'unresolved',
    origin: data.origin,
    matchUuids: uuids,
    matchCount: containerUuids.size + (destSelfMatched ? 1 : 0),
    matchStrategy: data.match_strategy,
    error: null,
  };
}
