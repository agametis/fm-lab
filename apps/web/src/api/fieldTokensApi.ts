import { API_BASE } from '../config/apiBase';
// Field Tokens API — Fetch wrapper für /api/get-details?format=tokens&enrich=<lang>
// Liefert die strukturierte Token-Sequenz der Calculation-Formel eines Feldes
// (Calculated Fields und AutoEnter-Calculated Fields) inkl. Reference-DB-
// Anreicherung für Tokens vom Type `function`.

import type { FieldTokens } from '../script/calcTokens';

const baseUrl = API_BASE;

export interface FieldTokensResponse {
  success: boolean;
  data: FieldTokens;
}

export async function fetchFieldTokens(
  uuid: string,
  lang: string,
  file?: string | null,
): Promise<FieldTokens> {
  // `file` (Klon-Disambiguierung): get-details löst via resolveByUUID → ohne file
  // 409 AMBIGUOUS_UUID bei geteilten Klon-UUIDs.
  const params = new URLSearchParams({ uuid, format: 'tokens', enrich: lang });
  if (file) params.set('file', file);
  const response = await fetch(`${baseUrl}/api/get-details?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message
        || `Field-Token-Request fehlgeschlagen: ${response.status}`,
    );
  }

  const json: FieldTokensResponse = await response.json();
  return json.data;
}
