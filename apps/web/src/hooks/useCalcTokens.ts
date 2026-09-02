import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchCalcTokens, type CalcTokenKeyKind } from '../api/calcTokensApi';
import type { CalculationTokens } from '../script/calcTokens';

interface UseCalcTokensResult {
  data: CalculationTokens | null;
  loading: boolean;
  error: string | null;
}

// Cache pro (key-kind, key, lang). Hash-Adressierung: DDR-Hashes sind über die
// ganze Lösung geteilt (gleicher Calc-Text ⇒ gleicher Hash), daher lösungsweit
// gültig. UUID-Adressierung: instanz-exakt (Calculation_UUID, Schema 1.22.0).
const cache = new Map<string, CalculationTokens>();

/**
 * Lädt die Token-Sequenz einer Calculation via /api/get-calc.
 * `key` darf undefined sein (z.B. Access_Mode ≠ Calculation, DDR-lose Instanz)
 * — dann passiert nichts. `by` wählt die Adressierung: 'hash' (Default,
 * bestandserhaltend) oder 'uuid' (Calculation_UUID, instanz-exakt).
 */
export const useCalcTokens = (
  key: string | undefined | null,
  lang: string,
  by: CalcTokenKeyKind = 'hash',
): UseCalcTokensResult => {
  const [data, setData] = useState<CalculationTokens | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const cacheKey = key ? `${by}:${key}::${lang}` : '';

  const fetchData = useCallback(async () => {
    if (!key || isFetchingRef.current) return;

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
      const tokens = await fetchCalcTokens(key, lang, by);
      cache.set(cacheKey, tokens);
      setData(tokens);
    } catch (err) {
      console.error('Calc token fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load calculation');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [key, lang, by, cacheKey]);

  useEffect(() => {
    if (key) {
      fetchData();
    } else {
      setData(null);
      setLoading(false);
      setError(null);
    }
  }, [fetchData, key]);

  return { data, loading, error };
};
