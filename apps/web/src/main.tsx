import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { useFeatures, FeaturesContext } from './hooks/useFeatures';
import { applyServerLanguage } from './i18n'; // initialises i18next before any component renders
import { API_BASE } from './config/apiBase';
import './styles/theme.css';
import './index.css';

// Fire-and-forget: ask the REST API for the server-side default language. Uses
// the effective API base (browser-side override → .env → default) to reach the
// server. `applyServerLanguage` is a no-op when the user has already picked a
// language (localStorage["fmlab.lang"] is set), so existing selections win.
//
// The REST-API base URL itself is a per-browser client setting (localStorage,
// see config/apiBase.ts) — it is never read from or written to the server, so
// configuring it never affects other clients or backends.
fetch(`${API_BASE}/api/system/config`)
  .then((res) => (res.ok ? res.json() : null))
  .then((body) => {
    const def = body?.data?.languages?.default;
    if (typeof def === 'string') applyServerLanguage(def);
  })
  .catch(() => {
    // Server unreachable on initial load — fall back to local detection chain.
  });

function Root() {
  const featuresState = useFeatures();

  return (
    <FeaturesContext.Provider value={featuresState}>
      <App />
    </FeaturesContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>,
);
