import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { buildObjectPath } from '../lib/navigation';
import './ValueListViewer.css';

/**
 * Zeilen der ValueList-Detail-Projektion (object_details_valuelist.sql).
 * `section` diskriminiert: 'meta' | 'custom_value' | 'field_source' | 'external_source'.
 * Alle Spalten sind in jeder Zeile vorhanden (NULL wo nicht zutreffend).
 */
export interface ValueListRow {
  section: 'meta' | 'custom_value' | 'field_source' | 'external_source';
  seq: number | null;
  value: string | null;
  vl_name: string | null;
  source_type: string | null;
  file_name: string | null;
  vl_uuid: string | null;
  vl_id: number | null;
  to_name: string | null;
  to_uuid: string | null;
  field_name: string | null;
  field_uuid: string | null;
  secondary_to_name: string | null;
  secondary_to_uuid: string | null;
  secondary_field_name: string | null;
  secondary_field_uuid: string | null;
  field_sort: boolean | null;
  secondary_sort: boolean | null;
  external_ds_name: string | null;
  external_ds_uuid: string | null;
  external_ds_file: string | null;
  external_vl_name: string | null;
  target_vl_uuid: string | null;
  target_vl_file: string | null;
  to_file: string | null;
  field_file: string | null;
  secondary_to_file: string | null;
  secondary_field_file: string | null;
}

interface ValueListViewerProps {
  data: Array<Record<string, unknown>>;
}

/**
 * Strukturierter Detail-View einer Werteliste.
 *  - Custom Values → HTML-Tabelle (jeder Wert eine eigene, einheitlich
 *    formatierte Zeile — löst den „nur der erste Wert hat ein '-'-Präfix"-Bug).
 *  - Field Source  → klickbare Chunks: Quell-TO, Quell-Feld, optionales
 *    zweites Anzeige-Feld.
 *  - External      → klickbare Chunks: Datenquelle + Ziel-Werteliste der
 *    anderen Datei.
 */
export const ValueListViewer: React.FC<ValueListViewerProps> = ({ data }) => {
  const { t } = useTranslation(['detail', 'common']);
  const { uuid: currentUuid } = useParams<{ uuid: string }>();

  const meta = data.find((r) => r.section === 'meta') as unknown as ValueListRow | undefined;
  const customValues = data.filter((r) => r.section === 'custom_value') as unknown as ValueListRow[];
  const fieldSrc = data.find((r) => r.section === 'field_source') as unknown as ValueListRow | undefined;
  const externalSrc = data.find((r) => r.section === 'external_source') as unknown as ValueListRow | undefined;

  // Sortierung der Custom-Values-Tabelle über die Spaltenköpfe (# | Wert).
  // Default: nach Sequenz aufsteigend (Reihenfolge im FileMaker-Dialog).
  const [sortKey, setSortKey] = useState<'seq' | 'value'>('seq');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: 'seq' | 'value') => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
  const sortedValues = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...customValues].sort((a, b) => {
      if (sortKey === 'seq') return ((a.seq ?? 0) - (b.seq ?? 0)) * dir;
      // Wert: locale-bewusster, groß/klein-toleranter Vergleich (numerische Werte
      // wie „3/4/7" korrekt reihen); Gleichstand nach Sequenz stabilisieren.
      const cmp = (a.value ?? '').localeCompare(b.value ?? '', undefined, { numeric: true, sensitivity: 'base' });
      return (cmp !== 0 ? cmp : (a.seq ?? 0) - (b.seq ?? 0)) * dir;
    });
  }, [customValues, sortKey, sortDir]);

  if (!meta) return <div className="no-references">{t('common:noData')}</div>;

  const sortIndicator = (key: 'seq' | 'value') =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // Klickbarer Chunk auf ein Zielobjekt (TO/Feld/Werteliste/Datenquelle).
  // Fehlt die UUID (z.B. unaufgelöste externe Referenz) → nicht klickbarer Chip.
  const chunk = (
    label: string | null,
    uuid: string | null,
    kind: string,
    file?: string | null,
  ) => {
    const cls = `fm-vl-chunk fm-vl-chunk--${kind}`;
    if (label && uuid) {
      return (
        <Link to={buildObjectPath(uuid, currentUuid ?? null, file ?? null)} className={cls}>
          {label}
        </Link>
      );
    }
    return <span className={cls}>{label ?? '—'}</span>;
  };

  return (
    <div className="object-detail fm-vl" aria-label={t('detail:valueList.ariaLabel', { defaultValue: 'Wertelisten-Details' }) as string}>
      <h2 className="type-detail-heading">{meta.vl_name}</h2>

      {/* ── Metadaten ── */}
      <dl className="fm-vl-meta">
        <dt>{t('detail:valueList.metaName', { defaultValue: 'Name' })}</dt><dd>{meta.vl_name}</dd>
        <dt>{t('detail:valueList.metaSourceType', { defaultValue: 'Quelltyp' })}</dt><dd>{meta.source_type}</dd>
        <dt>{t('detail:valueList.metaFile', { defaultValue: 'Datei' })}</dt><dd>{meta.file_name}</dd>
        <dt>UUID</dt><dd>{meta.vl_uuid}</dd>
        <dt>ID</dt><dd>{meta.vl_id}</dd>
      </dl>

      {/* ── Custom Values als Tabelle ── */}
      {customValues.length > 0 && (
        <section className="fm-vl-section">
          <h3 className="fm-vl-section-head">
            {t('detail:valueList.customValues', { defaultValue: 'Eigene Werte' })}
            <span className="fm-vl-count"> ({customValues.length})</span>
          </h3>
          <table className="fm-vl-table fm-vl-table--sortable">
            <thead>
              <tr>
                <th
                  className="fm-vl-col-idx fm-vl-th-sort"
                  aria-sort={sortKey === 'seq' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => toggleSort('seq')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('seq'); } }}
                  tabIndex={0}
                  role="columnheader"
                >
                  #{sortIndicator('seq')}
                </th>
                <th
                  className="fm-vl-th-sort"
                  aria-sort={sortKey === 'value' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => toggleSort('value')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('value'); } }}
                  tabIndex={0}
                  role="columnheader"
                >
                  {t('detail:valueList.colValue', { defaultValue: 'Wert' })}{sortIndicator('value')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedValues.map((cv) => (
                <tr key={cv.seq ?? cv.value}>
                  <td className="fm-vl-col-idx">{cv.seq}</td>
                  <td className={cv.value === '' ? 'fm-vl-empty-value' : undefined}>
                    {cv.value === '' ? t('detail:valueList.emptyValue', { defaultValue: '(Leerzeile)' }) : cv.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Field Source (klickbare Chunks) ── */}
      {fieldSrc && (
        <section className="fm-vl-section">
          <h3 className="fm-vl-section-head">{t('detail:valueList.fieldSource', { defaultValue: 'Feldbasierte Werte' })}</h3>
          <dl className="fm-vl-source">
            <dt>{t('detail:valueList.sourceTable', { defaultValue: 'Tabellenauftreten' })}</dt>
            <dd>{chunk(fieldSrc.to_name, fieldSrc.to_uuid, 'to', fieldSrc.to_file)}</dd>
            <dt>{t('detail:valueList.sourceField', { defaultValue: 'Feld' })}</dt>
            <dd>
              {chunk(fieldSrc.field_name, fieldSrc.field_uuid, 'field', fieldSrc.field_file)}
              {fieldSrc.field_sort && <span className="fm-vl-flag"> · {t('detail:valueList.sorted', { defaultValue: 'sortiert' })}</span>}
            </dd>
            {(fieldSrc.secondary_field_name || fieldSrc.secondary_to_name) && (
              <>
                <dt>{t('detail:valueList.secondaryField', { defaultValue: 'Zweites Feld (Anzeige)' })}</dt>
                <dd>
                  {fieldSrc.secondary_to_name && fieldSrc.secondary_to_uuid
                    && fieldSrc.secondary_to_uuid !== fieldSrc.to_uuid && (
                    <>{chunk(fieldSrc.secondary_to_name, fieldSrc.secondary_to_uuid, 'to', fieldSrc.secondary_to_file)}{' · '}</>
                  )}
                  {chunk(fieldSrc.secondary_field_name, fieldSrc.secondary_field_uuid, 'field', fieldSrc.secondary_field_file)}
                  {fieldSrc.secondary_sort && <span className="fm-vl-flag"> · {t('detail:valueList.sorted', { defaultValue: 'sortiert' })}</span>}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* ── External Source (klickbare Chunks) ── */}
      {externalSrc && (
        <section className="fm-vl-section">
          <h3 className="fm-vl-section-head">{t('detail:valueList.externalSource', { defaultValue: 'Externe Werteliste' })}</h3>
          <dl className="fm-vl-source">
            <dt>{t('detail:valueList.dataSource', { defaultValue: 'Datenquelle' })}</dt>
            <dd>{chunk(externalSrc.external_ds_name, externalSrc.external_ds_uuid, 'datasource', externalSrc.external_ds_file)}</dd>
            <dt>{t('detail:valueList.targetValueList', { defaultValue: 'Werteliste (in Quelldatei)' })}</dt>
            <dd>{chunk(externalSrc.external_vl_name, externalSrc.target_vl_uuid, 'valuelist', externalSrc.target_vl_file)}</dd>
          </dl>
        </section>
      )}
    </div>
  );
};
