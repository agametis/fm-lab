import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import type { FMObject, ReferenceItem, GroupedReferences } from '../types';

interface UseObjectDetailResult {
  object: FMObject | null;
  references: GroupedReferences;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Simple in-memory cache (session-scoped)
const cache = new Map<string, { object: FMObject; references: GroupedReferences }>();

/**
 * Hook to fetch object details and references by UUID.
 * Parallel-fetches both endpoints and splits the flat reference array
 * into parent/child groups.
 */
const EMPTY_REFS: GroupedReferences = {
  parent: [],
  child: [],
  structuralParent: [],
  structuralChild: [],
};

export const useObjectDetail = (uuid: string | undefined): UseObjectDetailResult => {
  const [object, setObject] = useState<FMObject | null>(null);
  const [references, setReferences] = useState<GroupedReferences>(EMPTY_REFS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!uuid || isFetchingRef.current) return;

    // Check cache first
    const cached = cache.get(uuid);
    if (cached) {
      setObject(cached.object);
      setReferences(cached.references);
      setLoading(false);
      setError(null);
      return;
    }

    isFetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // Parallel fetch: object details + operational refs + structural refs.
      // Strukturelle Links (parent_folder, parent_object, parent_layout)
      // landen sonst nicht im Default-Operational-Filter.
      // Hohes Limit, damit z.B. BaseTables mit > 100 Feldern und TOs vollständig
      // ankommen — das API-Default (100) schneidet sonst bei UNION ALL ohne
      // ORDER BY je nach Insertion-Order ganze Typen ab. Filter und Suche im
      // HierarchyTree machen längere Listen handhabbar; obergrenze ist
      // environment.api.maxLimit (10000).
      const REFS_LIMIT = 10000;
      const [objectResponse, opRefsResponse, structRefsResponse] = await Promise.all([
        api.get({ uuid }),
        api.references({ uuid, direction: 'all', link_type: 'operational', limit: REFS_LIMIT }),
        api.references({ uuid, direction: 'all', link_type: 'structural', limit: REFS_LIMIT }),
      ]);

      // Extract object data
      const objectData = objectResponse.data as FMObject;

      // Split flat reference arrays into parent/child groups.
      // Sonderfall für `parent_*`-Roles: in ObjectLinks ist die Beziehung als
      // Sub→Container modelliert (Source=ScriptStep → Target=Script, Source=
      // LayoutObject → Target=Layout). Der Endpoint kennzeichnet das als
      // direction='child' — semantisch ist es aber eine Parent-Beziehung
      // ("Step ist ENTHALTEN IM Script"). Wir reklassifizieren diese Rollen
      // in structuralParent, damit die UI "Strukturell enthalten in" rendert.
      const PARENT_ROLES = new Set(['parent_script', 'parent_layout', 'parent_object']);
      const opRefs = (opRefsResponse.data ?? []) as unknown as ReferenceItem[];
      const structRefs = (structRefsResponse.data ?? []) as unknown as ReferenceItem[];
      const grouped: GroupedReferences = {
        parent: opRefs.filter(r => r.direction === 'parent'),
        child: opRefs.filter(r => r.direction === 'child'),
        structuralParent: structRefs.filter(r =>
          r.direction === 'parent' || (r.direction === 'child' && PARENT_ROLES.has(r.Link_Role))
        ),
        structuralChild: structRefs.filter(r =>
          r.direction === 'child' && !PARENT_ROLES.has(r.Link_Role)
        ),
      };

      // Cache the result
      cache.set(uuid, { object: objectData, references: grouped });

      setObject(objectData);
      setReferences(grouped);
    } catch (err) {
      console.error('Detail fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load object details');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [uuid]);

  useEffect(() => {
    setObject(null);
    setReferences(EMPTY_REFS);
    fetchData();
  }, [fetchData]);

  return { object, references, loading, error, retry: fetchData };
};
