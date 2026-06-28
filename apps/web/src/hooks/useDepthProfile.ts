import { useEffect, useState } from 'react';
import { API_BASE } from '../config/apiBase';
import type { SubgraphDirection, SubgraphMode } from './useSubgraph';

/**
 * Lädt das Tiefen-Profil eines Fokus-Knotens (`GET /api/graph/depth-profile`):
 * max. erreichbare Tiefe (Exzentrizität) + Knotenzahl je Tiefe (kumulativ). Dient
 * der Schieberegler-Anzeige „Tiefe: d (von N)", der Opt-in-Erweiterung über 4
 * hinaus und dem Vorab-Clipping-Hinweis (Last je Tiefe vor dem Laden).
 *
 * Richtungsabhängig: out|in|both ergeben verschiedene Maxtiefen → re-fetch bei
 * Fokus-/Richtungswechsel. Leichtgewichtig (Backend: nur Walk-Aggregat).
 */

export type DepthBucket = { depth: number; nodes: number; cumulative: number };

export type DepthProfile = {
  focus: string;
  direction: SubgraphDirection;
  mode: SubgraphMode;
  maxDepth: number;
  hitCap: boolean;
  hardCap: number;
  perDepth: DepthBucket[];
};

type ApiEnvelope<T> = { success: boolean; data: T; error?: { message: string } };

const baseUrl = `${API_BASE}/api`;

export function useDepthProfile(
  focus: string | null,
  focusFile: string | null,
  direction: SubgraphDirection,
  mode: SubgraphMode = 'logical',
  /** Aktiver serverseitiger Typ-Filter (CSV-Quelle) — MUSS dem Subgraph entsprechen,
   *  sonst zählt das Profil eine andere (ungefilterte) erreichbare Menge. */
  types: string[] | null = null,
) {
  const [profile, setProfile] = useState<DepthProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const typesKey = types && types.length > 0 ? [...types].sort().join(',') : '';
  const key = focus ? `${focus}|${focusFile ?? ''}|${direction}|${mode}|${typesKey}` : null;

  useEffect(() => {
    if (!focus || !key) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const q = new URLSearchParams();
    q.set('focus', focus);
    if (focusFile) q.set('focus_file', focusFile);
    q.set('direction', direction);
    q.set('mode', mode);
    if (typesKey) q.set('types', typesKey);

    fetch(`${baseUrl}/graph/depth-profile?${q.toString()}`)
      .then(async (r) => {
        const json: ApiEnvelope<DepthProfile> = await r.json();
        if (!r.ok || !json.success) throw new Error(json.error?.message || `HTTP ${r.status}`);
        return json.data;
      })
      .then((d) => { if (!cancelled) setProfile(d); })
      // Best-effort: ein Profil-Fehler darf die Explorer-UI nicht kippen — Anzeige
      // fällt dann auf „Tiefe: d" (ohne „von N") zurück, Regler bleibt bei max 4.
      .catch(() => { if (!cancelled) setProfile(null); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { profile, loading };
}
