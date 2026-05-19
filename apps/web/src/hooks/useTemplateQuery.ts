import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTemplateQuery } from '../api/templateApi';

interface UseTemplateQueryResult {
  data: Array<Record<string, unknown>> | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Session-scoped cache (keyed by template+params)
const cache = new Map<string, Array<Record<string, unknown>>>();

function makeCacheKey(template: string, params: Record<string, string>): string {
  return `${template}:${JSON.stringify(params)}`;
}

/**
 * Hook to execute a template query and manage loading/error/cache state.
 * Only fetches when enabled is true (allows conditional fetching).
 */
export const useTemplateQuery = (
  template: string,
  params: Record<string, string>,
  enabled: boolean = true
): UseTemplateQueryResult => {
  const [data, setData] = useState<Array<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const cacheKey = makeCacheKey(template, params);

  const fetchData = useCallback(async () => {
    if (!enabled || isFetchingRef.current) return;

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
      const response = await fetchTemplateQuery(template, params);
      cache.set(cacheKey, response.data);
      setData(response.data);
    } catch (err) {
      console.error('Template query failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load details');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, cacheKey, enabled]);

  useEffect(() => {
    if (enabled) {
      fetchData();
    } else {
      setData(null);
      setLoading(false);
      setError(null);
    }
  }, [fetchData, enabled]);

  return { data, loading, error, retry: fetchData };
};
