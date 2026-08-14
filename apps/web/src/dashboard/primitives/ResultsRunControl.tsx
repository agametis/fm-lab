import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { runResults, type ResultsRunTarget } from '../../api/resultsApi';

/**
 * Inline trigger button for the results layer (R5 UI anchor on consolidated
 * dashboards like Healthchecks). Props:
 *   - root:  folder path to run ('' / absent = every top-level dashboard folder)
 *   - roots: comma-separated list of folder paths — one run covering several
 *            subtrees (e.g. static-code-analysis + metadata-integrity); wins
 *            over `root` when both are set
 *   - mode:  'missing' (default, idempotent) | 'refresh'
 *   - label: optional custom label (else localized "Run all")
 * After a completed run the surrounding dashboard reloads its datasets
 * (fmlab:reload-dashboard) so results_* builtins re-read the warmed cache.
 */
export function ResultsRunControl({ node }: PrimitiveProps) {
  const { t } = useTranslation(['dashboard']);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const root = (node.props?.root as string) || '';
  const roots = String((node.props?.roots as string) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const paths = roots.length ? roots : [root];
  const mode = (node.props?.mode as 'missing' | 'refresh') || 'missing';
  const label = (node.props?.label as string)
    || (t('dashboard:folderNav.runAll', { defaultValue: 'Alle ausführen' }) as string);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(null);
    try {
      const targets: ResultsRunTarget[] = paths.map(path => ({ kind: 'folder', path }));
      const res = await runResults(targets, mode);
      setProgress(`${res.meta.executed}/${res.meta.requested}`);
      window.dispatchEvent(new Event('fmlab:reload-dashboard'));
    } catch {
      setProgress('⚠');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="dash-results-run">
      <button type="button" className="dash-folderbar__runall" onClick={run} disabled={busy}>
        {busy
          ? (t('dashboard:folderNav.running', { defaultValue: 'läuft…' }) as string)
          : label}
      </button>
      {progress && <span className="dash-results-run__meta">{progress}</span>}
    </span>
  );
}
