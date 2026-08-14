import { useTranslation } from 'react-i18next';
import { isPlugSpecMissingError } from '../../lib/errors';
import type { PrimitiveProps } from '../types';

/**
 * Card — frame with optional title.
 * Spans `span` columns in the enclosing grid (via CSS grid-column).
 */
export function Card({ node, dataset, renderChildren }: PrimitiveProps) {
  const { t } = useTranslation();
  const props = node.props ?? {};
  const span = (props.span as number) ?? 12;
  const title = props.title as string | undefined;
  const subtitle = props.subtitle as string | undefined;
  const variant = props.variant as string | undefined;

  const style: React.CSSProperties = {
    gridColumn: `span ${Math.min(Math.max(span, 1), 12)} / span ${Math.min(Math.max(span, 1), 12)}`,
  };

  // Für Container, die mit einem Single-Row-Dataset gebunden sind, liefern wir
  // die erste Zeile als row an die Children — KPIStrip etc. iterieren über
  // Felder dieser Row.
  const singleRow = dataset?.data?.[0];
  const datasetError = dataset?.error;

  // NavTiles sollen sich nicht selbst ausblenden, wenn das gebundene Dataset
  // leer ist (z.B. `nav_dashboards` ohne weitere Bundles) — der NavButton zeigt
  // dann eben `0` an, aber bleibt klickbar.
  const suppressEmpty = variant === 'navtile';
  const datasetIsEmpty =
    !suppressEmpty && dataset && (dataset.data?.length ?? 0) === 0;

  return (
    <section
      className={`dash-card${variant ? ` dash-card--${variant}` : ''}`}
      style={style}
    >
      {(title || subtitle) && (
        <header className="dash-card__head">
          {title && <h2 className="dash-card__title">{title}</h2>}
          {subtitle && <p className="dash-card__subtitle">{subtitle}</p>}
        </header>
      )}
      <div className="dash-card__body">
        {datasetError && isPlugSpecMissingError(datasetError) && (
          // Fehlende Plugin-Referenz-DB ist ein Installationszustand, kein
          // Fehler der Karte — ruhige Notiz statt rotem Raw-Error.
          <div className="dash-card__empty">{t('plugSpecMissing')}</div>
        )}
        {datasetError && !isPlugSpecMissingError(datasetError) && (
          <div className="dash-card__error">{t('loadError', { message: datasetError })}</div>
        )}
        {!datasetError && datasetIsEmpty && (
          <div className="dash-card__empty">{t('noData')}</div>
        )}
        {!datasetError && !datasetIsEmpty && renderChildren(node.children, singleRow)}
      </div>
    </section>
  );
}
