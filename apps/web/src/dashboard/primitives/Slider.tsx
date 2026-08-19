import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';

/**
 * Generic threshold slider. Writes its value into a URL search param
 * (`param`), which the DashboardView forwards to the dataset queries as a
 * `getvariable('<param>')` value — so moving the slider re-runs the rule SQL
 * with a new threshold. No bespoke wiring per dashboard.
 *
 * The upper bound can be static (`max`) or data-driven (`maxField` reads the
 * first row of the bound dataset, e.g. the highest object count in the corpus)
 * so the range adapts to the solution instead of a hard-coded ceiling.
 *
 * Props:
 *   param      URL/getvariable name to drive (required, e.g. "min_objects")
 *   label      caption shown above the track
 *   min        lower bound (default 0)
 *   max        static upper bound (used when maxField is absent/empty)
 *   maxField   dataset field holding the dynamic upper bound
 *   default    fallback value when the param is not present in the URL
 *   defaultTo  "max" makes the (possibly data-driven) upper bound the fallback
 *              — an upper-limit slider then starts inactive at "no limit"
 *   comparator display prefix before the value ("≥" default; "≤" for
 *              upper-limit sliders)
 *   step       slider step (default 1)
 *   valueSuffix optional unit shown next to the current value (e.g. "objects")
 */
export function Slider({ node, dataset }: PrimitiveProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const props = node.props ?? {};
  const param = props.param as string | undefined;
  const label = props.label as string | undefined;
  const min = Number(props.min ?? 0);
  const step = Number(props.step ?? 1);
  const comparator = (props.comparator as string | undefined) ?? '≥';
  const valueSuffix = props.valueSuffix as string | undefined;

  const [searchParams, setSearchParams] = useSearchParams();

  // Dynamic upper bound from the bound dataset, else the static `max`, else a
  // safe non-zero ceiling so the track is never degenerate.
  const dynamicMax = useMemo(() => {
    const field = props.maxField as string | undefined;
    if (field) {
      const raw = dataset?.data?.[0]?.[field];
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const staticMax = Number(props.max);
    return Number.isFinite(staticMax) && staticMax > 0 ? staticMax : min + 1;
  }, [dataset, props.maxField, props.max, min]);

  // defaultTo: "max" — upper-limit sliders rest at the (data-driven) ceiling,
  // meaning "no limit"; the param is dropped there, so the query stays
  // unfiltered until the user pulls the slider down.
  const fallback = props.defaultTo === 'max' ? dynamicMax : Number(props.default ?? min);

  // Current committed value comes from the URL param (source of truth); local
  // state tracks the live drag position for a smooth track, committed to the
  // URL debounced so a drag doesn't fire a request per pixel.
  const urlValue = param ? searchParams.get(param) : null;
  const committed = urlValue != null && urlValue !== '' ? Number(urlValue) : fallback;
  const [value, setValue] = useState<number>(committed);

  // Keep the ceiling above the current value so the thumb is never clipped.
  const max = Math.max(dynamicMax, value, min + 1);

  // Reflect external URL changes (back/forward, file filter reload) into the
  // local position, but not while the user is actively dragging.
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setValue(committed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = (next: number) => {
    if (!param) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSearchParams(prev => {
        const n = new URLSearchParams(prev);
        // Keep the URL clean: drop the param at its default so the dashboard
        // link stays canonical and no redundant refetch is triggered.
        if (next === fallback) n.delete(param);
        else n.set(param, String(next));
        return n;
      }, { replace: true });
    }, 250);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (!param) return null;

  const caption = label ?? (t('dashboard:slider.threshold', { defaultValue: 'Threshold' }) as string);

  return (
    <div className="dash-slider">
      <div className="dash-slider__head">
        <label className="dash-slider__label" htmlFor={`slider-${param}`}>{caption}</label>
        <span className="dash-slider__value">
          {comparator} {value.toLocaleString()}{valueSuffix ? ` ${valueSuffix}` : ''}
        </span>
      </div>
      <div className="dash-slider__track">
        <span className="dash-slider__bound">{min.toLocaleString()}</span>
        <input
          id={`slider-${param}`}
          type="range"
          className="dash-slider__input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => {
            draggingRef.current = true;
            const next = Number(e.target.value);
            setValue(next);
            commit(next);
          }}
          onPointerUp={() => { draggingRef.current = false; }}
          onKeyUp={() => { draggingRef.current = false; }}
        />
        <span className="dash-slider__bound">{max.toLocaleString()}</span>
      </div>
    </div>
  );
}
