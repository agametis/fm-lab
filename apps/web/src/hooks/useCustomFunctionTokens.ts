import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchCustomFunctionTokens } from '../api/customFunctionTokensApi';
import type { CustomFunctionTokens } from '../script/calcTokens';

interface UseCustomFunctionTokensResult {
  data: CustomFunctionTokens | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Cache pro (uuid, lang) — Wechsel der Sprache muss frische Anreicherung holen
const cache = new Map<string, CustomFunctionTokens>();

export const useCustomFunctionTokens = (
  uuid: string | undefined,
  lang: string,
): UseCustomFunctionTokensResult => {
  const [data, setData] = useState<CustomFunctionTokens | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const cacheKey = uuid ? `${uuid}::${lang}` : '';

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
      const tokens = await fetchCustomFunctionTokens(uuid, lang);
      cache.set(cacheKey, tokens);
      setData(tokens);
    } catch (err) {
      console.error('CustomFunction token fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load custom function');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [uuid, lang, cacheKey]);

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
