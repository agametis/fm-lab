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

// Multiuser-Vorbereitung: die Client-Auswahl wandert als X-Solution-
// Header mit jedem Request — Phase 1 ignoriert der Server den Header schlicht
// (Kontext = Server-Default), Ausbaustufe M macht daraus die Per-Tab-Auswahl.
api.client.use({
  onRequest({ request }) {
    const selected = getSelectedSolution();
    if (selected) request.headers.set('X-Solution', selected);
    return request;
  },
});
