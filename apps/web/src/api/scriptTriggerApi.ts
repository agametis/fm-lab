import { API_BASE } from '../config/apiBase';
// ScriptTrigger Detail API — Fetch wrapper für /api/get-details?format=tokens
// mit Object_Type='ScriptTrigger' (strukturierte ScriptTriggers-Projektion:
// Event, Modi, Script, Owner-Kette, Parameter, Feld-Kandidaten).

import type { ScriptTriggerDetailPayload } from '../script/calcTokens';

const baseUrl = API_BASE;

interface ScriptTriggerDetailResponse {
  success: boolean;
  data: ScriptTriggerDetailPayload;
}

export async function fetchScriptTriggerDetail(
  uuid: string,
  file?: string | null,
): Promise<ScriptTriggerDetailPayload> {
  // `file` (Klon-Disambiguierung): /api/get-details löst die UUID via
  // resolveByUUID auf → ohne file 409 AMBIGUOUS_UUID bei geteilten Klon-UUIDs.
  const params = new URLSearchParams({ uuid, format: 'tokens' });
  if (file) params.set('file', file);
  const response = await fetch(`${baseUrl}/api/get-details?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message || `ScriptTrigger-Detail-Request fehlgeschlagen: ${response.status}`,
    );
  }

  const json: ScriptTriggerDetailResponse = await response.json();
  return json.data;
}
