import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchScriptTokens } from '../api/scriptTokensApi';
import type { ScriptTokens } from '../script/types';

interface UseScriptTokensResult {
  data: ScriptTokens | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Cache per (uuid, lang) — a language switch must refetch enriched tokens
const cache = new Map<string, ScriptTokens>();

export const useScriptTokens = (
  uuid: string | undefined,
  lang: string,
  file?: string | null,
): UseScriptTokensResult => {
  const [data, setData] = useState<ScriptTokens | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  // Cache- und Fetch-Key inkl. file (Klon-Disambiguierung).
  const cacheKey = uuid ? `${uuid}::${lang}::${file ?? ''}` : '';

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
      const tokens = await fetchScriptTokens(uuid, lang, file);
      cache.set(cacheKey, tokens);
      setData(tokens);
    } catch (err) {
      console.error('Script token fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load the script');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [uuid, lang, file, cacheKey]);

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
