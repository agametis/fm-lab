import { useCallback, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SubNav } from '../components/SubNav';
import { StatusBar } from '../components/StatusBar';
import { Filterbar } from '../components/Filterbar';
import {
  GraphExplorer,
  type GraphExplorerHandle,
  type GraphExplorerStats,
} from '../components/GraphExplorer';
import type { SubgraphDirection } from '../hooks/useSubgraph';
import { useEscapeStack } from '../hooks/useEscapeStack';
import { buildObjectPath, buildBreadcrumb } from '../lib/navigation';
import './GraphExplorerView.css';

/**
 * Graph Explorer — standalone route `/graph`. Thin host around the reusable
 * {@link GraphExplorer} engine: it owns the deep-link params
 * (`?focus=&depth=&dir=`) and renders the full-screen header (back, title,
 * live stats, fit/relayout/export, theme toggle). Focus is set via the
 * DetailView graph tab, a deep-link or a double-tap (no global search).
 */

// Obergrenze der Tiefe im Deep-Link. Muss zum Backend GRAPH_MAX_DEPTH passen
// (Default 16); der GUI-Default bleibt 4, nur die Opt-in-Erweiterung geht höher.
const GRAPH_MAX_DEPTH = 16;

function clampDepth(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(GRAPH_MAX_DEPTH, Math.max(1, Math.round(n)));
}

function parseDirection(raw: string | null): SubgraphDirection {
  return raw === 'out' || raw === 'in' || raw === 'both' ? raw : 'both';
}

export function GraphExplorerView() {
  const { t } = useTranslation(['explorer', 'common', 'nav']);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const engineRef = useRef<GraphExplorerHandle>(null);
  const [stats, setStats] = useState<GraphExplorerStats | null>(null);

  const focus = searchParams.get('focus');
  // Klon-Disambiguierung: File_Name des Fokus (Graceful Downgrade ohne den Param).
  const focusFile = searchParams.get('focus_file');
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

  // Re-Focus bleibt im Graphen, schreibt aber focus_file mit, damit der Backend-
  // Fokus eine geteilte Klon-UUID eindeutig auflöst (sonst 409).
  const handleSetFocus = useCallback(
    (uuid: string, file?: string | null) => patchParams({ focus: uuid, focus_file: file ?? null }),
    [patchParams],
  );
  const handleOpenDetails = useCallback(
    (uuid: string, file?: string | null) => navigate(buildObjectPath(uuid, null, file ?? null)),
    [navigate],
  );

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
      <SubNav
        breadcrumbs={
          focus && stats?.focusLabel
            ? buildBreadcrumb({ kind: 'graphNode', nodeName: stats.focusLabel }, t)
            : buildBreadcrumb({ kind: 'graph' }, t)
        }
      />
      <StatusBar
        onBack={handleBack}
        message={stats && (
          <span className="graph-explorer-stats" aria-live="polite">
            {t('explorer:stats.nodes', { count: stats.nodeCount })} ·{' '}
            {t('explorer:stats.edges', { count: stats.edgeCount })}
            {stats.communityCount > 0 && (
              <> · {t('explorer:stats.communities', { count: stats.communityCount })}</>
            )}
          </span>
        )}
      >
        <Filterbar className="graph-explorer-toolbar">
          <button type="button" onClick={() => engineRef.current?.fit()} disabled={!stats}>
            {t('explorer:toolbar.fit')}
          </button>
          <button type="button" onClick={() => engineRef.current?.relayout()} disabled={!stats}>
            {t('explorer:toolbar.relayout')}
          </button>
          <button type="button" onClick={handleExportPng} disabled={!stats}>
            {t('explorer:toolbar.exportPng')}
          </button>
        </Filterbar>
      </StatusBar>

      <GraphExplorer
        ref={engineRef}
        focus={focus}
        focusFile={focusFile}
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
