import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchSolutions, activateSolution, type SolutionInfo } from '../api/solutionsApi';
import { setSelectedSolution } from '../lib/solutionStore';
import './SolutionPicker.css';

/**
 * Header-level solution picker (multi-solution phase 1). Hidden entirely when
 * only ONE solution exists — single-solution users see no new UI. Switching
 * calls POST /api/admin/solution/activate (global server default) and then
 * reloads the page: the same clean-slate path as after an import reload —
 * every view refetches against the newly active solution.
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

  const active = solutions.find((s) => s.is_active);

  const onChange = async (id: string) => {
    if (!id || id === active?.id || switching) return;
    setSwitching(true);
    try {
      await activateSolution(id);
      setSelectedSolution(id);
      // Zentrale Cache-Invalidierung: voller Reload = frischer App-State
      // gegen die neue Lösung (Query-Caches, Tree-State, Dashboards).
      window.location.reload();
    } catch (err) {
      setSwitching(false);
      console.error('Solution switch failed:', err);
      alert(t('solutionPicker.switchError', {
        defaultValue: 'Switching the solution failed: {{message}}',
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  return (
    <label className="solution-picker" aria-label={t('solutionPicker.ariaLabel') as string}>
      <span className="visually-hidden">{t('solutionPicker.label')}</span>
      <select
        className="solution-picker__select"
        value={active?.id ?? ''}
        disabled={switching}
        onChange={(e) => onChange(e.target.value)}
        title={t('solutionPicker.label') as string}
      >
        {solutions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.display_name || s.id}
          </option>
        ))}
      </select>
    </label>
  );
}
