import { API_BASE } from '../config/apiBase';

/**
 * Schreib-/Lese-Client für User-Annotationen (Noise-Filter & semantische
 * Anreicherung). Spiegelt die REST-Endpoints /api/annotations/*. Die Edits landen
 * in der schreibbaren Sidecar-DB; das Backend leert nach jedem Write seinen
 * Graph-Cache, sodass ein anschließendes Refetch das Ergebnis sofort zeigt.
 */

const base = `${API_BASE}/api/annotations`;

type Envelope<T> = { success: boolean; data: T; error?: { message: string } };

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: Envelope<T> = await r.json();
  if (!r.ok || !json.success) throw new Error(json.error?.message || `HTTP ${r.status}`);
  return json.data;
}

/** Node als sichtbar/ausgeblendet markieren (Noise-Filter). */
export function setNodeVisibility(uuid: string, file: string | null, visible: boolean) {
  return put('/node/visibility', { uuid, file: file ?? '', visible });
}

/** Community-Name/Notiz setzen (leere Strings = Feld löschen). */
export function setCommunityAnnotation(
  engine: string,
  community: number,
  userName: string,
  userNotes: string,
) {
  return put('/community', { engine, community, user_name: userName, user_notes: userNotes });
}

export type HiddenNode = { uuid: string; file: string | null; label: string; type: string | null };

/** Recovery-Liste der ausgeblendeten Knoten (für den `hide`-Modus). */
export async function fetchHidden(): Promise<HiddenNode[]> {
  const r = await fetch(`${base}/hidden`);
  const json: Envelope<{ count: number; hidden: HiddenNode[] }> = await r.json();
  if (!r.ok || !json.success) throw new Error(json.error?.message || `HTTP ${r.status}`);
  return json.data.hidden;
}
