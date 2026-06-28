import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../config/apiBase';

/**
 * Lädt den Community-Namen-Status (`GET /api/graph/community-stats`): die
 * mitglieder-gewichtete Abdeckung der semantischen Namen, die Zähler
 * (semantisch / benutzer-definiert) und — für den F6-Failover — das Flag
 * `clusters_available`.
 *
 * Leichtgewichtig (zwei Aggregat-Queries im Backend), einmaliger Fetch mit
 * Refetch-Bump (nach einem Annotations-Write live aktualisieren). Wirft nie nach
 * außen: bei Fehler bleibt `data` null und die Statusleiste rendert nichts.
 */

/**
 * Persistierte Lauf-Metriken aus `.fmlab/cluster_run.json`.
 * `null`-Felder, wenn die Datei fehlt (alter Stand / noch nie geclustert).
 */
export type ClusterRunSummary = {
  n_nodes: number | null;
  n_edges: number | null;
  n_communities: number | null;
  modularity_q: number | null;
  resolution: number | null;
  seed: number | null;
  n_named: number | null;
};

export type CommunityStats = {
  engine: string;
  /** ObjectClusters trägt Daten (aktive Engine) → Community/Topologie verfügbar. */
  clusters_available: boolean;
  total_communities: number;
  named_communities: number;
  semantic_count: number;
  user_defined_count: number;
  /** 0..1, mitglieder-gewichtet; null, wenn (noch) keine semantischen Namen. */
  coverage_pct: number | null;
  /** Persistierte Run-Metriken (additiv); null ohne `cluster_run.json`. */
  run: ClusterRunSummary | null;
  /** ISO-Zeitstempel des letzten Cluster-Laufs; null, wenn unbekannt. */
  last_run: string | null;
};

type ApiEnvelope<T> = { success: boolean; data: T; error?: { message: string } };

export function useCommunityStats() {
  const [data, setData] = useState<CommunityStats | null>(null);
  const [loading, setLoading] = useState(false);
  // Bump-Zähler: nach einem Annotations-Write (eigener Name) live nachladen,
  // damit user_defined_count steigt, ohne Reload.
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/graph/community-stats`)
      .then(async (r) => {
        const json: ApiEnvelope<CommunityStats> = await r.json();
        if (!r.ok || !json.success) throw new Error(json.error?.message || `HTTP ${r.status}`);
        return json.data;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { data, loading, refetch };
}
