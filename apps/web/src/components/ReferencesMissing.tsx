import { useTranslation } from 'react-i18next';
import type { ReferenceCandidate, ReferenceCandidates } from '../types';

type Direction = 'in' | 'out';

type Props = {
  candidates: ReferenceCandidates | null;
  /** Aktiver Richtungs-Filter des Referenzen-Tabs ('both' = beide Gruppen). */
  dirFilter: 'in' | 'out' | 'both';
  /**
   * Gegentypen, die je Richtung bereits als Typ-Pille sichtbar sind. Steht ein
   * Typ eines fehlenden Kandidaten dort über ANDERE Rollen, bekommt das Label
   * die Kandidaten-Rolle angehängt — sonst widerspräche die Zeile der Pille.
   */
  presentTypes: Record<Direction, Set<string>>;
  /** Eigenständig unter „Keine Referenzen“ statt in der Filter-Box. */
  standalone?: boolean;
};

const GLYPH: Record<Direction, string> = { in: '←', out: '→' };

/**
 * Zeile „Nicht referenziert“: Objekttypen, die bei diesem Objekt eine Referenz
 * haben KÖNNTEN, aber keine haben (Status `missing`) — für Layouts zusätzlich
 * gedämpft die nur über eigene Layout-Objekte erreichten Typen (`indirect`).
 * Die Kandidaten rechnet der Server; die Zeile folgt nur dem Richtungs-Filter,
 * nicht Typ-, Rollen- oder Suchfilter (sie beschreibt das Objekt, nicht die
 * gefilterte Sicht). Nicht interaktiv — es gibt nichts zu filtern.
 */
export function ReferencesMissing({ candidates, dirFilter, presentTypes, standalone = false }: Props) {
  const { t } = useTranslation(['detail']);
  if (!candidates || candidates.items.length === 0) return null;

  const directions: Direction[] = dirFilter === 'both' ? ['in', 'out'] : [dirFilter];
  const pick = (status: ReferenceCandidate['status']) => directions
    .map(dir => ({ dir, items: candidates.items.filter(c => c.direction === dir && c.status === status) }))
    .filter(g => g.items.length > 0);
  const missing = pick('missing');
  const indirect = pick('indirect');
  if (missing.length === 0 && indirect.length === 0) return null;

  const aggregateMembers = candidates.meta.aggregate_members ?? 0;

  const tooltipFor = (c: ReferenceCandidate): string => {
    const lines = [t('detail:referencesMissing.tooltipRoles', { roles: c.roles.join(', ') }) as string];
    // Aggregat-Hinweis nur für Kandidaten, die die Layout-Objekte mitzählen.
    if (c.aggregate && aggregateMembers > 0) {
      lines[0] += ` ${t('detail:referencesMissing.tooltipAggregate', { count: aggregateMembers })}`;
    }
    if (c.caveat === 'scriptCallers') lines.push(t('detail:referencesMissing.caveatScriptCallers') as string);
    if (c.caveat === 'toFieldAccess') lines.push(t('detail:referencesMissing.caveatToFieldAccess') as string);
    return lines.join('\n');
  };

  const labelFor = (c: ReferenceCandidate): string => {
    const base = c.types.join('/');
    if (c.status === 'indirect') return `${base} (${c.indirect})`;
    const clashes = c.types.some(type => presentTypes[c.direction as Direction].has(type));
    return clashes ? `${base} (${c.roles.join(', ')})` : base;
  };

  const renderGroups = (groups: Array<{ dir: Direction; items: ReferenceCandidate[] }>) => groups.map(g => (
    <span key={g.dir} className="references-missing-group">
      <span className={`references-missing-glyph ref-dir-${g.dir}`} aria-hidden="true">{GLYPH[g.dir]}</span>
      <span className="visually-hidden">
        {g.dir === 'in'
          ? t('detail:hierarchyTree.dirIn', { defaultValue: 'Eingehend' })
          : t('detail:hierarchyTree.dirOut', { defaultValue: 'Ausgehend' })}:
      </span>
      {g.items.map((c, idx) => (
        <span key={`${c.types.join('/')}-${idx}`} className="references-missing-item" title={tooltipFor(c)}>
          {labelFor(c)}
        </span>
      ))}
    </span>
  ));

  return (
    <div
      className={`references-missing${standalone ? ' is-standalone' : ''}`}
      role="note"
      aria-label={t('detail:referencesMissing.aria') as string}
    >
      {missing.length > 0 && (
        <span className="references-missing-segment">
          <span className="references-missing-label">
            {standalone ? t('detail:referencesMissing.emptyLead') : t('detail:referencesMissing.label')}
          </span>
          {renderGroups(missing)}
        </span>
      )}
      {indirect.length > 0 && (
        <span className="references-missing-segment is-indirect">
          <span className="references-missing-label">{t('detail:referencesMissing.indirectLabel')}</span>
          {renderGroups(indirect)}
        </span>
      )}
    </div>
  );
}
