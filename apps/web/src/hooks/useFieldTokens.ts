import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchFieldTokens } from '../api/fieldTokensApi';
import type { FieldTokens } from '../script/calcTokens';

interface UseFieldTokensResult {
  data: FieldTokens | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Cache pro (uuid, lang) — Wechsel der Sprache muss frische Anreicherung holen
const cache = new Map<string, FieldTokens>();

export const useFieldTokens = (
  uuid: string | undefined,
  lang: string,
  file?: string | null,
): UseFieldTokensResult => {
  const [data, setData] = useState<FieldTokens | null>(null);
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
      const tokens = await fetchFieldTokens(uuid, lang, file);
      cache.set(cacheKey, tokens);
      setData(tokens);
    } catch (err) {
      console.error('Field token fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load field details');
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
