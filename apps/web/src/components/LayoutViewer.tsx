import React, { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LayoutMeta, LayoutTrigger } from '../hooks/useLayoutData';
import { buildObjectPath } from '../lib/navigation';
import './FieldViewer.css';
import './LayoutViewer.css';

interface LayoutViewerProps {
  meta: LayoutMeta;
  triggers: LayoutTrigger[];
  /** Origin-UUID (das betrachtete Layout) für die ref-Navigation zu TO/Script. */
  originUuid?: string;
  /**
   * Cross-Reference Highlight: kam die Navigation per `?ref=trig_<id>_…` von einem
   * Script hierher, steht die synthetische Trigger-UUID im Set — der passende
   * Trigger wird hervorgehoben und in den Sichtbereich gescrollt.
   */
  highlightUuids?: Set<string> | null;
}

/** Trigger-IDs aus synthetischen ScriptTrigger-UUIDs (`trig_<id>_…`) im Highlight-Set. */
function highlightedTriggerIds(uuids: Set<string> | null | undefined): Set<number> {
  const ids = new Set<number>();
  if (!uuids) return ids;
  for (const u of uuids) {
    const m = /^trig_(\d+)_/.exec(u);
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

/**
 * Prettify des internen Theme-Namens: "com.filemaker.theme.apex_blue" → "Apex Blue".
 */
function prettyTheme(name: string | null): string | null {
  if (!name) return null;
  const base = name.replace(/^com\.filemaker\.theme\./, '');
  return base
    .split(/[_.]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Kanonischer Trigger-Action-Name → lesbare Beschriftung: "OnRecordLoad" → "On Record Load". */
function humanizeAction(action: string): string {
  return action.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** ISO-Zeitstempel "2026-07-15T14:57:39" → "2026-07-15 14:57" (ohne Sekunden). */
function formatTimestamp(ts: string | null): string | null {
  if (!ts) return null;
  return ts.replace('T', ' ').slice(0, 16);
}

/**
 * Eigenschaften-Panel der Layout-Detailansicht — 2-spaltig:
 *   links  = alle Einzel-Optionen (Kontext-TO, Design, Menüset, Breite, Ansichten,
 *            Standardansicht, Layout-Menü-Sichtbarkeit, Änderungs-Metadaten),
 *   rechts = die aktivierten Script-Trigger mit Link zum hinterlegten Script.
 * Bei zu schmaler Breite kollabieren die Spalten untereinander (CSS auto-fit).
 */
export const LayoutViewer: React.FC<LayoutViewerProps> = ({ meta, triggers, originUuid, highlightUuids }) => {
  const { t } = useTranslation(['detail']);
  const navigate = useNavigate();
  const hlTriggerIds = useMemo(() => highlightedTriggerIds(highlightUuids), [highlightUuids]);
  const firstHlIndex = triggers.findIndex(tr => hlTriggerIds.has(tr.trigger_id));
  const firstHlRef = useRef<HTMLLIElement>(null);
  const hlSig = Array.from(hlTriggerIds).sort().join(',');
  useEffect(() => {
    if (firstHlIndex >= 0 && firstHlRef.current) {
      firstHlRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [hlSig, firstHlIndex]);

  const viewLabel: Record<'Form' | 'List' | 'Table', string> = {
    Form: t('detail:layoutViewer.viewForm') as string,
    List: t('detail:layoutViewer.viewList') as string,
    Table: t('detail:layoutViewer.viewTable') as string,
  };
  const views: Array<{ key: 'Form' | 'List' | 'Table'; available: boolean | null }> = [
    { key: 'Form', available: meta.view_form_available },
    { key: 'List', available: meta.view_list_available },
    { key: 'Table', available: meta.view_table_available },
  ];

  // Echter lokalisierter FileMaker-Anzeigename (z.B. „Apex Blau"); nur wenn nicht
  // vorhanden auf das aus dem internen Namen abgeleitete „Apex Blue" zurückfallen.
  const theme = meta.theme_display?.trim() || prettyTheme(meta.theme_name);
  const baseTheme = prettyTheme(meta.theme_base);
  const menuSet = meta.menuset_name ?? (t('detail:layoutViewer.menuSetDefault') as string);
  const defaultLabel = meta.default_view ? viewLabel[meta.default_view] : '—';
  const yes = t('detail:layoutViewer.yes') as string;
  const no = t('detail:layoutViewer.no') as string;
  const modifiedAt = formatTimestamp(meta.modified_at);

  return (
    <div className="fm-layout-props" aria-label={t('detail:layoutViewer.propertiesHeading') as string}>
      <div className="fm-layout-cols">
        {/* Links: Einzel-Optionen */}
        <dl className="fm-field-props fm-layout-col-left">
          {meta.to_name && (
            <>
              <dt>{t('detail:layoutViewer.contextTable')}</dt>
              <dd>
                {meta.to_uuid ? (
                  <button
                    type="button"
                    className="fm-field-link"
                    onClick={() => navigate(buildObjectPath(meta.to_uuid!, originUuid, meta.file_name))}
                  >
                    {meta.to_name}
                  </button>
                ) : (
                  meta.to_name
                )}
              </dd>
            </>
          )}

          {theme && (
            <>
              <dt>{t('detail:layoutViewer.theme')}</dt>
              <dd>
                {meta.theme_uuid ? (
                  <button
                    type="button"
                    className="fm-field-link"
                    onClick={() => navigate(buildObjectPath(meta.theme_uuid!, originUuid, meta.file_name))}
                  >
                    {theme}
                  </button>
                ) : (
                  theme
                )}
              </dd>
            </>
          )}
          {baseTheme && baseTheme !== theme && (
            <>
              <dt>{t('detail:layoutViewer.baseTheme')}</dt>
              <dd>{baseTheme}</dd>
            </>
          )}

          <dt>{t('detail:layoutViewer.menuSet')}</dt>
          <dd>{menuSet}</dd>

          {meta.width != null && (
            <>
              <dt>{t('detail:layoutViewer.width')}</dt>
              <dd>{meta.width}&nbsp;px</dd>
            </>
          )}

          <dt>{t('detail:layoutViewer.availableViews')}</dt>
          <dd className="fm-layout-views">
            {views.map(v => (
              <span
                key={v.key}
                className={
                  'fm-layout-view-chip' +
                  (v.available ? ' is-available' : ' is-disabled') +
                  (meta.default_view === v.key ? ' is-default' : '')
                }
                title={meta.default_view === v.key ? (t('detail:layoutViewer.defaultView') as string) : undefined}
              >
                {viewLabel[v.key]}
              </span>
            ))}
          </dd>

          <dt>{t('detail:layoutViewer.defaultView')}</dt>
          <dd>{defaultLabel}</dd>

          {meta.is_hidden != null && (
            <>
              <dt>{t('detail:layoutViewer.inLayoutMenus')}</dt>
              <dd>{meta.is_hidden ? no : yes}</dd>
            </>
          )}

          {/* Weitere „Allgemein"-Checkboxen (aus dem <Options>-Bitfeld). */}
          {([
            ['optAutoSave', meta.auto_save_changes],
            ['optFieldFrames', meta.show_field_frames],
            ['optFrameCurrentOnly', meta.frame_current_record_only],
            ['optShowCurrentInList', meta.show_current_record_list],
            ['optQuickFind', meta.quick_find_enabled],
          ] as const).map(([key, val]) => val != null && (
            <React.Fragment key={key}>
              <dt>{t(`detail:layoutViewer.${key}`)}</dt>
              <dd>{val ? yes : no}</dd>
            </React.Fragment>
          ))}

          {meta.modified_by && (
            <>
              <dt>{t('detail:layoutViewer.lastModified')}</dt>
              <dd>
                {meta.modified_by}
                {modifiedAt && <span className="fm-layout-muted"> · {modifiedAt}</span>}
              </dd>
            </>
          )}
        </dl>

        {/* Rechts: aktivierte Script-Trigger */}
        <div className="fm-layout-col-right">
          <div className="fm-layout-triggers-heading">{t('detail:layoutViewer.triggersHeading')}</div>
          {triggers.length === 0 ? (
            <div className="fm-layout-no-triggers">{t('detail:layoutViewer.noTriggers')}</div>
          ) : (
            <ul className="fm-layout-triggers">
              {triggers.map((tr, idx) => {
                const isHl = hlTriggerIds.has(tr.trigger_id);
                const isFirstHl = idx === firstHlIndex;
                return (
                <li
                  key={tr.trigger_id}
                  ref={isFirstHl ? firstHlRef : undefined}
                  className={'fm-layout-trigger' + (isHl ? ' is-highlighted' : '')}
                >
                  <span className="fm-layout-trigger-event">{humanizeAction(tr.trigger_action)}</span>
                  <span className="fm-layout-trigger-arrow" aria-hidden="true">→</span>
                  {tr.script_uuid ? (
                    <button
                      type="button"
                      className="fm-field-link"
                      onClick={() => navigate(buildObjectPath(tr.script_uuid!, originUuid, tr.file_name))}
                    >
                      {tr.script_name ?? tr.script_uuid}
                    </button>
                  ) : (
                    <span className="fm-layout-muted">{tr.script_name ?? '—'}</span>
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
