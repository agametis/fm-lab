import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useVersionManifest } from '../hooks/useVersionManifest';
import './VersionStatusLine.css';

type DuckdbRuntime = {
  api: string | null;
  cli: { path?: string; version?: string | null } | null;
};

/** „v2.0.0" → „2.0.0" — die Zeile setzt das „v" selbst davor. */
const bare = (v: string | null | undefined) => (v ? v.replace(/^v/, '') : v);

/**
 * Versions-Status-Balken — rendert hinter dem „Zurück"-Button auf
 * /settings die sechs Kern-Versionen, getrennt durch ` · `:
 *
 *   FM-Lab v0.8.9 · API v0.8.9 · Frontend v0.8.9 · XML Konverter v5.1.0 · Engine v2.22.0 · DB Schema v1.7.0 · fm-spec v1.2.0
 *
 * Mapping:
 *   FM-Lab        = manifest.version (global)
 *   API           = components.rest_api.version
 *   Frontend      = __APP_VERSION__ (Build-Zeit-Injektion — die tatsächlich
 *                   gebaute Bundle-Version, wahrheitsgetreu zum laufenden Build)
 *   XML Konverter = components.xml_import.version
 *   Engine        = components.xml_import.engine_version (interne Konverter-
 *                   Kennung, die Changelog und Import-Log zitieren; Segment
 *                   entfällt bei Manifesten ohne das Feld)
 *   DB Schema     = components.schema.version
 *   fm-spec       = components.fm_spec.version
 *   DuckDB        = /api/version → duckdb_version (die gebündelte DuckDB der
 *                   REST-API, die die Kataloge liest)
 *   DuckDB CLI    = /api/version → duckdb_cli (die CLI des XML-Imports, die sie
 *                   schreibt; Pfad als Tooltip, „nicht gefunden" ohne CLI)
 *
 * Die beiden DuckDB-Segmente sind Laufzeitwerte, kein Manifest-Inhalt: Sie
 * können auseinanderlaufen (z. B. ein Container-Image, das älter ist als die
 * per npm aktualisierte Bindung) und dienen der Fehlersuche. Sie erscheinen,
 * sobald /api/version geantwortet hat; ohne Antwort entfallen sie.
 *
 * Alle Segmente werden als reiner Versionsstring gezeigt (kein Link). Der
 * Einstieg in den fm-spec Schema-Viewer erfolgt über das eigene fm-spec-Panel
 * auf der Einstellungen-Seite. Plugins und Skills stehen bewusst NICHT im
 * Balken. Bei Fehler/Offline (Manifest null) rendert die Komponente nichts.
 */
export const VersionStatusLine: React.FC = () => {
  const { t } = useTranslation(['detail']);
  const manifest = useVersionManifest();
  const [duckdb, setDuckdb] = useState<DuckdbRuntime | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.version()
      .then((res) => {
        const data = res?.data;
        // Eine API ohne die Laufzeitfelder (älterer Server) meldet keine CLI — nicht
        // als „nicht gefunden" anzeigen, sondern die Segmente weglassen.
        if (cancelled || !data || !('duckdb_cli' in data)) return;
        setDuckdb({ api: data.duckdb_version ?? null, cli: data.duckdb_cli ?? null });
      })
      .catch(() => { /* offline: DuckDB-Segmente entfallen */ });
    return () => { cancelled = true; };
  }, []);

  if (!manifest) return null;

  const segments: { label: string; version?: string | null; text?: string; title?: string }[] = [
    { label: t('detail:settingsView.versions.fmlab'), version: manifest.version },
    { label: t('detail:settingsView.versions.api'), version: manifest.components?.rest_api?.version },
    { label: t('detail:settingsView.versions.frontend'), version: __APP_VERSION__ },
    { label: t('detail:settingsView.versions.xmlConverter'), version: manifest.components?.xml_import?.version },
    ...(manifest.components?.xml_import?.engine_version
      ? [{ label: t('detail:settingsView.versions.xmlEngine'), version: manifest.components.xml_import.engine_version }]
      : []),
    { label: t('detail:settingsView.versions.dbSchema'), version: manifest.components?.schema?.version },
    { label: t('detail:settingsView.versions.fmSpec'), version: manifest.components?.fm_spec?.version },
    ...(duckdb
      ? [
          { label: t('detail:settingsView.versions.duckdb'), version: bare(duckdb.api) },
          duckdb.cli
            ? { label: t('detail:settingsView.versions.duckdbCli'), version: bare(duckdb.cli.version), title: duckdb.cli.path }
            : { label: t('detail:settingsView.versions.duckdbCli'), text: t('detail:settingsView.versions.duckdbCliMissing') },
        ]
      : []),
  ];

  return (
    <span className="version-status-line">
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 && <span className="version-status-line__sep"> · </span>}
          <span className="version-status-line__item" title={seg.title}>
            {seg.label} {seg.text ?? `v${seg.version ?? '?'}`}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
};
