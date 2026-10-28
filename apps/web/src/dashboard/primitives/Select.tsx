import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PrimitiveProps } from '../types';

/**
 * Server-side filter dropdown. Like FilterChips, but a `<select>` — scales to
 * many options. Options come from the bound dataset (rows → value/label). The
 * choice is written into a URL param the dashboard forwards to the SQL as
 * `getvariable('<param>')`, so each selection re-queries the full data.
 *
 * Props:
 *   param            URL/getvariable name to drive (required, e.g. "api_set")
 *   default          value selected when the param is absent from the URL
 *   valueField       dataset field used as the option value (default "value")
 *   labelField       dataset field used as the option caption (default "label")
 *   label            optional caption shown before the control (i18n-overridable)
 *   emptyOptionLabel optional caption for a leading "no filter" option with the
 *                    empty value — as a layout prop it is i18n-overridable,
 *                    unlike option rows coming from the dataset
 *   multiple         true → multi-select: a dropdown of checkboxes that writes
 *                    the chosen values, joined by `separator`, into the param
 *                    (none chosen → param absent = no filter). `emptyOptionLabel`
 *                    then captions the "nothing chosen" state; an × next to the
 *                    control and the popover's first entry clear the choice. SQL side:
 *                    `list_contains(string_split(getvariable('<param>'), ','), col)`
 *   separator        value separator of the multi-select (default ","); values
 *                    containing it cannot be selected individually
 *   resetParams      URL params dropped together with every change (e.g. the page
 *                    param of a server-paged table, so a new filter starts on page 1)
 */
export function Select(props: PrimitiveProps) {
  return props.node.props?.multiple === true ? <MultiSelect {...props} /> : <SingleSelect {...props} />;
}

function SingleSelect({ node, dataset }: PrimitiveProps) {
  const props = node.props ?? {};
  const param = props.param as string | undefined;
  const fallback = (props.default as string) ?? '';
  const valueField = (props.valueField as string) ?? 'value';
  const labelField = (props.labelField as string) ?? 'label';
  const caption = props.label as string | undefined;
  const emptyOptionLabel = props.emptyOptionLabel as string | undefined;
  const resetParams = (props.resetParams as string[] | undefined) ?? [];
  const [searchParams, setSearchParams] = useSearchParams();

  if (!param) return null;

  const rows = (dataset?.data as Array<Record<string, unknown>>) ?? [];
  const current = searchParams.get(param) ?? fallback;

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      // Keep the URL canonical: drop the param at its default.
      if (value === fallback) n.delete(param);
      else n.set(param, value);
      for (const key of resetParams) n.delete(key);
      return n;
    }, { replace: true });
  };

  return (
    <div className="dash-select">
      {caption && <label className="dash-select__label">{caption}</label>}
      <select className="dash-select__control" value={current} onChange={onChange}>
        {emptyOptionLabel != null && <option value="">{emptyOptionLabel}</option>}
        {rows.map(r => (
          <option key={String(r[valueField])} value={String(r[valueField])}>
            {String(r[labelField])}
          </option>
        ))}
      </select>
    </div>
  );
}

function MultiSelect({ node, dataset }: PrimitiveProps) {
  const { t } = useTranslation(['common', 'dashboard']);
  const props = node.props ?? {};
  const param = props.param as string | undefined;
  const fallback = (props.default as string) ?? '';
  const valueField = (props.valueField as string) ?? 'value';
  const labelField = (props.labelField as string) ?? 'label';
  const caption = props.label as string | undefined;
  const emptyOptionLabel = props.emptyOptionLabel as string | undefined;
  const separator = (props.separator as string) || ',';
  const resetParams = (props.resetParams as string[] | undefined) ?? [];
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // The popover lives in a portal on document.body with fixed coordinates, so
  // the card's overflow:hidden cannot clip it (same approach as the docset
  // install popover). Left-aligned under the trigger; flipped above when it
  // would leave the viewport; clamped horizontally. Second pass after mount
  // with the real height.
  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popHeight = popoverRef.current?.getBoundingClientRect().height ?? 320;
    const popWidth = popoverRef.current?.getBoundingClientRect().width ?? 240;
    const margin = 8;
    let top = rect.bottom + 4;
    if (top + popHeight + margin > window.innerHeight) {
      const above = rect.top - popHeight - 4;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - popHeight - margin);
    }
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - popWidth - margin));
    setPos(prev => (prev && Math.abs(prev.top - top) < 1 && Math.abs(prev.left - left) < 1 ? prev : { top, left }));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const raf = requestAnimationFrame(() => updatePos());
    return () => cancelAnimationFrame(raf);
  }, [open, updatePos]);

  // Close on a click outside trigger and popover or on Escape; follow scrolling.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => updatePos();
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, updatePos]);

  if (!param) return null;

  const rows = (dataset?.data as Array<Record<string, unknown>>) ?? [];
  const options = rows.map(r => ({ value: String(r[valueField]), label: String(r[labelField]) }));
  const raw = searchParams.get(param) ?? fallback;
  const selected = raw.split(separator).filter(v => v !== '');
  const selectedSet = new Set(selected);

  const write = (values: string[]) => {
    // Option order first, then values from the URL the options do not list
    // (a deep link must not lose them silently).
    const known = options.map(o => o.value).filter(v => values.includes(v));
    const unknown = values.filter(v => !options.some(o => o.value === v));
    const value = [...known, ...unknown].join(separator);
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      // Keep the URL canonical: drop the param when empty or at its default.
      if (value === '' || value === fallback) n.delete(param);
      else n.set(param, value);
      for (const key of resetParams) n.delete(key);
      return n;
    }, { replace: true });
  };

  const toggle = (value: string) =>
    write(selectedSet.has(value) ? selected.filter(v => v !== value) : [...selected, value]);

  const labelOf = (value: string) => options.find(o => o.value === value)?.label ?? value;
  const summary = selected.length === 0
    ? (emptyOptionLabel ?? (t('common:all') as string))
    : selected.length <= 2
      ? selected.map(labelOf).join(', ')
      : (t('dashboard:select.selectedCount', { count: selected.length }) as string);
  const clearLabel = t('dashboard:select.clear') as string;

  return (
    <div className="dash-select dash-select--multi">
      {caption && <span className="dash-select__label">{caption}</span>}
      <span className="dash-select__group">
        <button
          ref={triggerRef}
          type="button"
          className={`dash-select__control dash-select__trigger${selected.length > 0 ? ' dash-select__trigger--active' : ''}`}
          aria-haspopup="true"
          aria-expanded={open}
          title={selected.length > 2 ? selected.map(labelOf).join(', ') : undefined}
          onClick={() => setOpen(o => !o)}
        >
          {summary}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            className="dash-select__reset"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={() => write([])}
          >
            ×
          </button>
        )}
      </span>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="dash-select__popover"
          role="group"
          aria-label={caption ?? emptyOptionLabel}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        >
          <button
            type="button"
            className="dash-select__clear"
            disabled={selected.length === 0}
            onClick={() => write([])}
          >
            {clearLabel}
          </button>
          <div className="dash-select__options">
            {options.map(o => (
              <label key={o.value} className="dash-select__option">
                <input type="checkbox" checked={selectedSet.has(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
