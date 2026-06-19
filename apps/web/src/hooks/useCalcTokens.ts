import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchCalcTokens } from '../api/calcTokensApi';
import type { CalculationTokens } from '../script/calcTokens';

interface UseCalcTokensResult {
  data: CalculationTokens | null;
  loading: boolean;
  error: string | null;
}

// Cache pro (hash, lang). DDR-Hashes sind über die ganze Lösung geteilt
// (gleicher Calc-Text ⇒ gleicher Hash), daher ist der Cache lösungsweit gültig.
const cache = new Map<string, CalculationTokens>();

/**
 * Lädt die Token-Sequenz einer Calculation per DDR-Hash via /api/get-calc.
 * `hash` darf undefined sein (z.B. Access_Mode ≠ Calculation) — dann passiert nichts.
 */
export const useCalcTokens = (
  hash: string | undefined | null,
  lang: string,
): UseCalcTokensResult => {
  const [data, setData] = useState<CalculationTokens | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const cacheKey = hash ? `${hash}::${lang}` : '';

  const fetchData = useCallback(async () => {
    if (!hash || isFetchingRef.current) return;

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
      const tokens = await fetchCalcTokens(hash, lang);
      cache.set(cacheKey, tokens);
      setData(tokens);
    } catch (err) {
      console.error('Calc token fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load calculation');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [hash, lang, cacheKey]);

  useEffect(() => {
    if (hash) {
      fetchData();
    } else {
      setData(null);
      setLoading(false);
      setError(null);
    }
  }, [fetchData, hash]);

  return { data, loading, error };
};
