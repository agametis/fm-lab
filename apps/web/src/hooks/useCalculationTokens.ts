import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchCalculationTokens } from '../api/calculationTokensApi';
import type { CalculationTokens } from '../script/calcTokens';

interface UseCalculationTokensResult {
  data: CalculationTokens | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Cache pro (uuid, lang, file) — Sprachwechsel muss frische Anreicherung holen.
const cache = new Map<string, CalculationTokens>();

/**
 * Lädt Formel-Tokens + Instanz-Metadaten einer Calculation-Instanz
 * (Calculation_UUID) via /api/get-details?format=tokens.
 */
export const useCalculationTokens = (
  uuid: string | undefined,
  lang: string,
  file?: string | null,
): UseCalculationTokensResult => {
  const [data, setData] = useState<CalculationTokens | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

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
      const tokens = await fetchCalculationTokens(uuid, lang, file);
      cache.set(cacheKey, tokens);
      setData(tokens);
    } catch (err) {
      console.error('Calculation token fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load calculation details');
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
