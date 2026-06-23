import { API_BASE } from '../config/apiBase';
// Calc Tokens API — Fetch wrapper für /api/get-calc?hash=<hash>&format=tokens&enrich=<lang>
// Liefert die strukturierte Token-Sequenz einer beliebigen Calculation, adressiert
// über ihren DDR-Hash (Calcs haben keine Top-Level-UUID). Generischer Service:
// teilt sich Template + Formatter mit Field-/CustomFunction-Tokens.
//
// Konsument u.a.: PrivilegeSetViewer (Record-Access-Calc-Formeln).

import type { CalculationTokens } from '../script/calcTokens';

const baseUrl = API_BASE;

export interface CalcTokensResponse {
  success: boolean;
  data: CalculationTokens;
}

export async function fetchCalcTokens(
  hash: string,
  lang: string,
): Promise<CalculationTokens> {
  const params = new URLSearchParams({ hash, format: 'tokens', enrich: lang });
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
