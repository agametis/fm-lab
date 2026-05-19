// Script Tokens API — Fetch wrapper für /api/get-details?format=tokens
// Liefert für ein Script-UUID das strukturierte Token-Payload (siehe
// rest-api/src/formatters/tokens.formatter.js).

import type { ScriptTokens } from '../script/types';

const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3003';

export interface ScriptTokensResponse {
  success: boolean;
  data: ScriptTokens;
}

export async function fetchScriptTokens(
  uuid: string,
  lang: string,
): Promise<ScriptTokens> {
  // ?enrich=<lang> liefert pro Script-Step die Reference-Daten
  // (stepDisplayName, stepDescription, stepHelpUrl etc.) und reichert
  // function-Refs in Calcs an (PRD §5.1 + §5.2).
  const params = new URLSearchParams({ uuid, format: 'tokens', enrich: lang });
  const response = await fetch(`${baseUrl}/api/get-details?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message || `Script-Token-Request fehlgeschlagen: ${response.status}`,
    );
  }

  const json: ScriptTokensResponse = await response.json();
  return json.data;
}
