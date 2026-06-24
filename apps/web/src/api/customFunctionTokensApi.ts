import { API_BASE } from '../config/apiBase';
// CustomFunction Tokens API — Fetch wrapper für /api/get-details?format=tokens&enrich=<lang>
// Liefert die strukturierte Token-Sequenz inkl. Reference-DB-Anreicherung
// für Tokens vom Type `function`.

import type { CustomFunctionTokens } from '../script/calcTokens';

const baseUrl = API_BASE;

export interface CustomFunctionTokensResponse {
  success: boolean;
  data: CustomFunctionTokens;
}

export async function fetchCustomFunctionTokens(
  uuid: string,
  lang: string,
  file?: string | null,
): Promise<CustomFunctionTokens> {
  // `file` (Klon-Disambiguierung): get-details löst via resolveByUUID → ohne file
  // 409 AMBIGUOUS_UUID bei geteilten Klon-UUIDs.
  const params = new URLSearchParams({ uuid, format: 'tokens', enrich: lang });
  if (file) params.set('file', file);
  const response = await fetch(`${baseUrl}/api/get-details?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message
        || `CustomFunction-Token-Request fehlgeschlagen: ${response.status}`,
    );
  }

  const json: CustomFunctionTokensResponse = await response.json();
  return json.data;
}
