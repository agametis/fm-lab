import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../config/apiBase';
import {
  STORAGE_VERSION_MISMATCH,
  storageMismatchDetails,
  type StorageVersionDetails,
} from '../lib/storageVersion';
import './StorageVersionBanner.css';

/** Versionslinie Major.Minor, z. B. „v1.5.6" → „1.5"; null, wenn nicht lesbar. */
function duckdbLine(version: string | null): string | null {
  const m = /(\d+)\.(\d+)/.exec(version ?? '');
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * Globaler Hinweis, wenn die REST-API den Katalog der Lösung nicht öffnen kann,
 * weil er in einem Storage-Format einer anderen DuckDB-Version vorliegt
 * (CLI und gebündelte `@duckdb/node-api` laufen auf verschiedenen Versionen).
 *
 * Route-unabhängig wie der SolutionContextBanner: der Ausfall trifft jede
 * Ansicht gleichzeitig, und jede einzelne sähe nur einen rohen IO-Fehler.
 * Quellen: einmalige Prüfung von /api/version beim Start + Meldungen des
 * fetch-Wrappers aus jeder scheiternden Anfrage (lib/storageVersion.ts).
 */
export function StorageVersionBanner() {
  const { t } = useTranslation(['errors']);
  const [details, setDetails] = useState<StorageVersionDetails | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/version`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const found = storageMismatchDetails(body?.data?.database?.error);
        if (!cancelled && found) setDetails(found);
      })
      .catch(() => {
        /* API nicht erreichbar — das meldet der SolutionContextBanner bzw. die Ansicht */
      });

    const onMismatch = (event: Event) => {
      const detail = (event as CustomEvent<StorageVersionDetails>).detail;
      if (detail) setDetails(detail);
    };
    window.addEventListener(STORAGE_VERSION_MISMATCH, onMismatch);
    return () => {
      cancelled = true;
      window.removeEventListener(STORAGE_VERSION_MISMATCH, onMismatch);
    };
  }, []);

  if (!details || dismissed) return null;

  const range = details.readable_min === details.readable_max
    ? String(details.readable_min)
    : `${details.readable_min}–${details.readable_max}`;
  const unknown = t('errors:storageVersion.unknown');

  return (
    <div className="storage-version-banner" role="alert">
      <div className="storage-version-banner__text">
        <strong>{t('errors:storageVersion.heading')}</strong>
        <span>
          {t('errors:storageVersion.body', {
            solution: details.solution ?? unknown,
            createdBy: details.file_created_by ?? unknown,
            fileVersion: details.file_storage_version,
            apiVersion: details.api_duckdb_version ?? unknown,
            range,
          })}
        </span>
        <span>
          {details.direction === 'newer'
            ? t('errors:storageVersion.fixNewer', {
                apiLine: duckdbLine(details.api_duckdb_version) ?? unknown,
                cliLine: duckdbLine(details.file_created_by) ?? unknown,
              })
            : t('errors:storageVersion.fixOlder')}
        </span>
      </div>
      <button
        type="button"
        className="storage-version-banner__dismiss"
        onClick={() => setDismissed(true)}
        aria-label={t('errors:storageVersion.dismiss') as string}
        title={t('errors:storageVersion.dismiss') as string}
      >
        ×
      </button>
    </div>
  );
}
