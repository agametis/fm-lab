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
 *
 * `destFile`/`originFile` (Klon-Disambiguierung): optionale File_Names, die die
 * jeweilige UUID-Seite eindeutig auflösen (geteilte Klon-UUIDs). Der Destination-
 * File ist der wichtige Fall (das aktuell geöffnete Objekt kennt seine Datei);
 * der Origin ist oft nur ein Name/UUID ohne Datei → Graceful Downgrade.
 */
export async function fetchBackReferences(
  destination: string,
  origin: string,
  mode: 'uuid' | 'name' | 'auto' = 'auto',
  destFile?: string | null,
  originFile?: string | null,
): Promise<BackReferencesResponse> {
  const params = new URLSearchParams({ destination, origin, mode });
  if (destFile) params.set('dest_file', destFile);
  if (originFile) params.set('origin_file', originFile);
  const r = await fetch(`${baseUrl}/api/back-references?${params}`);
  if (!r.ok) {
    const err = await r.json().catch(() => null);
    throw new Error(err?.error?.message || `Back-references request failed: ${r.status}`);
  }
  const body = await r.json();
  return body.data as BackReferencesResponse;
}
