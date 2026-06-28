import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../config/apiBase';

/**
 * Lädt die vollständige Community-Liste der aktiven Engine
 * (`GET /api/graph/communities`) — node-gewichtet sortiert,
 * mit aufgelöstem Namen/Beschreibung (User > Semantic > Heuristic) und den
 * Roh-Overlays für den Inline-Editor. Refetch-Bump nach einem Annotations-Write
 * bzw. einem Re-Clustering. Wirft nie nach außen: bei Fehler bleibt `data` null.
 */

export type Community = {
  community: number;
  /** User_Name > Semantic_Name > Heuristic_Name > „Community N". */
  display_name: string;
  /** User_Notes > Semantic_Description; kann null sein. */
  description: string | null;
  user_name: string | null;
  user_notes: string | null;
  semantic_name: string | null;
  heuristic_name: string | null;
  semantic_description: string | null;
  member_count: number;
  dominant_type: string | null;
  dominant_file: string | null;
  top_member_uuid: string | null;
  top_member_label: string | null;
  top_member_file: string | null;
};

export type CommunitiesResponse = {
  engine: string;
  communities: Community[];
};

type ApiEnvelope<T> = { success: boolean; data: T; error?: { message: string } };

export function useCommunities() {
  const [data, setData] = useState<CommunitiesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/graph/communities`)
      .then(async (r) => {
        const json: ApiEnvelope<CommunitiesResponse> = await r.json();
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
