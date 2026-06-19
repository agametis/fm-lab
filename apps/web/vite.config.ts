import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind-Adresse aus der Umgebung: Host-sicherer Default (false → localhost),
    // im Dev-Container injiziert devcontainer.json VITE_DEV_HOST=0.0.0.0, damit
    // der Dev-Server vom Host erreichbar ist (Port-Forwarding). Keine Umstellung
    // beim Wechsel Host <-> Container nötig.
    host: process.env.VITE_DEV_HOST || false,
    port: 5173,
    strictPort: true,
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
