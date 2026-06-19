import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { PrimitiveProps } from '../types';

/**
 * XmlEmptyStateCard — Hinweis-Karte für das Home-Dashboard, sichtbar nur wenn
 * die DuckDB-Datenbank leer ist (keine importierten Dateien).
 *
 * Liest zwei Datasets aus dem Dashboard:
 *   - project_summary (für den `db_empty`-Marker)
 *   - xml_directory_listing (für die Monospace-Liste der XML-Dateien)
 *
 * Rendert nichts, wenn die DB bereits Inhalte hat — das Layout enthält die
 * Karte also "blind", sie blendet sich selbst ein.
 *
 * Der Button navigiert zu /dashboard/xml_convert?autostart=1, wodurch das
 * Sub-Dashboard die Konvertierung sofort beim Mount startet.
 */
export function XmlEmptyStateCard({ node, datasets }: PrimitiveProps) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const props = node.props ?? {};
  const span = (props.span as number) ?? 12;

  const summary = datasets?.project_summary?.data?.[0] as Record<string, unknown> | undefined;
  const dbEmpty = summary?.db_empty === true
    || summary?.db_empty === 1
    || summary?.file_count == null
    || summary?.file_count === 0;
  if (!dbEmpty) return null;

  const listing = (datasets?.xml_directory_listing?.data ?? []) as Array<Record<string, unknown>>;
  const filenames = listing.map(r => String(r.filename ?? '')).filter(Boolean);
  const directoryEmpty = filenames.length === 0;

  const style: React.CSSProperties = {
    gridColumn: `span ${Math.min(Math.max(span, 1), 12)} / span ${Math.min(Math.max(span, 1), 12)}`,
  };

  const onClick = () => {
    if (directoryEmpty) return;
    // Identisches Verhalten wie der Button im Project-overview-Card:
    // nur Navigation, kein Auto-Start. Der eigentliche Convert-Trigger
    // sitzt ausschließlich im xml_convert-Sub-Dashboard.
    navigate('/dashboard/xml_convert');
  };

  return (
    <section className="dash-card xml-empty-card" style={style}>
      <div className="dash-card__body">
        <p className="xml-empty-card__hint">
          {t('xmlEmpty.hint', {
            defaultValue: 'Es wurden noch keine XML-Dateien importiert.',
          })}
        </p>
        <div className="xml-empty-card__listing" role="region"
             aria-label={t('xmlEmpty.directoryAria', {
               defaultValue: 'Dateien im XML-Verzeichnis',
             }) as string}>
          {directoryEmpty ? (
            <span className="xml-empty-card__listing-empty">
              {t('xmlEmpty.directoryEmpty', {
                defaultValue: 'Keine Dateien im XML-Verzeichnis vorhanden.',
              })}
            </span>
          ) : (
            filenames.map(name => (
              <div key={name} className="xml-empty-card__listing-row">{name}</div>
            ))
          )}
        </div>
        <div className="xml-empty-card__actions">
          <button
            type="button"
            className="xml-convert-btn"
            onClick={onClick}
            disabled={directoryEmpty}
            title={directoryEmpty
              ? (t('xmlEmpty.directoryEmpty', {
                  defaultValue: 'Keine Dateien im XML-Verzeichnis vorhanden.',
                }) as string)
              : undefined}
          >
            {t('xmlConvert.start', { defaultValue: 'XML konvertieren' })}
          </button>
        </div>
      </div>
    </section>
  );
}
