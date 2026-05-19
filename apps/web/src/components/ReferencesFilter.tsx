import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  typeCounts: Map<string, number>;
  activeTypes: Set<string>;
  onToggleType: (type: string) => void;
  onClearTypes: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  onJumpToList?: (direction: 'first' | 'last') => void;
};

/**
 * Toolbar oberhalb der Referenz-Liste. Suchfeld + Typ-Filter-Pillen
 * orientieren sich am Verhalten von LayoutTypeFilter und
 * RelationshipGraph-Suche: ESC leert die Eingabe; Pillen sind
 * Mehrfachauswahl mit OR-Verknüpfung.
 */
export function ReferencesFilter({
  typeCounts,
  activeTypes,
  onToggleType,
  onClearTypes,
  query,
  onQueryChange,
  matchCount,
  totalCount,
  onJumpToList,
}: Props) {
  const { t, i18n } = useTranslation(['detail']);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sort by count descending, then alphabetically — the most frequent type
  // ends up on the left and is the quickest to reach.
  const sortedTypes = useMemo(() => {
    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], i18n.language));
  }, [typeCounts, i18n.language]);

  const hasAnyActive = activeTypes.size > 0;
  const filterActive = hasAnyActive || query !== '';

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // ESC bewusst NICHT lokal abfangen — der globale ESC-Stack auf View-Ebene
    // (siehe useEscapeStack in DetailView) regelt die Stufenlogik
    // (Suchfeld leeren → Filter leeren → Zurück).
    if (e.key === 'ArrowDown' && onJumpToList) {
      e.preventDefault();
      onJumpToList('first');
    } else if (e.key === 'ArrowUp' && onJumpToList) {
      e.preventDefault();
      onJumpToList('last');
    }
  };

  return (
    <div className="references-filter">
      <div className="references-filter-search">
        <input
          ref={inputRef}
          type="search"
          placeholder={t('detail:referencesFilter.searchPlaceholder') as string}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          title={t('detail:referencesFilter.searchTitle') as string}
          aria-label={t('detail:referencesFilter.searchAria') as string}
        />
        {filterActive && (
          <span className="references-filter-count">
            {matchCount} / {totalCount}
          </span>
        )}
      </div>
      {sortedTypes.length > 0 && (
        <div className="references-filter-pills">
          {sortedTypes.map(([type, count]) => {
            const active = activeTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                className={`references-filter-pill${active ? ' active' : ''}`}
                onClick={() => onToggleType(type)}
                title={`${type} (${count})`}
              >
                {type}
                <span className="references-filter-pill-count">({count})</span>
              </button>
            );
          })}
          {hasAnyActive && (
            <button
              type="button"
              className="references-filter-link"
              onClick={onClearTypes}
              title={t('detail:referencesFilter.clearTypesTitle') as string}
            >
              {t('detail:referencesFilter.clearTypesLabel')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
