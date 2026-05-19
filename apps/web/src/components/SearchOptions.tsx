import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SortOption, GroupOption } from '../types';

interface SearchOptionsProps {
  sortBy: SortOption;
  groupBy: GroupOption;
  onSortChange: (sort: SortOption) => void;
  onGroupChange: (group: GroupOption) => void;
}

const SORT_VALUES: { value: SortOption; key: string }[] = [
  { value: 'standard', key: 'sortStandard' },
  { value: 'name',     key: 'sortName' },
  { value: 'type',     key: 'sortType' },
  { value: 'file',     key: 'sortFile' },
];

const GROUP_VALUES: { value: GroupOption; key: string }[] = [
  { value: 'none', key: 'groupNone' },
  { value: 'type', key: 'groupType' },
  { value: 'file', key: 'groupFile' },
];

export const SearchOptions: React.FC<SearchOptionsProps> = ({
  sortBy,
  groupBy,
  onSortChange,
  onGroupChange,
}) => {
  const { t } = useTranslation(['detail']);
  return (
    <div className="search-options-panel" role="region" aria-label={t('detail:searchOptions.regionAria') as string}>
      <fieldset className="search-options-fieldset">
        <legend>{t('detail:searchOptions.sortLabel')}</legend>
        {SORT_VALUES.map(({ value, key }) => (
          <label key={value} className="search-options-radio">
            <input
              type="radio"
              name="sort"
              value={value}
              checked={sortBy === value}
              onChange={() => onSortChange(value)}
            />
            {t(`detail:searchOptions.${key}`)}
          </label>
        ))}
      </fieldset>
      <fieldset className="search-options-fieldset">
        <legend>{t('detail:searchOptions.groupLabel')}</legend>
        {GROUP_VALUES.map(({ value, key }) => (
          <label key={value} className="search-options-radio">
            <input
              type="radio"
              name="group"
              value={value}
              checked={groupBy === value}
              onChange={() => onGroupChange(value)}
            />
            {t(`detail:searchOptions.${key}`)}
          </label>
        ))}
      </fieldset>
    </div>
  );
};
