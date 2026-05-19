// Field Tokens API — Fetch wrapper für /api/get-details?format=tokens&enrich=<lang>
// Liefert die strukturierte Token-Sequenz der Calculation-Formel eines Feldes
// (Calculated Fields und AutoEnter-Calculated Fields) inkl. Reference-DB-
// Anreicherung für Tokens vom Type `function`.

import type { FieldTokens } from '../script/calcTokens';

const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3003';

export interface FieldTokensResponse {
  success: boolean;
  data: FieldTokens;
}

export async function fetchFieldTokens(
  uuid: string,
  lang: string,
): Promise<FieldTokens> {
  const params = new URLSearchParams({ uuid, format: 'tokens', enrich: lang });
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
