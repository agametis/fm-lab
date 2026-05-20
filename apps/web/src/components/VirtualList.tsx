import React, { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { VirtualListRow } from '../types';
import { ObjectListItem } from './ObjectListItem';
import { LoadingSpinner } from './LoadingSpinner';

const ITEM_HEIGHT = 80;
const HEADER_HEIGHT = 44;

interface VirtualListProps {
  rows: VirtualListRow[];
  itemCount: number;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  totalCount: number | null;
  onItemClick?: (uuid: string) => void;
  onToggleGroup?: (groupKey: string) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  // Aktueller Volltext-Suchbegriff (vor Wildcard-Expansion). Wird an
  // ObjectListItem weitergereicht für das Highlighting der Treffer im
  // Step_Text bei ScriptStep-Ergebnissen.
  searchTerm?: string;
}

/**
 * Virtual List Component
 * Renders a virtualized list with infinite scrolling
 *
 * Features:
 * - Only renders visible items (performance optimization)
 * - Auto-loads more when scrolling near bottom
 * - Supports group headers when grouping is active
 * - Loading indicator at bottom
 */
export const VirtualList: React.FC<VirtualListProps> = ({
  rows,
  itemCount,
  isLoading,
  hasMore,
  onLoadMore,
  totalCount,
  onItemClick,
  onToggleGroup,
  scrollContainerRef,
  searchTerm,
}) => {
  const { t } = useTranslation(['nav']);
  const internalRef = useRef<HTMLDivElement>(null);
  const parentRef = scrollContainerRef || internalRef;

  // Initialize virtualizer with dynamic row heights
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rows[index]._type === 'header' ? HEADER_HEIGHT : ITEM_HEIGHT,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Auto-load more when scrolled near bottom
  useEffect(() => {
    const [lastItem] = [...virtualItems].reverse();

    if (!lastItem) return;

    // Trigger load when within last 20 rows
    if (lastItem.index >= rows.length - 20 && hasMore && !isLoading) {
      onLoadMore();
    }
  }, [virtualItems, rows.length, hasMore, isLoading, onLoadMore]);

  return (
    <div
      ref={parentRef}
      className="virtual-list-container"
    >
      {/* Results count header */}
      {totalCount !== null && (
        <div className="virtual-list-header">
          {totalCount.toLocaleString('de-DE')} {totalCount === 1 ? 'Objekt' : 'Objekte'} gefunden
          {itemCount < totalCount && (
            <span className="loaded-count">
              ({itemCount} geladen)
            </span>
          )}
        </div>
      )}

      {/* Virtual list content */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index];
          return (
            <div
              key={row._type === 'header' ? `header-${row.groupKey}` : row.object.Object_UUID}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {row._type === 'header' ? (
                <div
                  className="group-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={row.isExpanded}
                  onClick={() => onToggleGroup?.(row.groupKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggleGroup?.(row.groupKey);
                    }
                  }}
                >
                  <span className="group-header-toggle">
                    {row.isExpanded ? '\u25BE' : '\u25B8'}
                  </span>
                  <span className="group-header-label">
                    {row.groupLabel}
                  </span>
                  <span className="group-header-count">
                    ({row.itemCount})
                  </span>
                </div>
              ) : (
                <ObjectListItem object={row.object} onClick={onItemClick} searchTerm={searchTerm} />
              )}
            </div>
          );
        })}
      </div>

      {/* Loading indicator at bottom */}
      {isLoading && <LoadingSpinner message={t('nav:list.loadingMore') as string} />}

      {/* No more results indicator */}
      {!hasMore && itemCount > 0 && (
        <div className="virtual-list-footer">
          {t('nav:list.allLoaded')}
        </div>
      )}

      {/* Empty state */}
      {itemCount === 0 && !isLoading && (
        <div className="virtual-list-empty">
          {t('nav:list.noObjects')}
        </div>
      )}
    </div>
  );
};
