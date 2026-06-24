import { useState, useEffect, useRef, useCallback } from 'react';
import { ApiError } from '@packages/shared';
import { api } from '../api/client';
import type { FMObject, ReferenceItem, GroupedReferences } from '../types';

interface UseObjectDetailResult {
  object: FMObject | null;
  references: GroupedReferences;
  loading: boolean;
  error: string | null;
  /**
   * Klon-Disambiguierung (Sicherheitsnetz): bei `409 AMBIGUOUS_UUID` — eine bare
   * UUID, die in mehreren Dateien existiert — die Liste der betroffenen Dateien.
   * Die DetailView rendert daraus einen Datei-Picker. `null` = nicht mehrdeutig.
   */
  ambiguousFiles: string[] | null;
  retry: () => void;
}

// Simple in-memory cache (session-scoped).
// Key = `${uuid}::${file ?? ''}` — Klon-Disambiguierung: zwei Objekte mit
// geteilter UUID aus verschiedenen Dateien dürfen sich nicht den Cache-Eintrag
// teilen. Ohne `file` (Graceful Downgrade) bleibt der Key bare-UUID-äquivalent.
const cache = new Map<string, { object: FMObject; references: GroupedReferences }>();

const cacheKeyFor = (uuid: string, file?: string | null): string => `${uuid}::${file ?? ''}`;

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

export const useObjectDetail = (
  uuid: string | undefined,
  file?: string | null,
): UseObjectDetailResult => {
  const [object, setObject] = useState<FMObject | null>(null);
  const [references, setReferences] = useState<GroupedReferences>(EMPTY_REFS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ambiguousFiles, setAmbiguousFiles] = useState<string[] | null>(null);
  const isFetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!uuid || isFetchingRef.current) return;

    // Check cache first
    const cached = cache.get(cacheKeyFor(uuid, file));
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
    setAmbiguousFiles(null);

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
      const fileParam = file || undefined;
      const [objectResponse, opRefsResponse, structRefsResponse] = await Promise.all([
        api.get({ uuid, file: fileParam }),
        api.references({ uuid, file: fileParam, direction: 'all', link_type: 'operational', limit: REFS_LIMIT }),
        api.references({ uuid, file: fileParam, direction: 'all', link_type: 'structural', limit: REFS_LIMIT }),
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
      cache.set(cacheKeyFor(uuid, file), { object: objectData, references: grouped });

      setObject(objectData);
      setReferences(grouped);
    } catch (err) {
      // Sicherheitsnetz: bare-UUID-Navigation auf ein in mehreren Dateien
      // existierendes Objekt → 409 AMBIGUOUS_UUID. Statt eines harten Fehlers
      // die matched_files für den Datei-Picker durchreichen.
      if (err instanceof ApiError && err.code === 'AMBIGUOUS_UUID') {
        const files = (err.details?.matched_files as string[] | undefined) ?? [];
        setAmbiguousFiles(files);
      } else {
        console.error('Detail fetch failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to load object details');
      }
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [uuid, file]);

  useEffect(() => {
    setObject(null);
    setReferences(EMPTY_REFS);
    setAmbiguousFiles(null);
    fetchData();
  }, [fetchData]);

  return { object, references, loading, error, ambiguousFiles, retry: fetchData };
};
