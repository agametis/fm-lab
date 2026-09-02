import { API_BASE } from '../config/apiBase';
// Calc Tokens API — Fetch wrapper für /api/get-calc?format=tokens&enrich=<lang>
// Liefert die strukturierte Token-Sequenz einer beliebigen Calculation.
// Adressierung (Schema 1.22.0): primär instanz-exakt über die Calculation_UUID
// (`by: 'uuid'`), Alias über den DDR-Hash (`by: 'hash'` — Default, Hash ist
// NICHT eindeutig, Dedup-Pick). Generischer Service: teilt sich Template +
// Formatter mit Field-/CustomFunction-Tokens.
//
// Konsumenten u.a.: PrivilegeSetViewer (hash), FieldViewer-Validierungs-Slots
// und LayoutObjectDetail-Calc-Slots (uuid).

import type { CalculationTokens } from '../script/calcTokens';

const baseUrl = API_BASE;

export interface CalcTokensResponse {
  success: boolean;
  data: CalculationTokens;
}

export type CalcTokenKeyKind = 'hash' | 'uuid';

export async function fetchCalcTokens(
  key: string,
  lang: string,
  by: CalcTokenKeyKind = 'hash',
): Promise<CalculationTokens> {
  const params = new URLSearchParams({ format: 'tokens', enrich: lang });
  params.set(by, key);
  const response = await fetch(`${baseUrl}/api/get-calc?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message
        || `Calc-Token-Request fehlgeschlagen: ${response.status}`,
    );
  }

  const json: CalcTokensResponse = await response.json();
  return json.data;
}
