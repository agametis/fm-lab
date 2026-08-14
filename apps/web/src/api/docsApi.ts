import { API_BASE } from '../config/apiBase';

/**
 * Docs manifest API (GET /api/docs) — catalog + installed doc-sets.
 * Plain fetch; the catalog is solution-independent and changes only when the
 * maintainer edits `.fmlab/docs.json`, so one in-memory cache per SPA session
 * is enough (used by the DocsSetPage bundle switch).
 */

export interface DocsCatalogEntry {
  id: string;
  name: string;
  description: string | null;
  source_url: string | null;
  skill: string | null;
  languages: string[];
  visible: boolean;
  references: boolean;
  output_format: string;
  download_format: string | null;
  index_page: string | null;
  /** Content-root-relative page slug rendered as the doc-set's start page (null → default listing). */
  start_page: string | null;
}

interface DocsManifestResponse {
  catalog: DocsCatalogEntry[];
}

let catalogPromise: Promise<DocsCatalogEntry[]> | null = null;

export function fetchDocsCatalog(): Promise<DocsCatalogEntry[]> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const res = await fetch(`${API_BASE}/api/docs`);
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message || `Request failed (HTTP ${res.status})`);
      }
      return (json.data as DocsManifestResponse).catalog ?? [];
    })().catch(err => {
      // Fehlversuche nicht dauerhaft cachen — nächster Aufruf versucht es erneut.
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}
