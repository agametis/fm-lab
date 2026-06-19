import { createApiClient } from '@packages/shared';
import { API_BASE } from '../config/apiBase';

// API-Client Singleton
// Hinweis: Die API läuft unter /api Prefix
// Basis-URL zentral aufgelöst (User-Override aus .fmlab/settings.json >
// VITE_API_URL > Default) — siehe config/apiBase.ts.
export const api = createApiClient({
  baseUrl: `${API_BASE}/api`
});
