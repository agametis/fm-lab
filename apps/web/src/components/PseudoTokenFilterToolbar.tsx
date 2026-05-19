import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Filter-Toolbar für Pseudo-Token-Listen (PRD prd_pseudo_object_types_filter.md §8.2).
 *
 * Render-Bedingung: nur für die drei Token-Pseudo-Typen
 * (ScriptStepType, BuiltinFunction, PluginFunction). PluginComponent rendert keine
 * Toolbar (ist selbst die Category-Ebene).
 */

export type CategoryEntry = {
  category: string | null;
  token_count: number;
  total_usage: number;
};

export type SortMode = 'usage' | 'name' | 'category';

interface Props {
  /** Categories vom /api/list/categories Endpoint */
  categories: CategoryEntry[];
  /** Aktive Categories (mehrere via OR-Verknüpfung) */
  activeCategories: string[];
  onToggleCategory: (category: string) => void;
  onClearCategories: () => void;
  /** Aktuelle Sortierung */
  sort: SortMode;
  onSortChange: (sort: SortMode) => void;
  /** Lokaler Filter-Text (clientseitig) */
  searchText: string;
  onSearchTextChange: (s: string) => void;
  /** Trefferzähler-Anzeige: 'aktuell / total' */
  filteredCount: number;
  totalCount: number;
  /** Header-Label für die Kategorie-Sektion ('Kategorie' | 'Komponente') */
  categoryLabel: string;
}

const VISIBLE_THRESHOLD = 8;

export const PseudoTokenFilterToolbar: React.FC<Props> = ({
  categories,
  activeCategories,
  onToggleCategory,
  onClearCategories,
  sort,
  onSortChange,
  searchText,
  onSearchTextChange,
  filteredCount,
  totalCount,
  categoryLabel,
}) => {
  const { t } = useTranslation(['nav']);
  const [expanded, setExpanded] = useState(false);

  // Pillen-Sortierung: aktiv → nach total_usage desc; Pseudo-NULL ("Sonstige") ganz hinten
  const sortedCategories = [...categories].sort((a, b) => {
    if (a.category == null && b.category != null) return 1;
    if (b.category == null && a.category != null) return -1;
    return b.total_usage - a.total_usage;
  });

  const visibleCategories = expanded
    ? sortedCategories
    : sortedCategories.slice(0, VISIBLE_THRESHOLD);
  const hasMore = sortedCategories.length > VISIBLE_THRESHOLD;
  const activeSet = new Set(activeCategories);

  return (
    <div className="pseudo-token-toolbar">
      <div className="pseudo-token-toolbar-row1">
        <div className="pseudo-token-toolbar-search">
          <label htmlFor="pseudo-token-search-input">{t('nav:pseudoToolbar.searchLabel')}</label>
          <input
            id="pseudo-token-search-input"
            type="text"
            value={searchText}
            onChange={(e) => onSearchTextChange(e.target.value)}
            placeholder={t('nav:pseudoToolbar.tokenSearchPlaceholder') as string}
          />
          <span className="pseudo-token-count">
            {filteredCount} / {totalCount}
          </span>
        </div>
        <div className="pseudo-token-toolbar-sort">
          <label htmlFor="pseudo-token-sort-select">{t('nav:pseudoToolbar.sortLabel')}</label>
          <select
            id="pseudo-token-sort-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortMode)}
          >
            <option value="usage">{t('nav:pseudoToolbar.sortByUsage')}</option>
            <option value="name">{t('nav:pseudoToolbar.sortByName')}</option>
            <option value="category">{categoryLabel}</option>
          </select>
        </div>
      </div>

      {sortedCategories.length > 0 && (
        <div className="pseudo-token-toolbar-row2">
          <span className="pseudo-token-toolbar-category-label">
            {categoryLabel}:
          </span>
          <div className="pseudo-token-toolbar-pills">
            {visibleCategories.map((c) => {
              const label = c.category ?? (t('nav:pseudoToolbar.otherCategory') as string);
              const active = c.category != null && activeSet.has(c.category);
              return (
                <button
                  key={c.category ?? '__null__'}
                  type="button"
                  className={`pseudo-token-pill${active ? ' active' : ''}${c.category == null ? ' pseudo-token-pill-null' : ''}`}
                  onClick={() => {
                    if (c.category == null) return;
                    onToggleCategory(c.category);
                  }}
                  disabled={c.category == null}
                  title={
                    c.category == null
                      ? (t('nav:pseudoToolbar.uncategorisedTooltip') as string)
                      : (t('nav:pseudoToolbar.categoryTooltip', {
                          label,
                          tokens: c.token_count,
                          usages: c.total_usage,
                        }) as string)
                  }
                >
                  {label} ({c.token_count})
                </button>
              );
            })}
            {hasMore && (
              <button
                type="button"
                className="pseudo-token-pill pseudo-token-pill-toggle"
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded
                  ? t('nav:pseudoToolbar.showLess')
                  : t('nav:pseudoToolbar.showMore', { count: sortedCategories.length - VISIBLE_THRESHOLD })}
              </button>
            )}
            {activeCategories.length > 0 && (
              <button
                type="button"
                className="pseudo-token-pill pseudo-token-pill-clear"
                onClick={onClearCategories}
              >
                {t('nav:pseudoToolbar.clearFilters')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
