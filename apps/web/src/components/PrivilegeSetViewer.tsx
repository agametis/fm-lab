import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApiLang } from '../hooks/useApiLang';
import { useCalcTokens } from '../hooks/useCalcTokens';
import { HighlightRefContext } from '../script/highlightContext';
import { CalcTokenSpan } from './CalcTokenSpan';
import { buildObjectPath } from '../lib/navigation';
import './CustomFunctionViewer.css';
import './PrivilegeSetViewer.css';

/**
 * Eine Zeile der PrivilegeSet-Detail-Projektion (object_details_privilegeset.sql).
 * `section` diskriminiert: meta | record | field | object.
 */
export interface PrivilegeSetRow {
  section: 'meta' | 'record' | 'field' | 'object';
  label: string | null;
  sub_label: string | null;
  access_mode: string | null;
  calculation_text: string | null;
  context_to: string | null;
  ddr_hash: string | null;
  item_type: string | null;
  fields_access: string | null;
  records_access: string | null;
  target_uuid: string | null;
}

interface PrivilegeSetViewerProps {
  data: Array<Record<string, unknown>>;
  objectName?: string | null;
  fileName?: string | null;
  highlightRefUuids?: Set<string> | null;
}

/** Normalisiert die generischen Detail-Zeilen in das typisierte Row-Format. */
function asRows(data: Array<Record<string, unknown>>): PrivilegeSetRow[] {
  return data.map((r) => ({
    section: (r.section as PrivilegeSetRow['section']) ?? 'meta',
    label: (r.label as string) ?? null,
    sub_label: (r.sub_label as string) ?? null,
    access_mode: (r.access_mode as string) ?? null,
    calculation_text: (r.calculation_text as string) ?? null,
    context_to: (r.context_to as string) ?? null,
    ddr_hash: (r.ddr_hash as string) ?? null,
    item_type: (r.item_type as string) ?? null,
    fields_access: (r.fields_access as string) ?? null,
    records_access: (r.records_access as string) ?? null,
    target_uuid: (r.target_uuid as string) ?? null,
  }));
}

/** Access-Mode-Badge mit modus-spezifischer CSS-Klasse. */
const AccessBadge: React.FC<{ mode: string | null }> = ({ mode }) => {
  if (!mode) return <span className="fm-acc-badge fm-acc--unknown">—</span>;
  const slug = mode.toLowerCase().replace(/[^a-z]/g, '');
  return <span className={`fm-acc-badge fm-acc--${slug}`}>{mode}</span>;
};

/**
 * Formel-Zelle einer Record-Access-Regel mit Access_Mode='Calculation'.
 * Lädt die typisierte Token-Sequenz per DDR-Hash (generischer /api/get-calc-
 * Service) und rendert sie klickbar via CalcTokenSpan. Fallback (kein DDR,
 * Ladefehler, noch ladend): der Klartext aus PrivilegeSetRecordAccess.
 */
const RecordCalcFormula: React.FC<{ hash: string | null; fallback: string | null }> = ({ hash, fallback }) => {
  const lang = useApiLang();
  const { data, error } = useCalcTokens(hash, lang);

  if (hash && data && data.tokens && data.tokens.length > 0 && !error) {
    return (
      <code className="fm-ps-formula">
        {data.tokens.map((tok, idx) => (
          <CalcTokenSpan key={idx} token={tok} />
        ))}
      </code>
    );
  }
  // DDR-unabhängiger Fallback: immer der Klartext.
  return <code className="fm-ps-formula fm-ps-formula--plain">{fallback ?? '—'}</code>;
};

/**
 * Detail-Renderer für ein Privilege Set: Standard-Rechte (meta) plus die drei
 * Custom-Access-Ebenen. Die Record-Ebene zeigt bei Access_Mode='Calculation'
 * die Formel (klickbare Token + Auswertungskontext), sonst einen Access-Badge.
 */
export const PrivilegeSetViewer: React.FC<PrivilegeSetViewerProps> = ({
  data,
  objectName,
  fileName,
  highlightRefUuids,
}) => {
  const { t } = useTranslation(['detail']);
  const { uuid: currentUuid } = useParams<{ uuid: string }>();
  const rows = asRows(data);

  const meta = rows.filter((r) => r.section === 'meta');
  const record = rows.filter((r) => r.section === 'record');
  const field = rows.filter((r) => r.section === 'field');
  const object = rows.filter((r) => r.section === 'object');

  const nameLink = (label: string | null, uuid: string | null) => {
    if (label && uuid) {
      return (
        <Link to={buildObjectPath(uuid, currentUuid ?? null)} className="fm-ps-ref">
          {label}
        </Link>
      );
    }
    return <span>{label ?? '—'}</span>;
  };

  return (
    <HighlightRefContext.Provider value={highlightRefUuids ?? null}>
      <div className="fm-privilegeset" aria-label={t('detail:privilegeSet.ariaLabel', { defaultValue: 'Privilege Set Details' }) as string}>
        <div className="fm-customfunction-header">
          <h2 className="type-detail-heading">{objectName ?? t('detail:privilegeSet.heading', { defaultValue: 'Privilege Set' })}</h2>
          {fileName && <span className="fm-customfunction-meta">{fileName}</span>}
        </div>

        {/* ── Standard-Rechte ── */}
        {meta.length > 0 && (
          <dl className="fm-ps-meta">
            {meta.map((m, i) => (
              <React.Fragment key={i}>
                <dt>{m.label}</dt>
                <dd>{m.sub_label ?? '—'}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}

        {/* ── Custom Record Privileges (Tabellen-Ebene) ── */}
        {record.length > 0 && (
          <section className="fm-ps-section">
            <h3 className="fm-ps-section-title">
              {t('detail:privilegeSet.recordAccess', { defaultValue: 'Custom Record Privileges' })}
            </h3>
            <table className="fm-ps-table">
              <thead>
                <tr>
                  <th>{t('detail:privilegeSet.colTable', { defaultValue: 'Table' })}</th>
                  <th>{t('detail:privilegeSet.colOperation', { defaultValue: 'Operation' })}</th>
                  <th>{t('detail:privilegeSet.colAccess', { defaultValue: 'Access' })}</th>
                  <th>{t('detail:privilegeSet.colFormula', { defaultValue: 'Formula / Context' })}</th>
                </tr>
              </thead>
              <tbody>
                {record.map((r, i) => (
                  <tr key={i}>
                    <td>{nameLink(r.label, r.target_uuid)}</td>
                    <td className="fm-ps-op">{r.sub_label}</td>
                    <td><AccessBadge mode={r.access_mode} /></td>
                    <td>
                      {r.access_mode === 'Calculation' ? (
                        <div className="fm-ps-calc-cell">
                          <RecordCalcFormula hash={r.ddr_hash} fallback={r.calculation_text} />
                          {r.context_to && (
                            <span className="fm-ps-context" title={t('detail:privilegeSet.evalContext', { defaultValue: 'Evaluation context' }) as string}>
                              ⟮{r.context_to}⟯
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="fm-ps-dash">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── Custom Field Privileges ── */}
        {field.length > 0 && (
          <section className="fm-ps-section">
            <h3 className="fm-ps-section-title">
              {t('detail:privilegeSet.fieldAccess', { defaultValue: 'Custom Field Privileges' })}
            </h3>
            <table className="fm-ps-table">
              <thead>
                <tr>
                  <th>{t('detail:privilegeSet.colTable', { defaultValue: 'Table' })}</th>
                  <th>{t('detail:privilegeSet.colField', { defaultValue: 'Field' })}</th>
                  <th>{t('detail:privilegeSet.colAccess', { defaultValue: 'Access' })}</th>
                </tr>
              </thead>
              <tbody>
                {field.map((r, i) => (
                  <tr key={i}>
                    <td>{r.sub_label ?? '—'}</td>
                    <td>{nameLink(r.label, r.target_uuid)}</td>
                    <td><AccessBadge mode={r.access_mode} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── Custom Object Privileges (Layouts/ValueLists/Scripts) ── */}
        {object.length > 0 && (
          <section className="fm-ps-section">
            <h3 className="fm-ps-section-title">
              {t('detail:privilegeSet.objectAccess', { defaultValue: 'Custom Layout / Value List / Script Privileges' })}
            </h3>
            <table className="fm-ps-table">
              <thead>
                <tr>
                  <th>{t('detail:privilegeSet.colClass', { defaultValue: 'Class' })}</th>
                  <th>{t('detail:privilegeSet.colObject', { defaultValue: 'Object' })}</th>
                  <th>{t('detail:privilegeSet.colAccess', { defaultValue: 'Access' })}</th>
                  <th>{t('detail:privilegeSet.colRecordsAccess', { defaultValue: 'Records' })}</th>
                </tr>
              </thead>
              <tbody>
                {object.map((r, i) => (
                  <tr key={i}>
                    <td className="fm-ps-op">{r.sub_label}</td>
                    <td>{nameLink(r.label, r.target_uuid)}</td>
                    <td><AccessBadge mode={r.access_mode} /></td>
                    <td>{r.records_access ? <AccessBadge mode={r.records_access} /> : <span className="fm-ps-dash">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </HighlightRefContext.Provider>
  );
};
