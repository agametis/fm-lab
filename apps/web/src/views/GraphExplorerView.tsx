import { useCallback, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '../components/ThemeToggle';
import {
  GraphExplorer,
  type GraphExplorerHandle,
  type GraphExplorerStats,
} from '../components/GraphExplorer';
import type { SubgraphDirection } from '../hooks/useSubgraph';
import { useEscapeStack } from '../hooks/useEscapeStack';
import './GraphExplorerView.css';

/**
 * Graph Explorer — standalone route `/graph`. Thin host around the reusable
 * {@link GraphExplorer} engine: it owns the deep-link params
 * (`?focus=&depth=&dir=`) and renders the full-screen header (back, title,
 * live stats, fit/relayout/export, theme toggle). Focus is set via the
 * DetailView graph tab, a deep-link or a double-tap (no global search).
 */

function clampDepth(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(4, Math.max(1, Math.round(n)));
}

function parseDirection(raw: string | null): SubgraphDirection {
  return raw === 'out' || raw === 'in' || raw === 'both' ? raw : 'both';
}

export function GraphExplorerView() {
  const { t } = useTranslation(['explorer', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const engineRef = useRef<GraphExplorerHandle>(null);
  const [stats, setStats] = useState<GraphExplorerStats | null>(null);

  const focus = searchParams.get('focus');
  const depth = clampDepth(searchParams.get('depth'));
  const direction = parseDirection(searchParams.get('dir'));

  // Patch a subset of the deep-link params, preserving the rest.
  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleSetFocus = useCallback((uuid: string) => patchParams({ focus: uuid }), [patchParams]);
  const handleOpenDetails = useCallback((uuid: string) => navigate(`/object/${uuid}`), [navigate]);

  const handleExportPng = useCallback(() => {
    const dataUrl = engineRef.current?.exportPng();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `graph-${(stats?.focusLabel ?? 'export').replace(/[^\w.-]+/g, '_')}.png`;
    a.click();
  }, [stats]);

  const handleBack = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  }, [location.key, navigate]);

  useEscapeStack([
    // Stage: ein aktiver Namensfilter wird zuerst geleert.
    () => engineRef.current?.clearTransientFilters() ?? false,
    // Fallback: Zurück-Navigation.
    () => {
      handleBack();
      return true;
    },
  ]);

  return (
    <div className="graph-explorer-view">
      <header className="graph-explorer-header">
        <button
          type="button"
          onClick={handleBack}
          className="graph-explorer-back"
          title={t('common:backToPrevious') as string}
        >
          ← {t('common:back')}
        </button>
        <h1>{t('explorer:title')}</h1>
        <div className="graph-explorer-stats" aria-live="polite">
          {stats && (
            <span>
              {t('explorer:stats.nodes', { count: stats.nodeCount })} ·{' '}
              {t('explorer:stats.edges', { count: stats.edgeCount })}
              {stats.communityCount > 0 && (
                <> · {t('explorer:stats.communities', { count: stats.communityCount })}</>
              )}
            </span>
          )}
        </div>
        <div className="graph-explorer-toolbar">
          <button type="button" onClick={() => engineRef.current?.fit()} disabled={!stats}>
            {t('explorer:toolbar.fit')}
          </button>
          <button type="button" onClick={() => engineRef.current?.relayout()} disabled={!stats}>
            {t('explorer:toolbar.relayout')}
          </button>
          <button type="button" onClick={handleExportPng} disabled={!stats}>
            {t('explorer:toolbar.exportPng')}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <GraphExplorer
        ref={engineRef}
        focus={focus}
        depth={depth}
        direction={direction}
        onDepthChange={(d) => patchParams({ depth: String(d) })}
        onDirectionChange={(d) => patchParams({ dir: d })}
        onSetFocus={handleSetFocus}
        onOpenDetails={handleOpenDetails}
        onStats={setStats}
        enableCommunityLens
      />
    </div>
  );
}
