/**
 * Storage-version mismatch between the catalog file and the REST API's bundled
 * DuckDB (mixed DuckDB versions: the CLI that wrote the catalog is newer — or
 * older — than `@duckdb/node-api`). The backend then answers every request for
 * the solution with `STORAGE_VERSION_MISMATCH` (503) and reports the same
 * diagnosis in `/api/version → data.database.error`.
 *
 * Two sources feed the global notice, so it shows wherever the user is:
 * the fetch wrapper (any failing request, also after an import into an open
 * tab) and a one-time `/api/version` check on mount (dashboards embed dataset
 * errors as text in 200 responses, so the wrapper alone could miss them).
 */

export const STORAGE_VERSION_MISMATCH = 'fmlab:storage-version-mismatch';

export interface StorageVersionDetails {
  solution: string | null;
  direction: 'newer' | 'older';
  file_storage_version: number;
  file_created_by: string | null;
  api_duckdb_version: string | null;
  readable_min: number;
  readable_max: number;
}

interface ErrorBody {
  code?: string;
  details?: unknown;
}

/** Details of a backend error object when it is a storage mismatch, else null. */
export function storageMismatchDetails(error: ErrorBody | null | undefined): StorageVersionDetails | null {
  if (!error || error.code !== 'STORAGE_VERSION_MISMATCH') return null;
  const d = error.details as Partial<StorageVersionDetails> | undefined;
  if (!d || typeof d.file_storage_version !== 'number') return null;
  return d as StorageVersionDetails;
}

/** Announce a diagnosed mismatch to the global notice. */
export function announceStorageMismatch(details: StorageVersionDetails): void {
  window.dispatchEvent(new CustomEvent(STORAGE_VERSION_MISMATCH, { detail: details }));
}
