import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { GroupedReferences, ReferenceItem } from '../types';
import { ReferencesFilter } from './ReferencesFilter';
import { useUrlState, stringSetCodec, type UrlStateCodec } from '../hooks/useUrlState';
import { buildNavigablePath } from '../lib/navigation';

const EMPTY_TYPES = new Set<string>();

/**
 * Richtungs-Filter der Referenzliste. parent/structuralParent = eingehend (←,
 * „wird verwendet von"), child/structuralChild = ausgehend (→, „verwendet").
 * 'both' ist Default und fällt aus der URL heraus (saubere URLs).
 */
type DirFilter = 'in' | 'out' | 'both';
const dirFilterCodec: UrlStateCodec<DirFilter> = {
  parse: (raw) => (raw === 'in' || raw === 'out' ? raw : 'both'),
  serialize: (value) => (value === 'both' ? null : value),
};

interface HierarchyTreeProps {
  references: GroupedReferences;
}

/**
 * Imperatives Handle, das DetailView via Ref konsumiert, um den ESC-Stack
 * zu speisen. Status-Getter werden bei jedem ESC-Druck frisch aufgerufen
 * (nicht zur Mount-Zeit gecached) — daher live, ohne Re-Render.
 */
export type HierarchyTreeHandle = {
  hasQuery: () => boolean;
  hasFilters: () => boolean;
  clearQuery: () => void;
  clearFilters: () => void;
};

function buildSearchText(ref: ReferenceItem): string {
  return [
    ref.Object_Name ?? '',
    ref.Object_Type ?? '',
    ref.Link_Role ?? '',
    ref.File_Name ?? '',
  ].join(' ').toLowerCase();
}

/**
 * Generische Sortier-Schlüssel für Referenzen — unabhängig vom Objekttyp.
 * 'origin' = Herkunft (Datei → Typ → Name); 'name' = Objektname → Datei.
 * Die Datei ist die abstrakte Herkunfts-Ebene (bei Feldern implizit über die TO,
 * bei Scripts/Layouts/etc. direkt), daher für ALLE Referenz-Typen sinnvoll.
 */
type RefSortKey = 'origin' | 'name';
interface RefSortState { key: RefSortKey; dir: 'asc' | 'desc'; }

function compareRefs(a: ReferenceItem, b: ReferenceItem, key: RefSortKey): number {
  const cmp = (x: string, y: string) =>
    (x ?? '').localeCompare(y ?? '', undefined, { sensitivity: 'base', numeric: true });
  if (key === 'origin') {
    return cmp(a.File_Name, b.File_Name) || cmp(a.Object_Type, b.Object_Type) || cmp(a.Object_Name, b.Object_Name);
  }
  return cmp(a.Object_Name, b.Object_Name) || cmp(a.File_Name, b.File_Name);
}

/**
 * Hierarchy Tree Component
 * Displays parent (upstream) and child (downstream) references as clickable lists.
 * Includes a type-filter pill bar and a live search input above the lists.
 */
export const HierarchyTree = forwardRef<HierarchyTreeHandle, HierarchyTreeProps>(({ references }, externalRef) => {
  const { t } = useTranslation(['detail']);
  const navigate = useNavigate();
  const { uuid: currentUuid } = useParams<{ uuid: string }>();
  // URL als Single Source of Truth — Stack erhält Such- und Filterstand
  // beim Zurück-Navigieren automatisch (Tab-Param 'tab' liegt in DetailView).
  //
  // Lesen via useUrlState; Schreiben für User-Interaktionen via setSearchParams
  // direkt — analog useLayoutSearch. Begründung: bei expliziter User-Aktion
  // (Pille klicken, Tippen) wird `?ref=` ATOMAR im selben URL-Update mitentfernt,
  // damit der Filter sich nicht mit dem Referenz-Modus schneidet.
  const [query, setQuery] = useUrlState<string>('q', '');
  const [activeTypes, setActiveTypes] = useUrlState<Set<string>>('types', EMPTY_TYPES, stringSetCodec);
  const [dirFilter] = useUrlState<DirFilter>('rdir', 'both', dirFilterCodec);
  const [, setSearchParams] = useSearchParams();
  const treeRef = useRef<HTMLElement>(null);
  // Generische Referenz-Sortierung. Default: Herkunft (Datei) aufsteigend.
  const [refSort, setRefSort] = useState<RefSortState>({ key: 'origin', dir: 'asc' });

  /**
   * Atomarer URL-Update für User-Interaktionen: führt einen Updater auf den
   * URLSearchParams aus UND entfernt im selben Tick den `?ref=`-Param. Beide
   * Mutationen landen in EINEM `setSearchParams`-Call — keine Race-Condition
   * zwischen separaten useUrlState-Hook-Instanzen (siehe useLayoutSearch).
   */
  const runUserUpdate = useCallback(
    (updater: (p: URLSearchParams) => void) => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        updater(next);
        if (next.has('ref')) next.delete('ref');
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const queryRef = useRef(query);
  queryRef.current = query;
  const activeTypesRef = useRef(activeTypes);
  activeTypesRef.current = activeTypes;

  useImperativeHandle(externalRef, () => ({
    hasQuery: () => queryRef.current.trim() !== '',
    hasFilters: () => activeTypesRef.current.size > 0,
    clearQuery: () => setQuery(''),
    clearFilters: () => setActiveTypes(EMPTY_TYPES),
  // Setter sind stabil per useUrlState; eslint-disable verhindert false-positive deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const handleReferenceClick = (ref: ReferenceItem) => {
    // Container-Resolution:
    // - Aktuelles Objekt als Origin mitgeben (Standard-Highlight-Mechanik).
    // - Wenn das Ziel ein Sub-Knoten ist (Container_UUID gesetzt, z.B.
    //   LayoutObject → Layout), wird transparent der Container geöffnet und
    //   der Sub-Knoten als ref gesetzt — der spezifischere Treffer ist die
    //   nützlichere Hervorhebung.
    //
    // Sonderfall parent_script: aus einer ScriptStep-Detail-Seite springt der
    // Klick auf den "enthalten in Script"-Eintrag zur Script-Detail-Seite.
    // Wir hängen `?step=<currentUuid>` an, damit der ScriptViewer dort direkt
    // zur passenden Zeile scrollt und sie kurz hervorhebt (siehe
    // ScriptViewer.tsx stepAnchor-useEffect).
    const extras = ref.Link_Role === 'parent_script' && currentUuid
      ? { step: currentUuid }
      : undefined;
    navigate(buildNavigablePath(ref.uuid, currentUuid ?? null, ref.Container_UUID ?? null, ref.File_Name ?? null, extras));
  };

  // Item-Handler: Enter/Space löst Navigation aus. Pfeiltasten werden hier
  // bewusst NICHT abgefangen — sie laufen via Bubbling in den Container-Handler,
  // damit eine einzige Quelle die Auf-/Abwärts-Logik kontrolliert.
  const handleItemKeyDown = (e: React.KeyboardEvent, ref: ReferenceItem) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleReferenceClick(ref);
    }
  };

  // Container-Handler: Pfeil-Navigation über alle sichtbaren `.reference-item`
  // hinweg (auch Sektions-übergreifend), inkl. Home/End und Wrap-around.
  // Bewusst getrennt vom Browser-TAB-Verhalten — TAB läuft weiter über die
  // tabIndex={0}-Reihenfolge der Items, sodass beide Navigations-Modi
  // koexistieren und das Verhalten nicht von Browser-Heuristiken abhängt.
  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const root = treeRef.current;
    if (!root) return;
    const items = Array.from(
      root.querySelectorAll<HTMLLIElement>('.reference-item'),
    );
    if (items.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const currentIndex = active ? items.indexOf(active as HTMLLIElement) : -1;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowDown') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (e.key === 'ArrowUp') {
      nextIndex = currentIndex < 0
        ? items.length - 1
        : (currentIndex - 1 + items.length) % items.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = items.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      items[nextIndex].focus();
    }
  }, []);

  // Richtung → aktive Sektionen. Bei 'in'/'out' wird die jeweils andere Richtung
  // komplett ausgeblendet (leere Sektionen), 'both' zeigt alle vier.
  const inOn = dirFilter !== 'out';
  const outOn = dirFilter !== 'in';

  // Referenz-Menge im Geltungsbereich des Richtungs-Filters — speist Typ-Pillen
  // und Gesamtzähler, damit die Zahlen zur sichtbaren Auswahl passen.
  const directionScopedRefs = useMemo(() => [
    ...(inOn ? references.parent : []),
    ...(outOn ? references.child : []),
    ...(inOn ? references.structuralParent : []),
    ...(outOn ? references.structuralChild : []),
  ], [references, inOn, outOn]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of directionScopedRefs) {
      m.set(r.Object_Type, (m.get(r.Object_Type) ?? 0) + 1);
    }
    return m;
  }, [directionScopedRefs]);

  const queryLower = query.trim().toLowerCase();
  const filterFn = useCallback((r: ReferenceItem) => {
    if (activeTypes.size > 0 && !activeTypes.has(r.Object_Type)) return false;
    if (queryLower !== '' && !buildSearchText(r).includes(queryLower)) return false;
    return true;
  }, [activeTypes, queryLower]);

  const matches = useMemo(() => ({
    parent: inOn ? references.parent.filter(filterFn) : [],
    child: outOn ? references.child.filter(filterFn) : [],
    structuralParent: inOn ? references.structuralParent.filter(filterFn) : [],
    structuralChild: outOn ? references.structuralChild.filter(filterFn) : [],
  }), [references, filterFn, inOn, outOn]);

  // Treffer je Richtung (Typ-/Such-Filter berücksichtigt, Richtungs-Filter NICHT)
  // — beschriftet die Richtungs-Buttons und bleibt beim Umschalten stabil.
  const dirCounts = useMemo(() => ({
    in: references.parent.filter(filterFn).length + references.structuralParent.filter(filterFn).length,
    out: references.child.filter(filterFn).length + references.structuralChild.filter(filterFn).length,
  }), [references, filterFn]);

  const totalCount = directionScopedRefs.length;
  const matchCount = matches.parent.length + matches.child.length
    + matches.structuralParent.length + matches.structuralChild.length;

  // Richtungs-Leiste nur, wenn beide Richtungen überhaupt Referenzen haben (sonst
  // ist der Filter sinnlos). Basiert auf den Rohdaten, nicht auf dem aktiven Filter.
  const hasIncomingTotal = references.parent.length + references.structuralParent.length > 0;
  const hasOutgoingTotal = references.child.length + references.structuralChild.length > 0;
  const showDirBar = hasIncomingTotal && hasOutgoingTotal;

  // User-Klick auf Filter-Pille: atomar Filter setzen + ref-Param entfernen.
  const toggleType = (type: string) => {
    runUserUpdate(p => {
      const current = new Set(
        (p.get('types') ?? '').split(',').map(s => s.trim()).filter(Boolean),
      );
      if (current.has(type)) current.delete(type);
      else current.add(type);
      if (current.size === 0) p.delete('types');
      else p.set('types', Array.from(current).join(','));
    });
  };

  // "Filter zurücksetzen"-Link und ESC-Stack — programmatische Zurücknahme,
  // ref-Modus wird nicht angerührt (kein User-Filter-Eingriff).
  const clearTypes = () => setActiveTypes(EMPTY_TYPES);

  // Richtungs-Filter: gleiche atomare Mechanik wie die Typ-Pillen (ref-Param
  // wird im selben Update entfernt). 'both' ist Default → Param fällt weg.
  const setDirFilter = (d: DirFilter) => {
    runUserUpdate(p => {
      if (d === 'both') p.delete('rdir');
      else p.set('rdir', d);
    });
  };

  // Sucheingabe: bei nicht-leerer Eingabe atomar mit ref-Clear; leerer Wert
  // (Backspace, Clear-Button, ESC) ist programmatisch und lässt ref unverändert.
  const handleQueryChange = (q: string) => {
    if (q === '') {
      setQuery('');
      return;
    }
    runUserUpdate(p => {
      p.set('q', q);
    });
  };

  // Vom Suchfeld via Pfeil-Down/-Up zum ersten/letzten Listenelement springen.
  // Vermeidet das mehrfache TAB-Springen über Pillen und Reset-Link.
  const jumpToList = useCallback((direction: 'first' | 'last') => {
    const root = treeRef.current;
    if (!root) return;
    const items = root.querySelectorAll<HTMLLIElement>('.reference-item');
    if (items.length === 0) return;
    const target = direction === 'first' ? items[0] : items[items.length - 1];
    target.focus();
  }, []);

  const renderReferenceItem = (ref: ReferenceItem, idx: number, dir: 'in' | 'out') => {
    // Step-eigene Referenzen mit datei-extern nicht auflösbarem Ziel (navigable=false)
    // werden als nicht-klickbarer, gedimmter Text gezeigt — kein Klick/Enter, nicht im
    // TAB-Fluss. Graph-Referenzen haben kein `navigable`-Feld → gelten als navigierbar.
    const isNavigable = ref.navigable !== false;
    // Fokus-Objekt selbst (z.B. Self-Reference eines Scripts) hervorheben.
    const isFocus = currentUuid != null && ref.uuid === currentUuid;
    return (
      <li
        key={`${ref.uuid}-${ref.Link_Role}-${idx}`}
        className={`reference-item${isNavigable ? '' : ' is-not-navigable'}${isFocus ? ' is-focus' : ''}`}
        aria-current={isFocus ? 'true' : undefined}
        onClick={isNavigable ? () => handleReferenceClick(ref) : undefined}
        onKeyDown={isNavigable ? (e) => handleItemKeyDown(e, ref) : undefined}
        tabIndex={isNavigable ? 0 : -1}
        role={isNavigable ? 'button' : undefined}
        title={isNavigable ? undefined : t('detail:hierarchyTree.notNavigable', {
          defaultValue: 'Ziel nicht im importierten Datenbestand',
        }) as string}
        aria-label={isNavigable
          ? t('detail:hierarchyTree.itemAriaLabel', {
              type: ref.Object_Type,
              name: ref.Object_Name,
            }) as string
          : `${ref.Object_Type}: ${ref.Object_Name}`}
      >
        <span className="object-type">
          {ref.Object_Type}
        </span>
        <span className="ref-name">
          {ref.Object_Name}
        </span>
        <span className="ref-file">
          ({ref.File_Name})
        </span>
        {ref.Is_Cross_File && (
          <span className="cross-file-badge">
            {t('detail:hierarchyTree.crossFileBadge')}
          </span>
        )}
        {ref.Origin_Hit && (
          <span
            className="origin-hit-badge"
            title={t('detail:hierarchyTree.originHitTitle', {
              defaultValue: 'Aus dem Herkunftsobjekt (ref) erreichbar',
            }) as string}
          >
            {t('detail:hierarchyTree.originHitBadge', { defaultValue: '↩ Herkunft' })}
          </span>
        )}
        <span className="ref-role">
          {/* Rolle nicht mehr als Text — nur ein Richtungs-Pfeil; die konkrete
              Rolle (calls_script, reads_field, …) steht im Tooltip. */}
          <span
            className={`ref-dir ref-dir-${dir}`}
            title={`${dir === 'in'
              ? t('detail:hierarchyTree.dirIn', { defaultValue: 'Eingehend' })
              : t('detail:hierarchyTree.dirOut', { defaultValue: 'Ausgehend' })} · ${ref.Link_Role}`}
            aria-hidden="true"
          >
            {dir === 'in' ? '←' : '→'}
          </span>
          {typeof ref.Call_Count === 'number' && ref.Call_Count > 1 && (
            <span className="ref-call-count" title={t('detail:hierarchyTree.callCountTitle', {
              count: ref.Call_Count,
              defaultValue: '{{count}} Vorkommen',
            }) as string}> ×{ref.Call_Count}</span>
          )}
        </span>
      </li>
    );
  };

  // Generische Sortierung aller Referenz-Items (Zeilen-Darstellung bleibt unverändert,
  // nur die Reihenfolge + der Sortier-Header ändern sich).
  const sortItems = (items: ReferenceItem[]) => {
    if (items.length < 2) return items;
    const sign = refSort.dir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      // Origin-Treffer (aus dem ?ref=-Herkunftsobjekt erreichbar, z.B. das im
      // Herkunfts-Script geschriebene Feld) immer zuoberst — unabhängig vom
      // gewählten Sortierschlüssel, damit der kontextuell relevante Treffer
      // nicht in einer langen Aggregat-Liste untergeht.
      const ao = a.Origin_Hit ? 0 : 1;
      const bo = b.Origin_Hit ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return sign * compareRefs(a, b, refSort.key);
    });
  };
  const toggleSort = (key: RefSortKey) => {
    setRefSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };
  const sortArrow = (key: RefSortKey) => refSort.key === key ? (refSort.dir === 'asc' ? ' ▲' : ' ▼') : '';

  // Sortier-Steuerung (links) + Richtungs-Filter (rechtsbündig) in einer Zeile.
  const renderToolbar = () => (
    <div className="reference-toolbar">
      <div className="reference-sort-bar" role="group" aria-label={t('detail:hierarchyTree.sortAriaLabel', { defaultValue: 'Sortierung' }) as string}>
        <span className="reference-sort-label">{t('detail:hierarchyTree.sortBy', { defaultValue: 'Sortieren nach' })}:</span>
        <button
          type="button"
          className={`reference-sort-btn${refSort.key === 'origin' ? ' is-active' : ''}`}
          onClick={() => toggleSort('origin')}
        >
          {t('detail:hierarchyTree.sortOrigin', { defaultValue: 'Herkunft' })}{sortArrow('origin')}
        </button>
        <button
          type="button"
          className={`reference-sort-btn${refSort.key === 'name' ? ' is-active' : ''}`}
          onClick={() => toggleSort('name')}
        >
          {t('detail:hierarchyTree.sortName', { defaultValue: 'Name' })}{sortArrow('name')}
        </button>
      </div>
      {showDirBar && renderDirectionFilter()}
    </div>
  );

  // Kompakter Richtungs-Filter: nur Pfeil-Glyph + Zähler; das Wort (Eingehend/
  // Ausgehend/Beide) steht im title/aria-label.
  const renderDirectionFilter = () => {
    const opts: Array<{ key: DirFilter; glyph: string; label: string; count: number }> = [
      { key: 'in', glyph: '←', label: t('detail:hierarchyTree.dirIn', { defaultValue: 'Eingehend' }) as string, count: dirCounts.in },
      { key: 'out', glyph: '→', label: t('detail:hierarchyTree.dirOut', { defaultValue: 'Ausgehend' }) as string, count: dirCounts.out },
      { key: 'both', glyph: '↔', label: t('detail:hierarchyTree.dirBoth', { defaultValue: 'Beide' }) as string, count: dirCounts.in + dirCounts.out },
    ];
    return (
      <div
        className="reference-dir-bar"
        role="radiogroup"
        aria-label={t('detail:hierarchyTree.dirFilterAria', { defaultValue: 'Richtung filtern' }) as string}
      >
        <span className="reference-dir-prefix">{t('detail:hierarchyTree.dirFilterLabel', { defaultValue: 'Richtung' })}:</span>
        {opts.map(o => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={dirFilter === o.key}
            aria-label={`${o.label} (${o.count})`}
            className={`reference-dir-btn${dirFilter === o.key ? ' is-active' : ''}`}
            onClick={() => setDirFilter(o.key)}
            title={`${o.label} (${o.count})`}
          >
            <span className="reference-dir-glyph" aria-hidden="true">{o.glyph}</span>
            <span className="reference-dir-count">{o.count}</span>
          </button>
        ))}
      </div>
    );
  };

  const renderSectionList = (items: ReferenceItem[], dir: 'in' | 'out') => (
    <ul className="reference-list">
      {sortItems(items).map((ref, idx) => renderReferenceItem(ref, idx, dir))}
    </ul>
  );

  const hasParents = matches.parent.length > 0;
  const hasChildren = matches.child.length > 0;
  const hasStructParents = matches.structuralParent.length > 0;
  const hasStructChildren = matches.structuralChild.length > 0;
  const hasAny = hasParents || hasChildren || hasStructParents || hasStructChildren;
  const hasAnyTotal = totalCount > 0;
  const filterActive = activeTypes.size > 0 || queryLower !== '';

  return (
    <div className="hierarchy-tree-wrapper">
      {hasAnyTotal && (
        <ReferencesFilter
          typeCounts={typeCounts}
          activeTypes={activeTypes}
          onToggleType={toggleType}
          onClearTypes={clearTypes}
          query={query}
          onQueryChange={handleQueryChange}
          matchCount={matchCount}
          totalCount={totalCount}
          onJumpToList={jumpToList}
        />
      )}
      <nav
        ref={treeRef}
        className="hierarchy-tree"
        aria-label={t('detail:hierarchyTree.ariaLabel') as string}
        onKeyDown={handleTreeKeyDown}
      >
        {(hasAny || showDirBar) && renderToolbar()}
        {hasParents && (
          <section className="hierarchy-section">
            <h2>{filterActive
              ? t('detail:hierarchyTree.usedByFiltered', { count: matches.parent.length, total: references.parent.length })
              : t('detail:hierarchyTree.usedBy', { count: matches.parent.length })}</h2>
            {renderSectionList(matches.parent, 'in')}
          </section>
        )}

        {hasChildren && (
          <section className="hierarchy-section">
            <h2>{filterActive
              ? t('detail:hierarchyTree.usesFiltered', { count: matches.child.length, total: references.child.length })
              : t('detail:hierarchyTree.uses', { count: matches.child.length })}</h2>
            {renderSectionList(matches.child, 'out')}
          </section>
        )}

        {hasStructParents && (
          <section className="hierarchy-section">
            <h2>{filterActive
              ? t('detail:hierarchyTree.structurallyContainedByFiltered', { count: matches.structuralParent.length, total: references.structuralParent.length })
              : t('detail:hierarchyTree.structurallyContainedBy', { count: matches.structuralParent.length })}</h2>
            {renderSectionList(matches.structuralParent, 'in')}
          </section>
        )}

        {hasStructChildren && (
          <section className="hierarchy-section">
            <h2>{filterActive
              ? t('detail:hierarchyTree.structurallyContainsFiltered', { count: matches.structuralChild.length, total: references.structuralChild.length })
              : t('detail:hierarchyTree.structurallyContains', { count: matches.structuralChild.length })}</h2>
            {renderSectionList(matches.structuralChild, 'out')}
          </section>
        )}

        {!hasAny && hasAnyTotal && (
          <div className="no-references">
            {t('detail:hierarchyTree.noFilterMatches')}
          </div>
        )}

        {!hasAnyTotal && (
          <div className="no-references">
            {t('detail:hierarchyTree.noReferences')}
          </div>
        )}
      </nav>
    </div>
  );
});

HierarchyTree.displayName = 'HierarchyTree';
