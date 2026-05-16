import { useMemo, useRef } from 'react';
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
 * Anzeige-Labels pro RefType — analog zur Layout-/Referenzen-Filterleiste.
 * Bewusst sprechende deutsche Begriffe statt der raw camelCase-RefType-Werte,
 * damit die Pills im UI lesbar bleiben.
 */
const TYPE_LABELS: Record<RefType, string> = {
  field:           'Feld',
  script:          'Script',
  layout:          'Layout',
  customFunction:  'Custom Function',
  pluginFunction:  'Plugin-Funktion',
  function:        'Funktion',
  variable:        'Variable',
  valueList:       'Werteliste',
  tableOccurrence: 'TableOccurrence',
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Sortierung: nach Anzahl absteigend, dann alphabetisch nach Label.
  // Konsistent mit ReferencesFilter — häufigster Typ links.
  const sortedTypes = useMemo(() => {
    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1] || TYPE_LABELS[a[0]].localeCompare(TYPE_LABELS[b[0]]));
  }, [typeCounts]);

  const hasAnyActive = activeTypes.size > 0 || (commentPill?.active ?? false);
  const filterActive = hasAnyActive || query !== '';

  return (
    <div className="references-filter fm-script-search">
      <div className="references-filter-search">
        <input
          ref={inputRef}
          type="search"
          placeholder="Refs durchsuchen…"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          aria-label="Refs durchsuchen"
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
            return (
              <button
                key={type}
                type="button"
                className={`references-filter-pill${active ? ' active' : ''}`}
                onClick={() => onToggleType(type)}
                title={`${TYPE_LABELS[type]} (${count})`}
              >
                {TYPE_LABELS[type]}
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
              title={`Kommentar (${commentPill.count})`}
            >
              Kommentar
              <span className="references-filter-pill-count">({commentPill.count})</span>
            </button>
          )}
          {hasAnyActive && (
            <button
              type="button"
              className="references-filter-link"
              onClick={onClearTypes}
              title="Alle Typ-Filter aufheben"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
