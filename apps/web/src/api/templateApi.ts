import { API_BASE } from '../config/apiBase';
// Template API - Direct fetch for /api/query endpoint
// The typed OpenAPI client doesn't support arbitrary template parameters,
// so we use a simple fetch wrapper here.

const baseUrl = API_BASE;

export interface TemplateQueryResponse {
  success: boolean;
  data: Array<Record<string, unknown>>;
  meta?: {
    execution_time_ms?: number;
    result_count?: number;
    template_type?: string;
    [key: string]: unknown;
  };
}

/**
 * Execute a template query with arbitrary parameters.
 * Uses GET /api/query with query string parameters.
 */
export async function fetchTemplateQuery(
  template: string,
  params: Record<string, string>,
  format: string = 'json'
): Promise<TemplateQueryResponse> {
  const searchParams = new URLSearchParams({
    template,
    format,
    ...params,
  });

  const response = await fetch(`${baseUrl}/api/query?${searchParams}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      errorData?.error?.message || `Template query failed: ${response.status}`
    );
  }

  return response.json();
}
