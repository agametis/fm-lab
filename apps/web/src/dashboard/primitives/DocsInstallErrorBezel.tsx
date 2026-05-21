import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import type { DocsInstallErrorDetail } from './DocsetInstallControl';

/**
 * DocsInstallErrorBezel
 *
 * Hört auf `fmlab:docs-install-error`-Events und zeigt die letzten Fehler
 * persistent als Bezel unterhalb der zugehörigen Card. Jeder Fehler hat
 * einen Close-Button (X), der ihn aus der Liste entfernt. Bleibt leer bis
 * der erste Fehler eintrifft (gibt dann nichts ins DOM).
 */
export function DocsInstallErrorBezel(_props: PrimitiveProps) {
  const { t } = useTranslation('dashboard');
  const [errors, setErrors] = useState<DocsInstallErrorDetail[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DocsInstallErrorDetail>).detail;
      if (!detail) return;
      setErrors(prev => {
        // Replace any existing error for the same id so we don't pile up
        // duplicates from a retry on the same docset.
        const filtered = prev.filter(x => x.id !== detail.id);
        return [...filtered, detail];
      });
    };
    window.addEventListener('fmlab:docs-install-error', handler as EventListener);
    return () => window.removeEventListener('fmlab:docs-install-error', handler as EventListener);
  }, []);

  if (errors.length === 0) return null;

  const closeLabel = t('install.errorClose', { defaultValue: 'Meldung schließen' }) as string;

  return (
    <div className="docs-install-bezel" role="alert">
      {errors.map(err => (
        <div key={`${err.id}-${err.ts}`} className="docs-install-bezel__item">
          <div className="docs-install-bezel__body">
            <span className="docs-install-bezel__title">{err.name}</span>
            <span className="docs-install-bezel__message">{err.message}</span>
          </div>
          <button
            type="button"
            className="docs-install-bezel__close"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={() => setErrors(prev => prev.filter(x => x.ts !== err.ts))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
