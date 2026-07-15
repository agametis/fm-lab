import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchSolutions, type SolutionInfo } from '../api/solutionsApi';
import { getSelectedSolution, setSelectedSolution } from '../lib/solutionStore';
import './SolutionPicker.css';

/**
 * Header-level solution picker. Hidden entirely when only ONE solution exists
 * — single-solution users see no new UI.
 *
 * Stage M (multiuser): switching changes ONLY this browser's per-tab context
 * (localStorage/URL param → X-Solution header) — never the server default.
 * Other users at the same API are unaffected. Setting the SERVER default is a
 * deliberate admin action in Settings → Solutions. The page reload is the
 * clean-slate cache invalidation: every view refetches against the selection.
 */
export function SolutionPicker() {
  const { t } = useTranslation('common');
  const [solutions, setSolutions] = useState<SolutionInfo[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSolutions()
      .then((list) => { if (!cancelled) setSolutions(list); })
      .catch(() => { /* API offline / pre-migration server — picker stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  if (solutions.length <= 1) return null;

  const serverDefault = solutions.find((s) => s.is_active);
  const current = getSelectedSolution() ?? serverDefault?.id ?? '';

  const onChange = (id: string) => {
    if (!id || id === current || switching) return;
    setSwitching(true);
    // Nur der Tab-Kontext wechselt (kein Server-Aufruf): Auswahl persistieren,
    // dann voller Reload = frischer App-State gegen die gewählte Lösung
    // (Query-Caches, Tree-State, Dashboards).
    setSelectedSolution(id);
    // Lösungs-Deep-Link-Parameter beim Wechsel entfernen: ein stehen
    // gebliebener `solution_id` (XML-Import-Seite) oder `solution`
    // (Tab-Kontext) würde beim Reload die frische Auswahl wieder überstimmen,
    // sodass die Seite weiter die alte Lösung zeigt. Ohne solche Parameter
    // ist das identisch zu einem einfachen Reload derselben URL.
    const url = new URL(window.location.href);
    url.searchParams.delete('solution_id');
    url.searchParams.delete('solution');
    window.location.replace(url.toString());
  };

  return (
    <label className="solution-picker" aria-label={t('solutionPicker.ariaLabel') as string}>
      <span className="visually-hidden">{t('solutionPicker.label')}</span>
      <select
        className="solution-picker__select"
        value={current}
        disabled={switching}
        onChange={(e) => onChange(e.target.value)}
        title={t('solutionPicker.label') as string}
      >
        {solutions.map((s) => (
          <option key={s.id} value={s.id}>
            {/* „•" markiert den Server-Default (sprachneutral; Details in Settings) */}
            {(s.display_name || s.id) + (s.is_active ? ' •' : '')}
          </option>
        ))}
      </select>
    </label>
  );
}
