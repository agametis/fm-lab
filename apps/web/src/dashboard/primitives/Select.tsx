import { useSearchParams } from 'react-router-dom';
import type { PrimitiveProps } from '../types';

/**
 * Server-side filter dropdown. Like FilterChips, but a `<select>` — scales to
 * many options. Options come from the bound dataset (rows → value/label). The
 * choice is written into a URL param the dashboard forwards to the SQL as
 * `getvariable('<param>')`, so each selection re-queries the full data.
 *
 * Props:
 *   param       URL/getvariable name to drive (required, e.g. "api_set")
 *   default     value selected when the param is absent from the URL
 *   valueField  dataset field used as the option value (default "value")
 *   labelField  dataset field used as the option caption (default "label")
 *   label       optional caption shown before the control (i18n-overridable)
 */
export function Select({ node, dataset }: PrimitiveProps) {
  const props = node.props ?? {};
  const param = props.param as string | undefined;
  const fallback = (props.default as string) ?? '';
  const valueField = (props.valueField as string) ?? 'value';
  const labelField = (props.labelField as string) ?? 'label';
  const caption = props.label as string | undefined;
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
      return n;
    }, { replace: true });
  };

  return (
    <div className="dash-select">
      {caption && <label className="dash-select__label">{caption}</label>}
      <select className="dash-select__control" value={current} onChange={onChange}>
        {rows.map(r => (
          <option key={String(r[valueField])} value={String(r[valueField])}>
            {String(r[labelField])}
          </option>
        ))}
      </select>
    </div>
  );
}
