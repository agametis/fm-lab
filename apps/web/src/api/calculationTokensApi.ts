import { API_BASE } from '../config/apiBase';
// Calculation Tokens API — Fetch wrapper für /api/get-details?format=tokens&enrich=<lang>
// für Calculation-INSTANZEN (Object_Type='Calculation', Schema 1.22.0).
// Liefert die Token-Sequenz der Formel plus Instanz-Metadaten (`calc`: Owner,
// Rolle, Index, Slot, DDR-Verankerung) und die abgeleiteten Ziel-Links
// (`targets`, v_calculation_links). DDR-lose Instanzen kommen ohne Tokens mit
// plainText-Fallback zurück — der Fallback wird server-seitig am
// Katalog-Datensatz entschieden, nie über den Fehlerpfad.

import type { CalculationTokens } from '../script/calcTokens';

const baseUrl = API_BASE;

export interface CalculationTokensResponse {
  success: boolean;
  data: CalculationTokens;
}

export async function fetchCalculationTokens(
  uuid: string,
  lang: string,
  file?: string | null,
): Promise<CalculationTokens> {
  // `file` (Klon-Disambiguierung): get-details löst via resolveByUUID → ohne file
  // 409 AMBIGUOUS_UUID bei geteilten Klon-UUIDs.
  const params = new URLSearchParams({ uuid, format: 'tokens', enrich: lang });
  if (file) params.set('file', file);
  const response = await fetch(`${baseUrl}/api/get-details?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message
        || `Calculation-Token-Request fehlgeschlagen: ${response.status}`,
    );
  }

  const json: CalculationTokensResponse = await response.json();
  return json.data;
}
