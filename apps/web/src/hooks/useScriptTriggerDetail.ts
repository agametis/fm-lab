import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchScriptTriggerDetail } from '../api/scriptTriggerApi';
import type { ScriptTriggerDetailPayload } from '../script/calcTokens';

interface UseScriptTriggerDetailResult {
  data: ScriptTriggerDetailPayload | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Session-Cache pro (uuid, file) — Klon-Disambiguierung wie useObjectDetails.
const cache = new Map<string, ScriptTriggerDetailPayload>();

/**
 * Lädt die strukturierte ScriptTrigger-Projektion (Event, Modi, Script,
 * Owner-Kette, Parameter) via /api/get-details?format=tokens.
 */
export const useScriptTriggerDetail = (
  uuid: string | undefined,
  file?: string | null,
): UseScriptTriggerDetailResult => {
  const [data, setData] = useState<ScriptTriggerDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const cacheKey = uuid ? `${uuid}::${file ?? ''}` : '';

  const fetchData = useCallback(async () => {
    if (!uuid || isFetchingRef.current) return;

    const cached = cache.get(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    isFetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const payload = await fetchScriptTriggerDetail(uuid, file);
      cache.set(cacheKey, payload);
      setData(payload);
    } catch (err) {
      console.error('ScriptTrigger detail fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load trigger details');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [uuid, file, cacheKey]);

  useEffect(() => {
    if (uuid) {
      fetchData();
    } else {
      setData(null);
      setLoading(false);
      setError(null);
    }
  }, [fetchData, uuid]);

  return { data, loading, error, retry: fetchData };
};
