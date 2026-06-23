import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeColor } from '../lib/graphColors';
import type { FilterMode, ColorMode } from './ExplorerGraph';
import type { SubgraphDirection } from '../hooks/useSubgraph';

/** One community present in the current graph — drives the color-lens legend. */
export interface CommunityLegendItem {
  id: number;
  name: string | null;
  count: number;
  color: string;
}

/**
 * Control surface for the Graph Explorer.
 *
 * The focus is set elsewhere (DetailView button / deep-link / double-tap), so
 * this panel carries no global search. The **name filter** (text) and the
 * **file filter** (dropdown) are *soft* client-side lenses on the loaded
 * subgraph; their non-matches are dimmed or hidden per the shared mode toggle.
 * The **type chips** are a *hard exclusion set* — clicking a chip deselects that
 * type (hides it); all others stay on. Depth/direction/mode re-fetch.
 */

export interface ExplorerFilterPanelProps {
  /** Label of the current focus node (read-only context). */
  focusLabel: string | null;
  /** Client-side name filter value. */
  nameFilter: string;
  /** Selected file (null = all files). */
  selectedFile: string | null;
  /** How name/file non-matches are treated (dim = default, hide). */
  filterMode: FilterMode;
  depth: number;
  direction: SubgraphDirection;
  /** Deselected types (exclusion set) — empty = all types shown. */
  deselectedTypes: string[];
  /** Types to render as chips (graph types ∪ deselected), with counts. */
  availableTypes: { type: string; count: number }[];
  /** Distinct files present in the current graph. */
  availableFiles: string[];
  /** Show the Type↔Community color-lens toggle + legend (standalone only). */
  showColorMode: boolean;
  /** Active node color lens. */
  colorMode: ColorMode;
  /** Communities present in the current graph (legend; only used in community mode). */
  communities: CommunityLegendItem[];
  /** Currently selected community (hull + dims others), or null. */
  selectedCommunity: number | null;
  onNameFilterChange: (v: string) => void;
  onSelectedFileChange: (file: string | null) => void;
  onFilterModeChange: (m: FilterMode) => void;
  onColorModeChange: (m: ColorMode) => void;
  /** Toggle a community as selected. */
  onSelectCommunity: (id: number) => void;
  /** Hover preview of a community hull (id) / clear (null). */
  onHoverCommunity: (id: number | null) => void;
  onDepthChange: (d: number) => void;
  onDirectionChange: (d: SubgraphDirection) => void;
  onToggleType: (type: string) => void;
}

const DIRECTIONS: SubgraphDirection[] = ['out', 'in', 'both'];
const FILTER_MODES: FilterMode[] = ['dim', 'hide'];
const COLOR_MODES: ColorMode[] = ['type', 'community'];

export function ExplorerFilterPanel(props: ExplorerFilterPanelProps) {
  const {
    focusLabel, nameFilter, selectedFile, filterMode, depth, direction,
    deselectedTypes, availableTypes, availableFiles,
    showColorMode, colorMode, communities, selectedCommunity,
    onNameFilterChange, onSelectedFileChange, onFilterModeChange, onColorModeChange,
    onSelectCommunity, onHoverCommunity,
    onDepthChange, onDirectionChange, onToggleType,
  } = props;
  const { t } = useTranslation(['explorer']);

  const deselectedSet = useMemo(() => new Set(deselectedTypes), [deselectedTypes]);
  // The shared dim/hide mode is meaningful while any soft filter — name, file, or
  // a community selection — is active.
  const softFilterActive =
    nameFilter.trim() !== '' || selectedFile !== null || selectedCommunity !== null;

  // The display name a legend entry shows (heuristic name or "Community N").
  const communityLabel = (c: CommunityLegendItem) =>
    c.name ?? (t('filter.communityUnnamed', { id: c.id }) as string);

  // The search box also narrows the community list.
  const visibleCommunities = useMemo(() => {
    const nf = nameFilter.trim().toLowerCase();
    if (!nf) return communities;
    return communities.filter((c) => communityLabel(c).toLowerCase().includes(nf));
    // communityLabel only depends on t (stable) + the item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communities, nameFilter]);

  return (
    <aside className="explorer-filter-panel" aria-label={t('filter.ariaLabel') as string}>
      {/* Current focus (read-only context) */}
      <div className="explorer-filter-section">
        <span className="explorer-filter-label">{t('filter.focus')}</span>
        <div className="explorer-focus-display" title={focusLabel ?? undefined}>
          {focusLabel ?? <span className="explorer-focus-empty">{t('filter.noFocus')}</span>}
        </div>
      </div>

      {/* Client-side name filter */}
      <div className="explorer-filter-section">
        <label className="explorer-filter-label" htmlFor="explorer-name-filter">
          {t('filter.nameFilter')}
        </label>
        <div className="explorer-search-box">
          <input
            id="explorer-name-filter"
            type="text"
            value={nameFilter}
            placeholder={t('filter.nameFilterPlaceholder') as string}
            onChange={(e) => onNameFilterChange(e.target.value)}
            autoComplete="off"
          />
          {nameFilter && (
            <button
              type="button"
              className="explorer-search-clear"
              onClick={() => onNameFilterChange('')}
              aria-label={t('filter.clearNameFilter') as string}
              title={t('filter.clearNameFilter') as string}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* File filter — only shown when the graph spans more than one file */}
      {availableFiles.length > 1 && (
        <div className="explorer-filter-section">
          <label className="explorer-filter-label" htmlFor="explorer-file-filter">
            {t('filter.file')}
          </label>
          <select
            id="explorer-file-filter"
            className="explorer-file-select"
            value={selectedFile ?? ''}
            onChange={(e) => onSelectedFileChange(e.target.value || null)}
          >
            <option value="">{t('filter.allFiles')}</option>
            {availableFiles.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      )}

      {/* Shared dim/hide mode for the soft (name + file) filters */}
      {softFilterActive && (
        <div className="explorer-filter-section">
          <span className="explorer-filter-label">{t('filter.filterMode')}</span>
          <div
            className="explorer-segmented explorer-segmented-sm"
            role="radiogroup"
            aria-label={t('filter.filterMode') as string}
          >
            {FILTER_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={filterMode === m}
                className={`explorer-segment${filterMode === m ? ' is-active' : ''}`}
                onClick={() => onFilterModeChange(m)}
                title={t(`filter.filterModeHints.${m}`) as string}
              >
                {t(`filter.filterModes.${m}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Depth */}
      <div className="explorer-filter-section">
        <label className="explorer-filter-label" htmlFor="explorer-depth">
          {t('filter.depth')}: <strong>{depth}</strong>
        </label>
        <input
          id="explorer-depth"
          type="range"
          min={1}
          max={4}
          step={1}
          value={depth}
          onChange={(e) => onDepthChange(Number(e.target.value))}
        />
      </div>

      {/* Direction */}
      <div className="explorer-filter-section">
        <span className="explorer-filter-label">{t('filter.direction')}</span>
        <div className="explorer-segmented" role="radiogroup" aria-label={t('filter.direction') as string}>
          {DIRECTIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              className={`explorer-segment${direction === d ? ' is-active' : ''}`}
              onClick={() => onDirectionChange(d)}
              title={t(`filter.directionHints.${d}`) as string}
            >
              {t(`filter.directions.${d}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Color lens — Type ↔ Community recolor + community legend.
          Standalone only; the embedded panel never sets showColorMode. */}
      {showColorMode && (
        <div className="explorer-filter-section">
          <span className="explorer-filter-label">{t('filter.colorMode')}</span>
          <div
            className="explorer-segmented explorer-segmented-sm"
            role="radiogroup"
            aria-label={t('filter.colorMode') as string}
          >
            {COLOR_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={colorMode === m}
                className={`explorer-segment${colorMode === m ? ' is-active' : ''}`}
                onClick={() => onColorModeChange(m)}
                title={t(`filter.colorModeHints.${m}`) as string}
              >
                {t(`filter.colorModes.${m}`)}
              </button>
            ))}
          </div>

          {colorMode === 'community' && visibleCommunities.length > 0 && (
            <ul className="explorer-community-legend" onMouseLeave={() => onHoverCommunity(null)}>
              {visibleCommunities.map((c) => {
                const active = selectedCommunity === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`explorer-community-legend-item${active ? ' is-active' : ''}`}
                      title={communityLabel(c)}
                      aria-pressed={active}
                      onClick={() => onSelectCommunity(c.id)}
                      onMouseEnter={() => onHoverCommunity(c.id)}
                      onFocus={() => onHoverCommunity(c.id)}
                      onBlur={() => onHoverCommunity(null)}
                    >
                      <span className="explorer-type-dot" style={{ background: c.color }} />
                      <span className="explorer-community-legend-name">{communityLabel(c)}</span>
                      <span className="explorer-chip-count">{c.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Type chips */}
      {availableTypes.length > 0 && (
        <div className="explorer-filter-section">
          <span className="explorer-filter-label">
            {t('filter.types')}
            {deselectedTypes.length > 0 && (
              <button type="button" className="explorer-chip-clear" onClick={() => deselectedTypes.forEach(onToggleType)}>
                {t('filter.showAllTypes')}
              </button>
            )}
          </span>
          <div className="explorer-chips">
            {availableTypes.map(({ type, count }) => {
              // Exclusion model: a chip is active (shown) unless it's deselected.
              const active = !deselectedSet.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  className={`explorer-chip${active ? ' is-active' : ''}`}
                  style={active ? { borderColor: getTypeColor(type) } : undefined}
                  aria-pressed={active}
                  onClick={() => onToggleType(type)}
                >
                  <span className="explorer-type-dot" style={{ background: getTypeColor(type) }} />
                  {type}
                  <span className="explorer-chip-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
