import { API_BASE } from '../config/apiBase';
// Details API - Fetch wrapper for /api/get-details endpoint
// Uses the REST API template dispatcher to get type-specific object details.

const baseUrl = API_BASE;

export interface ObjectDetailsMeta {
  execution_time_ms?: number;
  result_count?: number;
  template_type?: string;
  object_type?: string;
  object_name?: string;
  file_name?: string;
  template_used?: string;
  has_dedicated_template?: boolean;
  [key: string]: unknown;
}

export interface ObjectDetailsResponse {
  success: boolean;
  data: Array<Record<string, unknown>>;
  meta?: ObjectDetailsMeta;
}

/**
 * Fetch type-specific object details via /api/get-details.
 * The API automatically dispatches to the correct SQL template based on Object_Type.
 */
export async function fetchObjectDetails(uuid: string): Promise<ObjectDetailsResponse> {
  const searchParams = new URLSearchParams({
    uuid,
    format: 'json',
    meta: 'true',
  });

  const response = await fetch(`${baseUrl}/api/get-details?${searchParams}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message || `Details request failed: ${response.status}`
    );
  }

  return response.json();
}
