import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { useFeatures, FeaturesContext } from './hooks/useFeatures';
import { applyServerLanguage } from './i18n'; // initialises i18next before any component renders
import './styles/theme.css';
import './index.css';

// Fire-and-forget: ask the REST API for the server-side default language.
// `applyServerLanguage` is a no-op when the user has already picked one
// (localStorage["fmlab.lang"] is set), so existing selections always win.
const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3003';
fetch(`${apiBaseUrl}/api/system/config`)
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
