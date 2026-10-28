import { API_BASE } from '../config/apiBase';

/**
 * Authors of the change metadata and their curated aliases
 * (GET/PUT/DELETE /api/change-authors). The solution comes from the tab's
 * selection (X-Solution header, see lib/solutionFetch).
 */

export interface ChangeAuthor {
  Author_Key: string;
  Person_Key: string;
  Display_Name: string | null;
  Is_Technical: boolean;
  Author_Kind: string | null;
  Is_Curated: boolean;
  Raw_Names: string[];
  Accounts: string[];
  Stamps: number;
  Single_Stamps: number;
  Files: number;
  First_At: string | null;
  Last_At: string | null;
}

export interface ChangeAuthorAlias {
  Raw_Value: string;
  Kind: string;
  Author_Key: string | null;
  Display_Name: string | null;
  Is_Technical: boolean | null;
  Updated_At: string | null;
}

export interface ChangeAuthorsResponse {
  authors: ChangeAuthor[];
  aliases: ChangeAuthorAlias[];
  sidecar_available: boolean;
}

export interface ChangeAuthorAliasInput {
  raw_value: string;
  author_key?: string | null;
  display_name?: string | null;
  is_technical?: boolean | null;
}

async function parse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error?.message || `Request failed: ${res.status}`);
  }
  return json.data as T;
}

export async function fetchChangeAuthors(): Promise<ChangeAuthorsResponse> {
  return parse<ChangeAuthorsResponse>(await fetch(`${API_BASE}/api/change-authors`));
}

export async function saveChangeAuthorAlias(input: ChangeAuthorAliasInput): Promise<void> {
  await parse(await fetch(`${API_BASE}/api/change-authors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'user', ...input }),
  }));
}

export async function deleteChangeAuthorAlias(rawValue: string): Promise<void> {
  const qs = new URLSearchParams({ raw_value: rawValue, kind: 'user' });
  await parse(await fetch(`${API_BASE}/api/change-authors?${qs}`, { method: 'DELETE' }));
}
