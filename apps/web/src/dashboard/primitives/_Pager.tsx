import { useTranslation } from 'react-i18next';

/**
 * Pager of a server-paged list (Table, AutoTable): previous · "page / pages" ·
 * next. Rendered twice — in the count bar above the list and below it — so a
 * long page (500 rows) can be left from either end without scrolling.
 * Renders nothing for a single page.
 */
export function Pager({
  page,
  pageCount,
  onGo,
  position,
}: {
  page: number;
  pageCount: number;
  onGo: (page: number) => void;
  position: 'top' | 'bottom';
}) {
  const { t } = useTranslation(['detail']);
  if (pageCount <= 1) return null;
  return (
    <div className={`dash-autotable__pager dash-autotable__pager--${position}`}>
      <button type="button" onClick={() => onGo(page - 1)} disabled={page <= 1}>
        {t('detail:autoTable.prev')}
      </button>
      <span>{page} / {pageCount}</span>
      <button type="button" onClick={() => onGo(page + 1)} disabled={page >= pageCount}>
        {t('detail:autoTable.next')}
      </button>
    </div>
  );
}
