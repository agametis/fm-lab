import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SOLUTION_REQUEST_BLOCKED, resetSolutionSelection } from '../lib/solutionFetch';
import './SolutionContextBanner.css';

/**
 * Globaler Hinweis, wenn API-Requests mit einer explizit gewählten Lösung auf
 * Transportebene scheitern (Fetch wirft, es gibt keine Antwort).
 *
 * Warum eigenständig und nicht in den Views: Der Ausfall trifft ALLE Panels
 * gleichzeitig, und jedes einzelne kann nur „Laden fehlgeschlagen" sagen —
 * niemand von ihnen weiß, dass eine Lösungs-Auswahl im Spiel ist. Der
 * fetch-Wrapper weiß beides, deshalb meldet er es einmal zentral hierher.
 *
 * Die automatische Rücksetzung greift hier prinzipiell nicht: Sie hängt an
 * einer 404-Antwort des Servers, und genau die gibt es bei einem
 * Transportfehler nicht. Deshalb der manuelle Ausweg per Knopf — sonst bleibt
 * die Auswahl in Storage stehen und der Zustand überlebt jeden Reload.
 */
export function SolutionContextBanner() {
  const { t } = useTranslation(['errors']);
  const [solution, setSolution] = useState<string | null>(null);

  useEffect(() => {
    const onBlocked = (event: Event) => {
      const detail = (event as CustomEvent<{ solution?: string }>).detail;
      if (detail?.solution) setSolution(detail.solution);
    };
    window.addEventListener(SOLUTION_REQUEST_BLOCKED, onBlocked);
    return () => window.removeEventListener(SOLUTION_REQUEST_BLOCKED, onBlocked);
  }, []);

  if (!solution) return null;

  return (
    <div className="solution-context-banner" role="status">
      <div className="solution-context-banner__text">
        <strong>{t('errors:solutionContext.heading', { solution })}</strong>
        <span>{t('errors:solutionContext.body')}</span>
      </div>
      <button
        type="button"
        className="solution-context-banner__action"
        onClick={resetSolutionSelection}
      >
        {t('errors:solutionContext.action')}
      </button>
      <button
        type="button"
        className="solution-context-banner__dismiss"
        onClick={() => setSolution(null)}
        aria-label={t('errors:solutionContext.dismiss') as string}
        title={t('errors:solutionContext.dismiss') as string}
      >
        ×
      </button>
    </div>
  );
}
