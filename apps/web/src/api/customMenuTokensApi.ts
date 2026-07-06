import { API_BASE } from '../config/apiBase';
// Custom Menu Tokens API — Fetch wrapper für /api/get-details?format=tokens&enrich=<lang>
// Liefert die pro-Berechnung tokenisierten Calc-Blöcke (Menü-eigene + pro-Item) inkl.
// Reference-DB-Anreicherung für Tokens vom Type `function`.

import type { CustomMenuTokens } from '../script/calcTokens';

const baseUrl = API_BASE;

export interface CustomMenuTokensResponse {
  success: boolean;
  data: CustomMenuTokens;
}

export async function fetchCustomMenuTokens(
  uuid: string,
  lang: string,
  file?: string | null,
): Promise<CustomMenuTokens> {
  const params = new URLSearchParams({ uuid, format: 'tokens', enrich: lang });
  if (file) params.set('file', file);
  const response = await fetch(`${baseUrl}/api/get-details?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message
        || `CustomMenu-Token-Request fehlgeschlagen: ${response.status}`,
    );
  }

  const json: CustomMenuTokensResponse = await response.json();
  return json.data;
}
