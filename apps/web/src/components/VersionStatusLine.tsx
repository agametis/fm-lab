import React from 'react';
import { useTranslation } from 'react-i18next';
import { useVersionManifest } from '../hooks/useVersionManifest';
import './VersionStatusLine.css';

/**
 * Versions-Status-Balken — rendert hinter dem „Zurück"-Button auf
 * /settings die fünf Kern-Versionen, getrennt durch ` · `:
 *
 *   FM-Lab v0.8.5 · API v0.8.5 · Frontend v0.8.5 · XML Konverter v4.4.2 · DB Schema v1.4.1
 *
 * Mapping:
 *   FM-Lab        = manifest.version (global)
 *   API           = components.rest_api.version
 *   Frontend      = __APP_VERSION__ (Build-Zeit-Injektion — die tatsächlich
 *                   gebaute Bundle-Version, wahrheitsgetreu zum laufenden Build)
 *   XML Konverter = components.xml_import.version
 *   DB Schema     = components.schema.version
 *
 * fm_reference, Plugins und Skills stehen bewusst NICHT im Balken (kompakte
 * Zeile; gehören in eine spätere Detail-/Update-Ansicht). Bei Fehler/Offline
 * (Manifest null) rendert die Komponente nichts.
 */
export const VersionStatusLine: React.FC = () => {
  const { t } = useTranslation(['detail']);
  const manifest = useVersionManifest();

  if (!manifest) return null;

  const segments: { label: string; version: string | null | undefined }[] = [
    { label: t('detail:settingsView.versions.fmlab'), version: manifest.version },
    { label: t('detail:settingsView.versions.api'), version: manifest.components?.rest_api?.version },
    { label: t('detail:settingsView.versions.frontend'), version: __APP_VERSION__ },
    { label: t('detail:settingsView.versions.xmlConverter'), version: manifest.components?.xml_import?.version },
    { label: t('detail:settingsView.versions.dbSchema'), version: manifest.components?.schema?.version },
  ];

  return (
    <span className="version-status-line">
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 && <span className="version-status-line__sep"> · </span>}
          <span className="version-status-line__item">
            {seg.label} v{seg.version ?? '?'}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
};
