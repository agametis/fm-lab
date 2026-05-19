import React from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@packages/shared/types';
import { Slot } from '../plugins';

type FMObject = components['schemas']['FMObject'];

// PRD prd_pseudo_object_types_filter.md §8.3 — optionale Pseudo-Token-Felder,
// vom /api/list-Endpoint mit ?with_usage=true / ?with_category=true geliefert.
// Da der generierte FMObject-Typ diese Spalten nicht kennt, indizieren wir
// lose über das ursprüngliche Object.
type FMObjectWithAggregates = FMObject & {
  usage_count?: number;
  category?: string | null;
  category_id?: number | null;
  is_get_subparam?: boolean;
};

interface ObjectListItemProps {
  object: FMObject;
  style?: React.CSSProperties;
  onClick?: (uuid: string) => void;
  // Wenn gesetzt, klick auf die Category-Pille toggelt diesen Wert in der
  // übergeordneten Filter-Toolbar (PRD §8.3).
  onCategoryClick?: (category: string) => void;
}

/**
 * Object List Item Component
 * Renders a single FileMaker object in the virtual list.
 * Plugins contribute quick-actions via the `objectListItemActions` slot.
 */
export const ObjectListItem: React.FC<ObjectListItemProps> = ({ object, style, onClick, onCategoryClick }) => {
  const { t } = useTranslation(['detail']);
  const aggObject = object as FMObjectWithAggregates;
  const noName = t('detail:objectListItem.noName') as string;
  const handleClick = () => {
    onClick?.(object.Object_UUID);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const hasUsage = typeof aggObject.usage_count === 'number';
  const hasCategory = aggObject.category != null && aggObject.category !== '';

  return (
    <div style={style} className="object-list-item-wrapper">
      <div
        className="object-list-item"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={t('detail:objectListItem.showAria', {
          type: object.Object_Type,
          name: object.Object_Name || noName,
        }) as string}
      >
        <div className="object-header">
          <strong className="object-name">
            {object.Object_Name || noName}
          </strong>
          {hasCategory && (
            <span
              className="object-category-pill"
              role={onCategoryClick ? 'button' : undefined}
              tabIndex={onCategoryClick ? 0 : -1}
              onClick={(e) => {
                if (!onCategoryClick) return;
                e.stopPropagation();
                onCategoryClick(aggObject.category as string);
              }}
              onKeyDown={(e) => {
                if (!onCategoryClick) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onCategoryClick(aggObject.category as string);
                }
              }}
              title={onCategoryClick
                ? (t('detail:objectListItem.filterByCategory', { category: aggObject.category }) as string)
                : (aggObject.category as string)}
            >
              {aggObject.category}
            </span>
          )}
          <span className="object-type">
            {object.Object_Type}
          </span>
          {hasUsage && (
            <span className="object-usage-badge" title={t('detail:objectListItem.usageBadge', { count: aggObject.usage_count }) as string}>
              {aggObject.usage_count}
            </span>
          )}
          <Slot
            name="objectListItemActions"
            objectUuid={object.Object_UUID}
            objectType={object.Object_Type}
            objectName={object.Object_Name || ''}
            fileName={object.File_Name || ''}
          />
        </div>
        {object.File_Name && (
          <div className="object-details">
            <small>{object.File_Name}</small>
          </div>
        )}
      </div>
    </div>
  );
};
