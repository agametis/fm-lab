import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayoutObject } from '../hooks/useLayoutData';
import { FIELD_NAV_TYPES, SCRIPT_NAV_TYPES } from '../lib/layoutObjectNav';
import { useTriggerEventFormat } from '../lib/triggerEvents';

type Props = {
  object: LayoutObject;
  x: number;
  y: number;
};

const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 18;
const VIEWPORT_MARGIN = 12;

/**
 * Gehoistetes Cross-Nav-Ziel für die Ziel-Zeile (Typ-Label + Name) — kündigt
 * zugleich an, wohin der Modifier-Klick (Alt) führt. `extra` = weitere
 * Script-Ziele („+n weitere").
 */
function resolveTargetLine(o: LayoutObject): { typeKey: string; name: string; extra: number } | null {
  if (FIELD_NAV_TYPES.has(o.object_type) && o.field_name) {
    return { typeKey: 'Field', name: o.field_name, extra: 0 };
  }
  if (SCRIPT_NAV_TYPES.has(o.object_type)) {
    if (o.script_name) {
      return { typeKey: 'Script', name: o.script_name, extra: Math.max(0, o.script_count - 1) };
    }
    if (o.nav_layout_name) {
      return { typeKey: 'Layout', name: o.nav_layout_name, extra: 0 };
    }
  }
  if (o.object_type === 'Portal' && o.portal_to_name) {
    return { typeKey: 'TableOccurrence', name: o.portal_to_name, extra: 0 };
  }
  return null;
}

/**
 * Kompakter Read-only-Hover-Indikator eines Layout-Objekts: Typ/Name,
 * Ziel-Zeile (gehoistetes Ziel = Modifier-Klick-Ziel), Script-Trigger
 * (Anzahl + ALLE Event-Namen, ungedeckelt), Logik-Indikatoren
 * (Tooltip/Hide-Präsenz, CF-Regelanzahl) und typspezifische Slot-Indikatoren.
 * Keine Formeln, keine Links — Details liefert die LayoutObject-Detailansicht
 * per Primärklick.
 */
export function LayoutObjectTooltip({ object, x, y }: Props) {
  const { t } = useTranslation(['detail', 'types']);
  const fmtEvent = useTriggerEventFormat();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + CURSOR_OFFSET_X, top: y + CURSOR_OFFSET_Y });

  // Edge-Detection: Tooltip an die andere Seite des Cursors flippen, wenn er rechts/unten
  // aus dem Viewport ragt.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = x + CURSOR_OFFSET_X;
    let top = y + CURSOR_OFFSET_Y;

    if (left + rect.width > viewportW - VIEWPORT_MARGIN) {
      left = x - rect.width - CURSOR_OFFSET_X;
    }
    if (top + rect.height > viewportH - VIEWPORT_MARGIN) {
      top = y - rect.height - CURSOR_OFFSET_Y;
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

    setPos({ left, top });
  }, [x, y, object.object_uuid]);

  const target = resolveTargetLine(object);
  const triggerEvents = object.trigger_count > 0 && object.trigger_events
    ? object.trigger_events.split(',').map(fmtEvent).join(', ')
    : null;

  // Logik-Zeile: Präsenz-Häkchen für Tooltip/Hide, CF als Regel-Anzahl
  // (regel-genau aus LayoutObjectConditions — nie mehr ein Regex-Boolean).
  const logicParts: string[] = [];
  if (object.tooltip_text) {
    logicParts.push(`${t('detail:calculationDetail.roles.tooltip', { defaultValue: 'Tooltip' })} ✓`);
  }
  if (object.hide_text) {
    logicParts.push(`${t('detail:calculationDetail.roles.hide', { defaultValue: 'Hide condition' })} ✓`);
  }
  if (object.cf_count > 0) {
    logicParts.push(`${t('detail:calculationDetail.roles.conditional_format', { defaultValue: 'Conditional formatting' })} (${object.cf_count})`);
  }

  // Slot-Zeile: belegte typspezifische Slots namentlich (Labels aus den
  // vorhandenen Rollen-Keys) — pro Typ kommen faktisch höchstens 1–2 vor.
  const slotParts = (object.other_calc_roles ?? '')
    .split(',')
    .filter(Boolean)
    .map(role => `${t(`detail:calculationDetail.roles.${role}`, { defaultValue: role })} ✓`);

  return (
    <div
      ref={ref}
      role="tooltip"
      className="layout-object-tooltip"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="layout-tooltip-head">
        <span className="layout-tooltip-type">{object.object_type}</span>
        {object.object_name && <span className="layout-tooltip-name"> · {object.object_name}</span>}
      </div>
      {target && (
        <div className="layout-tooltip-row">
          <span className="layout-tooltip-key">{t('detail:layoutCanvas.tooltip.target', { defaultValue: 'Target' })}</span>
          <span className="layout-tooltip-val">
            {t(`types:objectTypes.${target.typeKey}`, { defaultValue: target.typeKey })} „{target.name}“
            {target.extra > 0 && (
              <span className="layout-tooltip-muted"> {t('detail:layoutCanvas.tooltip.moreTargets', { n: target.extra, defaultValue: '(+{{n}} more)' })}</span>
            )}
          </span>
        </div>
      )}
      {triggerEvents && (
        <div className="layout-tooltip-row">
          <span className="layout-tooltip-key">
            {t('detail:layoutViewer.triggersHeading', { defaultValue: 'Script triggers' })} ({object.trigger_count})
          </span>
          <span className="layout-tooltip-val">{triggerEvents}</span>
        </div>
      )}
      {logicParts.length > 0 && (
        <div className="layout-tooltip-row">
          <span className="layout-tooltip-key">{t('detail:layoutCanvas.tooltip.logic', { defaultValue: 'Logic' })}</span>
          <span className="layout-tooltip-val">{logicParts.join(' · ')}</span>
        </div>
      )}
      {slotParts.length > 0 && (
        <div className="layout-tooltip-row">
          <span className="layout-tooltip-key">{t('detail:layoutCanvas.tooltip.slots', { defaultValue: 'Slots' })}</span>
          <span className="layout-tooltip-val">{slotParts.join(' · ')}</span>
        </div>
      )}
    </div>
  );
}
