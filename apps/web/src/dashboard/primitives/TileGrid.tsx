import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';
import { substituteString } from '../tokens';
import { useRowSearch } from './_useRowSearch';
import { dispatchAction } from '../actions';
import { translateCellValue } from './_cellTranslate';
import type { ActionSpec } from '../actions';
import { useDashboardSummary } from '../../hooks/useDashboardSummary';
import { displayState, type ResultDisplayState, type ResultEnvelope } from '../../api/resultsApi';

interface TileSpec {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  onClick?: ActionSpec;
}

type ViewMode = 'tiles' | 'list';

/** Row shape of builtin:list_dashboard_folders. */
interface FolderRow {
  path: string;
  parent: string | null;
  label: string;
  path_label: string | null;
  icon: string | null;
  description: string | null;
  order: number | null;
  direct_count: number;
  total_count: number;
}

/** Display-state ranking for the "Ampel" sort and worst-state aggregation. */
const STATE_RANK: Record<ResultDisplayState, number> = {
  error: 0, warning: 1, failed: 2, neutral: 3, ok: 4, pending: 5,
};
const STATE_TOKEN: Record<ResultDisplayState, string> = {
  error: '●', warning: '▲', neutral: '◦', ok: '✓', failed: '⚡', pending: '…',
};
const FILTERABLE_STATES: ResultDisplayState[] = ['error', 'warning', 'ok', 'neutral', 'pending', 'failed'];

/** Auto-run cap (O7): rubric levels auto-trigger, larger sets stay explicit. */
const AUTO_RUN_MAX_PENDING = 32;

/**
 * Entry-count meta — two states:
 *   - flat hierarchy (no subfolders):     "(total)"
 *   - nested hierarchy (with subfolders): "direct (total)"
 */
export function formatEntryCount(direct: number, total: number, nested: boolean): string {
  return nested ? `${direct} (${total})` : `(${total})`;
}

interface FolderAggregate {
  counts: Record<ResultDisplayState, number>;
  worst: ResultDisplayState | null;
  findings: number;
  covered: number;
  total: number;
}

function emptyAggregate(): FolderAggregate {
  return {
    counts: { error: 0, warning: 0, failed: 0, neutral: 0, ok: 0, pending: 0 },
    worst: null,
    findings: 0,
    covered: 0,
    total: 0,
  };
}

/**
 * Client-side fold of the flat envelope map over one folder subtree
 * (dashboard kind only — queries/tests anchor in their own hierarchies).
 */
function aggregateFolder(
  results: Record<string, ResultEnvelope> | null,
  path: string,
): FolderAggregate | null {
  if (!results) return null;
  const agg = emptyAggregate();
  const prefix = `${path}/`;
  for (const envelope of Object.values(results)) {
    if (envelope.ref.kind !== 'dashboard') continue;
    const rubric = envelope.rubric || '';
    if (rubric !== path && !rubric.startsWith(prefix)) continue;
    const state = displayState(envelope);
    agg.counts[state] += 1;
    agg.total += 1;
    if (envelope.runStatus !== 'pending') agg.covered += 1;
    if (envelope.runStatus === 'ran' && envelope.unit === 'findings' && typeof envelope.value === 'number') {
      agg.findings += envelope.value;
    }
    if (agg.worst === null || STATE_RANK[state] < STATE_RANK[agg.worst]) agg.worst = state;
  }
  return agg.total > 0 ? agg : null;
}

/** Compact state counters for a folder tile: `3● 7▲ 41✓` (zero states omitted). */
const AggregateTokens = ({ agg }: { agg: FolderAggregate }) => (
  <span className="dash-tile__chips" aria-hidden="true">
    {FILTERABLE_STATES.filter(s => agg.counts[s] > 0).map(s => (
      <span key={s} className={`dash-chip dash-state-${s}`}>
        {agg.counts[s]}{STATE_TOKEN[s]}
      </span>
    ))}
  </span>
);

/** KPI + state chip row of one dashboard tile. */
const ResultChips = ({ envelope, running, unitLabel }: {
  envelope: ResultEnvelope | undefined;
  running: boolean;
  unitLabel: (envelope: ResultEnvelope) => string;
}) => {
  if (!envelope) return null;
  if (running) {
    return <span className="dash-tile__chips"><span className="dash-chip dash-chip--skeleton" /></span>;
  }
  const state = displayState(envelope);
  return (
    <span className="dash-tile__chips">
      {envelope.runStatus === 'ran' && envelope.value != null && (
        <span className="dash-chip dash-chip--kpi" title={envelope.meaning ?? undefined}>
          {String(envelope.value)}{' '}{unitLabel(envelope)}
        </span>
      )}
      <span
        className={`dash-chip dash-chip--state dash-state-${state}${state === 'pending' ? ' dash-chip--pending' : ''}`}
        title={envelope.error ?? undefined}
      >
        {STATE_TOKEN[state]}
      </span>
    </span>
  );
};

export function TileGrid({ node, dataset, datasets, navigate }: PrimitiveProps) {
  const { t } = useTranslation(['common', 'detail', 'dashboard']);
  // Pipe substituted tile strings through the dashboard cell-value translator
  // so canonical English titles / descriptions / categories emitted from SQL
  // templates render in the active UI language. Unknown values pass through.
  const tx = (s: string) => String(translateCellValue(s, t));
  const tile = (node.props?.tile as TileSpec) ?? { title: '{{title}}' };
  const minTileWidth = (node.props?.minTileWidth as number) ?? 220;
  const empty = node.props?.empty as { message?: string } | undefined;
  // Opt-in toolbar with a tiles⇄list toggle + entry-count meta.
  const viewToggle = node.props?.viewToggle as boolean | undefined;
  // Opt-in folder navigation (?folder= deep-links) + result chips. Default
  // off → every other TileGrid consumer behaves exactly as before.
  const folderNav = node.props?.folderNav === true;
  const folderParam = (node.props?.folderParam as string) || 'folder';
  const foldersDatasetId = (node.props?.foldersDataset as string) || 'folders';
  const resultChips = folderNav && node.props?.resultChips === true;
  const rows = dataset?.data ?? [];

  const [viewMode, setViewMode] = useState<ViewMode>('tiles');
  const [sortMode, setSortMode] = useState<'standard' | 'value' | 'state'>('standard');
  // Collapsed subfolder sections of the filtered hierarchy view (default: expanded).
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const summary = useDashboardSummary(resultChips);

  const currentFolder = folderNav ? (searchParams.get(folderParam) ?? '') : '';
  const stateFilter = useMemo(() => {
    if (!folderNav) return new Set<ResultDisplayState>();
    const raw = searchParams.get('state') ?? '';
    return new Set(
      raw.split(',').map(s => s.trim()).filter((s): s is ResultDisplayState =>
        (FILTERABLE_STATES as string[]).includes(s)),
    );
  }, [folderNav, searchParams]);

  const folderRows = useMemo<FolderRow[]>(() => {
    if (!folderNav) return [];
    return ((datasets?.[foldersDatasetId]?.data ?? []) as unknown[]) as FolderRow[];
  }, [folderNav, datasets, foldersDatasetId]);
  const folderByPath = useMemo(() => new Map(folderRows.map(f => [f.path, f])), [folderRows]);
  const folderExists = currentFolder === '' || folderByPath.has(currentFolder);

  const search = useRowSearch(rows, {
    searchable: node.props?.searchable as boolean | 'auto' | undefined,
    autoThreshold: node.props?.searchAutoThreshold as number | undefined,
    placeholder: node.props?.searchPlaceholder as string | undefined,
  });
  const hasQuery = search.query.trim() !== '';

  // Auto-run on rubric levels (O7): entering a folder triggers a `missing`
  // run for its subtree — bounded, idempotent against the server cache.
  // The root stays explicit ("run all"), pending chips make the state visible.
  const pendingInFolder = useMemo(() => {
    if (!resultChips || !summary.results || !currentFolder) return 0;
    const prefix = `${currentFolder}/`;
    let n = 0;
    for (const envelope of Object.values(summary.results)) {
      if (envelope.ref.kind !== 'dashboard' || envelope.runStatus !== 'pending') continue;
      const rubric = envelope.rubric || '';
      if (rubric === currentFolder || rubric.startsWith(prefix)) n += 1;
    }
    return n;
  }, [resultChips, summary.results, currentFolder]);

  useEffect(() => {
    if (!resultChips || !currentFolder || !folderExists) return;
    if (pendingInFolder === 0 || pendingInFolder > AUTO_RUN_MAX_PENDING) return;
    if (summary.isFolderRunning(currentFolder)) return;
    void summary.runFolder(currentFolder, 'missing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultChips, currentFolder, folderExists, pendingInFolder]);

  const setFolder = (path: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (path) next.set(folderParam, path);
      else next.delete(folderParam);
      return next;
    });
  };
  const toggleStateFilter = (state: ResultDisplayState) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      const active = new Set(stateFilter);
      if (active.has(state)) active.delete(state);
      else active.add(state);
      if (active.size) next.set('state', [...active].join(','));
      else next.delete('state');
      return next;
    });
  };

  const envelopeForRow = (row: Record<string, unknown>): ResultEnvelope | undefined =>
    resultChips ? summary.envelopeFor('dashboard', String(row.id ?? '')) : undefined;

  const unitLabel = (envelope: ResultEnvelope): string => {
    if (envelope.unit === 'findings') {
      return t('dashboard:folderNav.findings', { defaultValue: 'Findings' }) as string;
    }
    return envelope.unit ?? '';
  };

  if (rows.length === 0) {
    return <div className="dash-tilegrid__empty">{empty?.message ?? t('common:noEntries')}</div>;
  }

  const mode: ViewMode = viewToggle ? viewMode : 'tiles';

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`,
    gap: '12px',
  };

  // Shared per-row cell projection (used by both the tile grid and the list).
  const buildCell = (row: Record<string, unknown>) => ({
    title: tx(substituteString(tile.title, row)),
    subtitle: tile.subtitle ? tx(substituteString(tile.subtitle, row)) : '',
    badge: tile.badge ? tx(substituteString(tile.badge, row)) : '',
    clickable: !!tile.onClick,
  });

  // Sorting of dashboard rows within the folder view / flat views.
  const sortRows = (subset: Record<string, unknown>[]): Record<string, unknown>[] => {
    if (!resultChips || sortMode === 'standard') return subset;
    const sorted = [...subset];
    if (sortMode === 'value') {
      sorted.sort((a, b) => {
        const ea = envelopeForRow(a);
        const eb = envelopeForRow(b);
        const va = ea && ea.runStatus === 'ran' && typeof ea.value === 'number' ? ea.value : null;
        const vb = eb && eb.runStatus === 'ran' && typeof eb.value === 'number' ? eb.value : null;
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      });
    } else {
      sorted.sort((a, b) => {
        const ea = envelopeForRow(a);
        const eb = envelopeForRow(b);
        const ra = ea ? STATE_RANK[displayState(ea)] : 99;
        const rb = eb ? STATE_RANK[displayState(eb)] : 99;
        return ra - rb;
      });
    }
    return sorted;
  };

  // Renders one block of dashboard rows as either tiles or a list. In tile
  // mode with active folderNav the description leaves the tile (it stays a
  // search hit) and the chip row takes its place; the list mode keeps the
  // description as the dense view (O3). `showRubric` adds the folder path as
  // a meta line (flat search/filter views).
  const renderRows = (subset: Record<string, unknown>[], showRubric = false) =>
    mode === 'list' ? (
      <ul className="dash-navlist">
        {subset.map((row, i) => {
          const c = buildCell(row);
          const envelope = envelopeForRow(row);
          return (
            <li key={i}>
              <button
                type="button"
                className={`dash-navlist__item${c.clickable ? ' dash-navlist__item--clickable' : ''}`}
                onClick={c.clickable ? () => dispatchAction(tile.onClick, row, { navigate }) : undefined}
                disabled={!c.clickable}
              >
                <span className="dash-navlist__title">{c.title}</span>
                {c.subtitle && <span className="dash-navlist__subtitle">{c.subtitle}</span>}
                {showRubric && row.folder_label != null && (
                  <span className="dash-navlist__rubric">{String(row.folder_label)}</span>
                )}
                {resultChips && (
                  <ResultChips
                    envelope={envelope}
                    running={envelope ? summary.isRefRunning('dashboard', envelope.ref.id) : false}
                    unitLabel={unitLabel}
                  />
                )}
                {c.badge && <span className="dash-navlist__badge">{c.badge}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    ) : (
      <div className="dash-tilegrid" style={gridStyle}>
        {subset.map((row, i) => {
          const c = buildCell(row);
          const envelope = envelopeForRow(row);
          const state = envelope ? displayState(envelope) : null;
          return (
            <button
              key={i}
              type="button"
              className={`dash-tile${c.clickable ? ' dash-tile--clickable' : ''}${resultChips && state ? ` dash-tile--state-${state}` : ''}`}
              onClick={c.clickable ? () => dispatchAction(tile.onClick, row, { navigate }) : undefined}
              disabled={!c.clickable}
              title={folderNav ? (c.subtitle || undefined) : undefined}
            >
              <span className="dash-tile__title">{c.title}</span>
              {!folderNav && c.subtitle && <span className="dash-tile__subtitle">{c.subtitle}</span>}
              {showRubric && row.folder_label != null && (
                <span className="dash-tile__rubric">{String(row.folder_label)}</span>
              )}
              {resultChips && (
                <ResultChips
                  envelope={envelope}
                  running={envelope ? summary.isRefRunning('dashboard', envelope.ref.id) : false}
                  unitLabel={unitLabel}
                />
              )}
              {c.badge && <span className="dash-tile__badge">{c.badge}</span>}
            </button>
          );
        })}
      </div>
    );

  // Folder tiles for the current level (folderNav mode).
  const renderFolderTiles = (folders: FolderRow[]) => (
    <div className="dash-tilegrid" style={gridStyle}>
      {folders.map(f => {
        const agg = resultChips ? aggregateFolder(summary.results, f.path) : null;
        const running = resultChips && summary.isFolderRunning(f.path);
        const nested = f.total_count !== f.direct_count;
        return (
          <button
            key={f.path}
            type="button"
            className={`dash-tile dash-tile--clickable dash-tile--folder${agg?.worst ? ` dash-tile--state-${agg.worst}` : ''}`}
            onClick={() => setFolder(f.path)}
            title={f.description ?? undefined}
          >
            <span className="dash-tile__title">
              <span className="dash-tile__foldericon" aria-hidden="true">▸</span>
              {f.label}
              <span className="dash-tilegroup__count">{formatEntryCount(f.direct_count, f.total_count, nested)}</span>
            </span>
            {agg && (
              <span className="dash-tile__chips-row">
                <AggregateTokens agg={agg} />
                {agg.covered < agg.total && (
                  <span className="dash-chip dash-chip--coverage" title={t('dashboard:folderNav.coverageHint', { defaultValue: 'Teilabdeckung — noch nicht alle Ergebnisse berechnet' }) as string}>
                    {agg.covered}/{agg.total}
                  </span>
                )}
              </span>
            )}
            {resultChips && (
              <span
                role="button"
                tabIndex={0}
                className={`dash-tile__run${running ? ' dash-tile__run--busy' : ''}`}
                title={t('dashboard:folderNav.run', { defaultValue: 'Ausführen' }) as string}
                onClick={e => {
                  e.stopPropagation();
                  void summary.runFolder(f.path, 'refresh');
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    void summary.runFolder(f.path, 'refresh');
                  }
                }}
              >
                {running ? '⏳' : '▶'}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  /**
   * Entry count of a featured bundle: the number of result-capable dashboards
   * in the subtrees it declares (`badgeRoots`). Counted, never evaluated — the
   * summary map holds one entry per registry unit including pending stubs, so
   * this is the same number the bundle's own "Rules" KPI shows, without a run
   * and without an extra request. Absent while the summary is still loading.
   */
  const featuredCount = (row: Record<string, unknown>): number | null => {
    if (!resultChips || !summary.results) return null;
    const roots = String(row.badge_roots ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!roots.length) return null;
    const total = roots.reduce((sum, r) => sum + (aggregateFolder(summary.results, r)?.total ?? 0), 0);
    return total > 0 ? total : null;
  };

  /**
   * Featured entries (manifest `featured: true`) — the overview's entry points.
   * Rendered as a full-width band ABOVE the folder tiles instead of competing
   * as an equal tile below them, and deliberately without result chips or a
   * state edge: those stay the visual language of the folders, so the band
   * reads as a different species rather than a fifth rubric.
   */
  const renderFeatured = (subset: Record<string, unknown>[]) => (
    <div className="dash-featured">
      {subset.map((row, i) => {
        const c = buildCell(row);
        const count = featuredCount(row);
        return (
          <button
            key={i}
            type="button"
            className={`dash-tile dash-tile--featured${c.clickable ? ' dash-tile--clickable' : ''}`}
            onClick={c.clickable ? () => dispatchAction(tile.onClick, row, { navigate }) : undefined}
            disabled={!c.clickable}
          >
            <span className="dash-featured__head">
              <span className="dash-tile__title">{c.title}</span>
              {count !== null && (
                <span className="dash-featured__count">
                  {t('dashboard:featured.ruleCount', { count, defaultValue: '{{count}} rules' })}
                </span>
              )}
            </span>
            {c.subtitle && <span className="dash-featured__desc">{c.subtitle}</span>}
          </button>
        );
      })}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Legacy grouped mode (`groupBy`) — unchanged for existing consumers.
  // ---------------------------------------------------------------------------
  const groupByField = !folderNav ? (node.props?.groupBy as string | undefined) : undefined;
  const groups: { key: string; label: string; rows: Record<string, unknown>[] }[] = [];
  if (groupByField) {
    const byKey = new Map<string, Record<string, unknown>[]>();
    for (const row of search.filtered) {
      const raw = row[groupByField];
      const key = raw == null ? '' : String(raw);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(row);
    }
    // Humanized fallback when no server-provided localized label is available.
    const folderLabelFallback = (key: string) =>
      key
        .split('/')
        .map((seg) => tx(seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())))
        .join(' / ');
    const keys = [...byKey.keys()].sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return a.localeCompare(b);
    });
    for (const key of keys) {
      const groupRows = byKey.get(key)!;
      const serverLabel = key !== '' ? (groupRows[0]?.folder_label as string | undefined) : undefined;
      groups.push({
        key,
        label:
          key === ''
            ? (t('common:general', { defaultValue: 'General' }) as string)
            : serverLabel || folderLabelFallback(key),
        rows: groupRows,
      });
    }
  }
  const rootCount = groupByField
    ? (groups.find((g) => g.key === '')?.rows.length ?? 0)
    : search.filtered.length;
  const nestedCount = groupByField ? groups.some((g) => g.key !== '') : false;

  // ---------------------------------------------------------------------------
  // folderNav derivations — local/global resolution:
  //   search  ⇒ GLOBAL flat view (rubric path per hit, counts global)
  //   filter  ⇒ LOCAL to the current folder: direct hits + one collapsible
  //             section per subfolder (collapsed = consolidated count+tokens)
  //   neither ⇒ plain folder level; counts always map to the shown level.
  // ---------------------------------------------------------------------------
  const filterActive = folderNav && stateFilter.size > 0;
  const searchMode = folderNav && hasQuery;
  const filterMode = folderNav && !hasQuery && filterActive;

  const inSubtree = (row: Record<string, unknown>, folderPath: string): boolean => {
    if (!folderPath) return true;
    const f = row.folder == null ? '' : String(row.folder);
    return f === folderPath || f.startsWith(`${folderPath}/`);
  };
  const matchesStateFilter = (row: Record<string, unknown>): boolean => {
    if (!filterActive) return true;
    const envelope = envelopeForRow(row);
    if (!envelope) return false;
    return stateFilter.has(displayState(envelope));
  };

  const childFolders = folderNav
    ? folderRows.filter(f => (currentFolder ? f.parent === currentFolder : f.parent === null))
    : [];
  const childRows = folderNav
    ? search.filtered.filter(r => (currentFolder ? String(r.folder ?? '') === currentFolder : r.folder == null))
    : [];
  // Featured entries leave the normal grid (they render as their own band) —
  // otherwise the same bundle would appear twice on the level.
  const featuredRows = childRows.filter(r => r.featured === true);
  const plainRows = childRows.filter(r => r.featured !== true);
  // Search resolves globally (special case by design); an additionally active
  // state filter narrows the global hits further.
  const globalMatches = searchMode ? search.filtered.filter(matchesStateFilter) : [];
  // State filter resolves within the current subtree — the hierarchy context
  // stays visible instead of collapsing into a global list.
  const subtreeMatches = filterMode
    ? rows.filter(r => inSubtree(r, currentFolder)).filter(matchesStateFilter)
    : [];
  /** Total number of dashboards in the currently shown subtree. */
  const subtreeTotal = currentFolder
    ? (folderByPath.get(currentFolder)?.total_count ?? childRows.length)
    : rows.length;

  /** Consolidated aggregate over a concrete row set (collapsed section header). */
  const aggregateRowSet = (set: Record<string, unknown>[]): FolderAggregate => {
    const agg = emptyAggregate();
    for (const row of set) {
      const envelope = envelopeForRow(row);
      if (!envelope) continue;
      const state = displayState(envelope);
      agg.counts[state] += 1;
      agg.total += 1;
      if (envelope.runStatus !== 'pending') agg.covered += 1;
      if (envelope.runStatus === 'ran' && envelope.unit === 'findings' && typeof envelope.value === 'number') {
        agg.findings += envelope.value;
      }
      if (agg.worst === null || STATE_RANK[state] < STATE_RANK[agg.worst]) agg.worst = state;
    }
    return agg;
  };

  const toggleSection = (path: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /**
   * Filtered hierarchy view (state filter without search): direct matches of
   * the current folder first, then one collapsible section per subfolder that
   * has matches. Collapsed sections keep a consolidated view (match count +
   * state tokens); expanded sections show the filtered tiles incl. rubric
   * path for hits nested deeper than the section folder.
   */
  const renderFilteredHierarchy = () => {
    const direct = subtreeMatches.filter(r =>
      (currentFolder ? String(r.folder ?? '') === currentFolder : r.folder == null));
    const sections = childFolders
      .map(f => ({ folder: f, matches: subtreeMatches.filter(r => inSubtree(r, f.path)) }))
      .filter(s => s.matches.length > 0);
    if (direct.length === 0 && sections.length === 0) {
      return (
        <div className="dash-tilegrid__empty">
          {t('dashboard:folderNav.noFilterMatches', { defaultValue: 'Keine Einträge mit diesem Status in dieser Rubrik.' })}
        </div>
      );
    }
    return (
      <div className="dash-tilegroups">
        {direct.length > 0 && renderRows(sortRows(direct))}
        {sections.map(({ folder: f, matches }) => {
          const collapsed = collapsedSections.has(f.path);
          return (
            <section key={f.path} className="dash-tilegroup dash-tilegroup--collapsible">
              <h3 className="dash-tilegroup__title">
                <button
                  type="button"
                  className="dash-tilegroup__toggle"
                  onClick={() => toggleSection(f.path)}
                  aria-expanded={!collapsed}
                >
                  <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                  {f.label}
                  <span className="dash-tilegroup__count">{formatEntryCount(matches.length, matches.length, false)}</span>
                </button>
                {collapsed && <AggregateTokens agg={aggregateRowSet(matches)} />}
                <button
                  type="button"
                  className="dash-folderbar__link dash-tilegroup__open"
                  onClick={() => setFolder(f.path)}
                >
                  {t('dashboard:folderNav.openFolder', { defaultValue: 'Ordner öffnen' })} →
                </button>
              </h3>
              {!collapsed && renderRows(sortRows(matches), true)}
            </section>
          );
        })}
      </div>
    );
  };

  // "Run all" on the current level: root chunks per top-level folder
  // (frontend chunking instead of a queue system, O8); inside a folder it
  // runs the subtree.
  const runAllBusy = folderNav && (currentFolder
    ? summary.isFolderRunning(currentFolder)
    : childFolders.some(f => summary.isFolderRunning(f.path)));
  const runAll = () => {
    if (currentFolder) {
      void summary.runFolder(currentFolder, 'missing');
    } else {
      for (const f of folderRows.filter(f => f.parent === null)) {
        void summary.runFolder(f.path, 'missing');
      }
    }
  };

  const stateFilterLabel = (s: ResultDisplayState): string =>
    t(`dashboard:folderNav.state.${s}`, { defaultValue: s }) as string;

  return (
    <div className="dash-tilegrid-wrap">
      {viewToggle && (
        <div className="dash-viewbar">
          <div className="dash-viewbar__toggle" role="group" aria-label={t('dashboard:view.label') as string}>
            <button
              type="button"
              className={`dash-viewbar__btn${mode === 'tiles' ? ' active' : ''}`}
              aria-pressed={mode === 'tiles'}
              title={t('dashboard:view.tiles') as string}
              aria-label={t('dashboard:view.tiles') as string}
              onClick={() => setViewMode('tiles')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </button>
            <button
              type="button"
              className={`dash-viewbar__btn${mode === 'list' ? ' active' : ''}`}
              aria-pressed={mode === 'list'}
              title={t('dashboard:view.list') as string}
              aria-label={t('dashboard:view.list') as string}
              onClick={() => setViewMode('list')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="8" y1="6" x2="20" y2="6" />
                <line x1="8" y1="12" x2="20" y2="12" />
                <line x1="8" y1="18" x2="20" y2="18" />
                <circle cx="4" cy="6" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="4" cy="18" r="1.1" fill="currentColor" stroke="none" />
              </svg>
            </button>
          </div>

          {resultChips && summary.results && (
            <>
              <div className="dash-viewbar__filters" role="group" aria-label={t('dashboard:folderNav.filterLabel', { defaultValue: 'Status' }) as string}>
                {FILTERABLE_STATES.map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`dash-chip dash-chip--filter dash-state-${s}${stateFilter.has(s) ? ' dash-chip--active' : ''}`}
                    aria-pressed={stateFilter.has(s)}
                    onClick={() => toggleStateFilter(s)}
                    title={stateFilterLabel(s)}
                  >
                    {STATE_TOKEN[s]} {stateFilterLabel(s)}
                  </button>
                ))}
              </div>
              <select
                className="dash-viewbar__sort"
                value={sortMode}
                onChange={e => setSortMode(e.target.value as typeof sortMode)}
                aria-label={t('dashboard:folderNav.sortLabel', { defaultValue: 'Sortierung' }) as string}
              >
                <option value="standard">{t('dashboard:folderNav.sortStandard', { defaultValue: 'Standard' }) as string}</option>
                <option value="value">{t('dashboard:folderNav.sortValue', { defaultValue: 'Ergebnis-Anzahl ↓' }) as string}</option>
                <option value="state">{t('dashboard:folderNav.sortState', { defaultValue: 'Ampel' }) as string}</option>
              </select>
              <button
                type="button"
                className="dash-folderbar__runall"
                onClick={runAll}
                disabled={runAllBusy}
              >
                {runAllBusy
                  ? (t('dashboard:folderNav.running', { defaultValue: 'läuft…' }) as string)
                  : (t('dashboard:folderNav.runAll', { defaultValue: 'Alle ausführen' }) as string)}
              </button>
            </>
          )}

          {/* Entry-count meta — always mapped to the SHOWN level: search =
              global matches, filter = matches in the current subtree, plain
              folder view = level items (subtree total). */}
          <span className="dash-viewbar__count">
            {!folderNav
              ? formatEntryCount(rootCount, rows.length, nestedCount)
              : searchMode
                ? formatEntryCount(globalMatches.length, globalMatches.length, false)
                : filterMode
                  ? formatEntryCount(subtreeMatches.length, subtreeMatches.length, false)
                  : formatEntryCount(
                    childRows.length + childFolders.length,
                    subtreeTotal,
                    childFolders.length > 0,
                  )}
          </span>
        </div>
      )}

      {search.visible && (
        <div className="dash-search-bar">
          <span className="dash-search-bar__count">
            {t('detail:autoTable.rowCount', {
              count: !folderNav
                ? search.filtered.length
                : searchMode
                  ? globalMatches.length
                  : filterMode
                    ? subtreeMatches.length
                    : subtreeTotal,
            })}
            {searchMode && globalMatches.length !== search.totalCount && (
              <> · {t('detail:autoTable.filteredFrom', { count: search.totalCount })}</>
            )}
            {filterMode && subtreeMatches.length !== subtreeTotal && (
              <> · {t('detail:autoTable.filteredFrom', { count: subtreeTotal })}</>
            )}
            {!folderNav && hasQuery && search.filtered.length !== search.totalCount && (
              <> · {t('detail:autoTable.filteredFrom', { count: search.totalCount })}</>
            )}
          </span>
          <input
            type="search"
            className="dash-search-bar__input"
            placeholder={search.placeholder}
            value={search.query}
            onChange={e => search.setQuery(e.target.value)}
          />
        </div>
      )}

      {folderNav ? (
        !folderExists ? (
          // Guard: unknown ?folder= value — no error, a hint + root link.
          <div className="dash-tilegrid__empty">
            <p>{t('dashboard:folderNav.notFound', { defaultValue: 'Ordner nicht gefunden.' })}</p>
            <button type="button" className="dash-folderbar__link" onClick={() => setFolder('')}>
              {t('dashboard:folderNav.backToRoot', { defaultValue: 'Zur Übersicht' })}
            </button>
          </div>
        ) : searchMode ? (
          // Search resolves GLOBALLY — flat hit list across the whole
          // hierarchy with the rubric path per tile.
          renderRows(sortRows(globalMatches), true)
        ) : filterMode ? (
          // State filter resolves LOCALLY — filtered hierarchy of the
          // current folder with collapsible subfolder sections.
          renderFilteredHierarchy()
        ) : (
          <>
            {featuredRows.length > 0 && renderFeatured(featuredRows)}
            {childFolders.length > 0 && renderFolderTiles(childFolders)}
            {plainRows.length > 0 && renderRows(sortRows(plainRows))}
            {childFolders.length === 0 && childRows.length === 0 && (
              <div className="dash-tilegrid__empty">{empty?.message ?? t('common:noEntries')}</div>
            )}
          </>
        )
      ) : groupByField ? (
        <div className="dash-tilegroups">
          {groups.map((g) => (
            <section key={g.key || '__root__'} className="dash-tilegroup">
              <h3 className="dash-tilegroup__title">
                {g.label}
                <span className="dash-tilegroup__count">{formatEntryCount(g.rows.length, g.rows.length, false)}</span>
              </h3>
              {renderRows(g.rows)}
            </section>
          ))}
        </div>
      ) : (
        renderRows(search.filtered)
      )}

      {hasQuery && (searchMode ? globalMatches : search.filtered).length === 0 && (
        <div className="dash-search-bar__empty">
          {t('detail:autoTable.noMatches', { query: search.query })}
        </div>
      )}
    </div>
  );
}
