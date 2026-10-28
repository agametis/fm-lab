import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../config/apiBase';
import { debugHeaders, recordDebug } from '../debug/session';

/**
 * Loads one level of the Graph-Atlas from `GET /api/graph/overview` and exposes
 * the typed response plus loading/error state.
 *
 * The Atlas is a top-down funnel over the *logical* graph (not the 148k/438k
 * catalog): two orthogonal axes — segmentation (`segment_by`) × representation
 * (`view`). Composition (treemap) drills root → segment → leaf; topology
 * (meta-graph) is single-step. Each level is its own endpoint call, so the hook
 * stays thin — no client-side mega-tree, the funnel state lives in the view.
 */

export type AtlasView = 'composition' | 'topology';
export type AtlasLevel = 'root' | 'segment' | 'leaf';
export type AtlasSegmentBy = 'community' | 'file' | 'type' | 'hubs';
export type AtlasWeight = 'domain' | 'logical';

/**
 * Change activity of a tile or super-node (only with `activity=true`, i.e. the
 * colour modes "activity" and "saves"). Classes count back from the data state:
 * 1 ≤ 30 days · 2 ≤ 90 days · 3 ≤ 1 year · 4 ≤ 2 years · 5 > 2 years ·
 * 6 unknown (only a young mass stamp) · 7 no stamp. `class` is the youngest class
 * among the members; `class_counts` holds the members per class 1…7.
 */
export type AtlasActivity = {
  class: number;
  class_counts: number[];
  newest_change: string | null;
  newest_age_days: number | null;
  active_90: number;
  median_age_days: number | null;
  median_saves: number | null;
  stamped: number;
  undated: number;
  /** 1 (few) … 5 (many lifetime saves), null without a stamped member. */
  saves_level: number | null;
  saves_sum: number;
  saves_n: number;
};

/** Activity head of a response: whether it was computed and its data state. */
export type AtlasActivityHead = {
  requested: boolean;
  /** The catalog carries change stamps (else the colour modes stay off). */
  available: boolean;
  data_state: string | null;
  bulk: 'hide' | 'include';
};

/** Aggregate tile (root/segment): one segment, area = Σ weight. */
export type AtlasAggregateTile = {
  kind: 'aggregate';
  key: string;
  label: string;
  node_count: number;
  weight: number;
  color_type: string | null;
  // User-Annotation (nur Community-Aggregate, segment_by=community/root): Name/Notiz
  // + Engine (Write-Key). Vom Backend-Overlay gesetzt; label trägt bereits user_name.
  engine?: string;
  user_name?: string | null;
  user_notes?: string | null;
  /** Schwerstes Member der Community (für „Im Graph Explorer öffnen" aus dem Panel). */
  top_member_uuid?: string | null;
  activity?: AtlasActivity | null;
};

/** Leaf tile: a single graph node → click hands off to the Graph Explorer. */
export type AtlasLeafTile = {
  kind: 'leaf';
  key: string;        // composite uuid::file
  uuid: string;
  file: string | null;
  label: string;
  type: string;
  community: number | null;
  weight: number;
  /** User-Sichtbarkeit (Noise-Filter): true = vom Nutzer ausgeblendet. */
  hidden?: boolean;
  activity?: AtlasActivity | null;
};

/** Grey "Rest" collecting tile (Top-K fold / leaf truncation). */
export type AtlasRestTile = {
  kind: 'rest';
  key: '__rest__';
  label: string;
  node_count: number;
  weight: number | null;
  color_type?: null;
  segment_count?: number;
  /** Activity of the folded tiles / the nodes beyond the leaf cap. */
  activity?: AtlasActivity | null;
};

export type AtlasTile = AtlasAggregateTile | AtlasLeafTile | AtlasRestTile;

export type AtlasCompositionResponse = {
  view: 'composition';
  level: AtlasLevel;
  segment_by: AtlasSegmentBy;
  parent: { community: number | null; file: string | null; type: string | null };
  weight: AtlasWeight;
  activity: AtlasActivityHead;
  truncated: boolean;
  tiles: AtlasTile[];
};

export type AtlasMetaNode = {
  key: string;
  label: string;
  member_count: number;
  weight: number;
  color_type: string | null;
  top_member_uuid?: string | null;
  top_member_file?: string | null;
  kind?: 'rest';
  segment_count?: number;
  // User-Annotation (nur Community-Super-Nodes): Name/Notiz + Engine (Write-Key).
  engine?: string;
  user_name?: string | null;
  user_notes?: string | null;
  activity?: AtlasActivity | null;
};

export type AtlasMetaEdge = { source: string; target: string; weight: number };

export type AtlasTopologyResponse = {
  view: 'topology';
  segment_by: AtlasSegmentBy;
  weight: AtlasWeight;
  activity: AtlasActivityHead;
  nodes: AtlasMetaNode[];
  edges: AtlasMetaEdge[];
};

export type AtlasResponse = AtlasCompositionResponse | AtlasTopologyResponse;

/** The funnel coordinate the view drives the hook with. */
export type AtlasQuery = {
  view: AtlasView;
  level: AtlasLevel;
  segmentBy: AtlasSegmentBy;
  parentCommunity?: number | null;
  parentFile?: string | null;
  parentType?: string | null;
  weight: AtlasWeight;
  includeBuiltins?: boolean;
  /** Objekttyp-Exclusion (Filterleiste) — diese Typen vor der Aggregation ausblenden. */
  excludeTypes?: string[];
  /** false → Top-K/„Rest"-Faltung der Aggregat-Ebenen aufheben (alle Segmente). */
  fold?: boolean;
  limit?: number;
  /** Compute the change activity per tile (colour modes "activity"/"saves"). */
  activity?: boolean;
  /** Mass stamps date the last change like individual ones ("include mass events"). */
  activityBulk?: 'hide' | 'include';
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: { message: string };
};

const baseUrl = `${API_BASE}/api`;

/** Serialize the funnel coordinate to the overview query string. */
function buildQuery(q: AtlasQuery): string {
  const p = new URLSearchParams();
  p.set('view', q.view);
  p.set('segment_by', q.segmentBy);
  p.set('weight', q.weight);
  // level is meaningless for topology; the backend ignores it there.
  if (q.view === 'composition') p.set('level', q.level);
  if (q.parentCommunity !== null && q.parentCommunity !== undefined) {
    p.set('parent_community', String(q.parentCommunity));
  }
  if (q.parentFile) p.set('parent_file', q.parentFile);
  if (q.parentType) p.set('parent_type', q.parentType);
  if (q.includeBuiltins) p.set('include_builtins', 'true');
  if (q.excludeTypes && q.excludeTypes.length > 0) p.set('exclude_types', q.excludeTypes.join(','));
  if (q.fold === false) p.set('fold', 'false');
  if (q.limit) p.set('limit', String(q.limit));
  if (q.activity) p.set('activity', 'true');
  if (q.activity && q.activityBulk === 'include') p.set('activity_bulk', 'include');
  return p.toString();
}

/**
 * Fetch one Atlas level. Re-fetches whenever the serialized query changes;
 * cancels in-flight requests on change/unmount to avoid out-of-order state.
 */
export function useGraphOverview(query: AtlasQuery) {
  const [data, setData] = useState<AtlasResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump-Zähler: nach einer Annotation-Mutation (Hide/Name/Notiz) erzwingt der
  // View ein Refetch der aktuellen Ebene (Backend hat seinen Cache schon geleert).
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const key = buildQuery(query);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Debug-Session: jeden Atlas-Fetch in die korrelierte Zeitachse legen
    // (Query-String = Parametermix, der den Backend-Prozess auslöst). Der
    // X-Debug-Session-Header verschränkt diese Zeile mit dem Backend-reqId.
    const t0 = performance.now();
    recordDebug('overview_fetch', { phase: 'start', query: key });

    fetch(`${baseUrl}/graph/overview?${key}`, { headers: { ...debugHeaders() } })
      .then(async (r) => {
        const json: ApiEnvelope<AtlasResponse> = await r.json();
        if (!r.ok || !json.success) {
          throw new Error(json.error?.message || `HTTP ${r.status}`);
        }
        return json.data;
      })
      .then((d) => {
        if (!cancelled) setData(d);
        recordDebug('overview_fetch', {
          phase: 'ok', query: key, dur_ms: Math.round(performance.now() - t0),
        });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) setError(message);
        recordDebug('overview_fetch', {
          phase: 'error', query: key, dur_ms: Math.round(performance.now() - t0), error: message,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  return { data, loading, error, refetch };
}
