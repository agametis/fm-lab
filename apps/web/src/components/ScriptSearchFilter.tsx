import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RefType } from '../script/types';

type Props = {
  typeCounts: Map<RefType, number>;
  activeTypes: Set<RefType>;
  onToggleType: (type: RefType) => void;
  onClearTypes: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  /** Optionale Pseudo-Pill für Kommentar-Zeilen (kein RefType, daher separat). */
  commentPill?: {
    count: number;
    active: boolean;
    onToggle: () => void;
  };
};

/**
 * Filterleiste unterhalb des Script-Viewer-Headers — analog zu
 * ReferencesFilter (DetailView) und LayoutTypeFilter. Nutzt die globalen
 * `.references-filter*`-Klassen aus DetailView.css für identisches Look-and-Feel.
 *
 * Match-Logik (im ScriptViewer aufgebaut):
 *   - Aktive Typ-Pillen filtern Refs auf RefType-Match (OR-Verknüpfung)
 *   - Sucheingabe matched case-insensitive auf den Ref-Namen
 *   - Ohne Filter ist das Predicate `null` — keine Highlights
 */
export function ScriptSearchFilter({
  typeCounts,
  activeTypes,
  onToggleType,
  onClearTypes,
  query,
  onQueryChange,
  matchCount,
  totalCount,
  commentPill,
}: Props) {
  const { t, i18n } = useTranslation(['detail']);
  const inputRef = useRef<HTMLInputElement>(null);
  const typeLabel = (rt: RefType) => t(`detail:scriptSearchFilter.typeLabels.${rt}`, { defaultValue: rt }) as string;

  // Sort by count descending, then alphabetically by label. Same as
  // ReferencesFilter — most frequent type first.
  const sortedTypes = useMemo(() => {
    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1] || typeLabel(a[0]).localeCompare(typeLabel(b[0]), i18n.language));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeCounts, i18n.language]);

  const hasAnyActive = activeTypes.size > 0 || (commentPill?.active ?? false);
  const filterActive = hasAnyActive || query !== '';

  return (
    <div className="references-filter fm-script-search">
      <div className="references-filter-search">
        <input
          ref={inputRef}
          type="search"
          placeholder={t('detail:scriptSearchFilter.searchPlaceholder') as string}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          aria-label={t('detail:scriptSearchFilter.searchAria') as string}
        />
        {filterActive && (
          <span className="references-filter-count">
            {matchCount} / {totalCount}
          </span>
        )}
      </div>
      {(sortedTypes.length > 0 || commentPill) && (
        <div className="references-filter-pills">
          {sortedTypes.map(([type, count]) => {
            const active = activeTypes.has(type);
            const label = typeLabel(type);
            return (
              <button
                key={type}
                type="button"
                className={`references-filter-pill${active ? ' active' : ''}`}
                onClick={() => onToggleType(type)}
                title={`${label} (${count})`}
              >
                {label}
                <span className="references-filter-pill-count">({count})</span>
              </button>
            );
          })}
          {commentPill && (
            <button
              key="__comment"
              type="button"
              className={`references-filter-pill${commentPill.active ? ' active' : ''}`}
              onClick={commentPill.onToggle}
              title={t('detail:scriptSearchFilter.commentTitle', { count: commentPill.count }) as string}
            >
              {t('detail:scriptSearchFilter.commentLabel')}
              <span className="references-filter-pill-count">({commentPill.count})</span>
            </button>
          )}
          {hasAnyActive && (
            <button
              type="button"
              className="references-filter-link"
              onClick={onClearTypes}
              title={t('detail:scriptSearchFilter.clearTitle') as string}
            >
              {t('detail:scriptSearchFilter.clearLabel')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
