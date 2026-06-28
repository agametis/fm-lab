import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Build-Zeit-Version aus der eigenen package.json. Wird als globales
// __APP_VERSION__ ins Bundle injiziert, damit der Versions-Balken die
// *tatsächlich gebaute* Frontend-Version zeigt (wahrheitsgetreu zum laufenden
// Build, nicht nur die im Manifest gespiegelte Repo-Version). Ermöglicht später
// eine Drift-Anzeige „Bundle ≠ Manifest = Frontend nicht neu gebaut".
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
);

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // Bind-Adresse aus der Umgebung: Host-sicherer Default (false → localhost),
    // im Dev-Container injiziert devcontainer.json VITE_DEV_HOST=0.0.0.0, damit
    // der Dev-Server vom Host erreichbar ist (Port-Forwarding). Keine Umstellung
    // beim Wechsel Host <-> Container nötig.
    host: process.env.VITE_DEV_HOST || false,
    port: 5173,
    strictPort: true,
    // FS-Watcher entlasten (Docker-Desktop-Stabilität auf macOS, s. .vscode/
    // settings.json). Vite-Root ist apps/web, daher sieht der Dev-Server die
    // GB-Datenverzeichnisse im Repo-Root normalerweise gar nicht — diese Liste
    // ist defensiv (deckt dist/.vite + den Fall „Vite vom Repo-Root gestartet"):
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/.vite/**',
        '**/db/**',
        '**/output/**',
        '**/logs/**',
        '**/.fmlab/**',
        '**/xml/**',
        '**/docs/**',
        '**/_Backup/**',
        '**/*.duckdb',
      ],
    },
    // open nur lokal auf dem Host sinnvoll; im Container (kein Browser) leise aus.
    // VS Code öffnet das Frontend dort via Port-Forwarding/openBrowser.
    open: !process.env.VITE_DEV_HOST,
    // Same-origin-Proxy: Das Frontend ruft die API über den relativen Pfad
    // `/api` auf (VITE_API_URL leer). Der Dev-Server leitet diese Requests
    // serverseitig an die REST-API auf localhost:3003 weiter — unabhängig
    // davon, auf welchen Host-Port der Dev-Container 3003 weiterleitet
    // (z. B. 3004 bei Port-Kollision). Der Browser muss 3003 nie kennen.
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true
      }
    }
  }
});
