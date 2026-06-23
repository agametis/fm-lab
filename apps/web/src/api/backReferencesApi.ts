import { API_BASE } from '../config/apiBase';
// Back-References API - Fetch wrapper for /api/back-references endpoint
// Cross-Reference Highlight Lookup

const baseUrl = API_BASE;

export type BackRefMatchStrategy = 'uuid' | 'name' | 'name-fallback' | 'unresolved';

export interface BackRefMatch {
  uuid: string;
  type: string;
  role: string;
  name: string;
}

export interface BackRefResolved {
  uuid: string;
  type: string;
  name: string;
  file?: string;
}

export interface BackReferencesResponse {
  destination: BackRefResolved;
  origin: BackRefResolved | null;
  matches: BackRefMatch[];
  match_strategy: BackRefMatchStrategy;
}

/**
 * Holt für ein (destination, origin)-Paar alle UUIDs im Destination-Container,
 * die das Origin referenzieren. Wird vom RefOrigin-Hook im Frontend genutzt,
 * um Highlight-State (matchUuids, highlightRefUuids) vorzubelegen.
 */
export async function fetchBackReferences(
  destination: string,
  origin: string,
  mode: 'uuid' | 'name' | 'auto' = 'auto',
): Promise<BackReferencesResponse> {
  const params = new URLSearchParams({ destination, origin, mode });
  const r = await fetch(`${baseUrl}/api/back-references?${params}`);
  if (!r.ok) {
    const err = await r.json().catch(() => null);
    throw new Error(err?.error?.message || `Back-references request failed: ${r.status}`);
  }
  const body = await r.json();
  return body.data as BackReferencesResponse;
}
