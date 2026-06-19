import { useEffect, useState } from 'react';
import { API_BASE } from '../../../config/apiBase';

export interface FmideFileStatus {
  script_present: boolean;
  script_valid: boolean;
  fmide_version: string | null;
}

export type FmideStatusMap = Record<string, FmideFileStatus>;

// Module-level memo so the many list rows share a single /api/fmide/status
// fetch (the map is the same for the whole solution).
let cache: FmideStatusMap | null = null;
let inflight: Promise<FmideStatusMap> | null = null;

function fetchStatuses(): Promise<FmideStatusMap> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(`${API_BASE}/api/fmide/status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        cache = (json && json.success ? json.data : {}) as FmideStatusMap;
        return cache;
      })
      .catch(() => {
        cache = {};
        return cache;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * Returns the per-file fmIDE script status map (or null until loaded). Used to
 * hide 🦄 actions for files without the fmIDE script, and to render the
 * "show files" status list in the settings panel. The `/api/fmide/status`
 * endpoint stays reachable even while the plugin is disabled (public route), so
 * the settings list works before the plugin is turned on. `reload` forces a
 * fresh fetch (e.g. after a DB re-import).
 */
export function useFmideStatus(reloadKey = 0): FmideStatusMap | null {
  const [statuses, setStatuses] = useState<FmideStatusMap | null>(cache);

  useEffect(() => {
    let cancelled = false;
    if (reloadKey > 0) cache = null; // force refetch on explicit reload
    fetchStatuses().then((map) => { if (!cancelled) setStatuses(map); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  return statuses;
}
