import { createApiClient } from '@packages/shared';
import { API_BASE } from '../config/apiBase';
import { getSelectedSolution } from '../lib/solutionStore';

// API-Client Singleton
// Hinweis: Die API läuft unter /api Prefix
// Basis-URL zentral aufgelöst (User-Override aus .fmlab/settings.json >
// VITE_API_URL > Default) — siehe config/apiBase.ts.
export const api = createApiClient({
  baseUrl: `${API_BASE}/api`
});

// Ausbaustufe M: die Tab-Auswahl wandert als X-Solution-Header mit jedem
// Request — der Server routet damit pro Request auf die gewählte Lösung.
// Eigene Middleware statt nur des globalen Wrappers (lib/solutionFetch.ts):
// openapi-fetch kann die fetch-Referenz beim createClient binden, BEVOR der
// Wrapper installiert ist — hier ist der Header garantiert.
api.client.use({
  onRequest({ request }) {
    const selected = getSelectedSolution();
    if (selected) request.headers.set('X-Solution', selected);
    return request;
  },
  // Stale-Auswahl-Recovery auch für Client-Antworten (gleiche Logik wie im
  // globalen Wrapper — greift, falls dessen fetch-Instrumentierung den
  // Client nicht abdeckt).
  async onResponse({ response }) {
    if (response.status === 404) {
      const selected = getSelectedSolution();
      if (selected) {
        try {
          const body = await response.clone().json();
          if (
            body?.error?.code === 'SOLUTION_NOT_FOUND'
            && typeof body.error.message === 'string'
            && body.error.message.includes(selected)
          ) {
            const { handleStaleSolutionSelection } = await import('../lib/solutionFetch');
            handleStaleSolutionSelection(selected);
          }
        } catch { /* non-JSON 404 — nicht unsere */ }
      }
    }
    return response;
  },
});
