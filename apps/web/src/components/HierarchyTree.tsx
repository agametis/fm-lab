import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { GroupedReferences, ReferenceItem } from '../types';
import { ReferencesFilter } from './ReferencesFilter';
import { useUrlState, stringSetCodec } from '../hooks/useUrlState';
import { buildNavigablePath } from '../lib/navigation';

const EMPTY_TYPES = new Set<string>();

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
  const [, setSearchParams] = useSearchParams();
  const treeRef = useRef<HTMLElement>(null);

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
    // PRD §7.4 + Container-Resolution:
    // - Aktuelles Objekt als Origin mitgeben (Standard-Highlight-Mechanik).
    // - Wenn das Ziel ein Sub-Knoten ist (Container_UUID gesetzt, z.B.
    //   LayoutObject → Layout), wird transparent der Container geöffnet und
    //   der Sub-Knoten als ref gesetzt — der spezifischere Treffer ist die
    //   nützlichere Hervorhebung.
    navigate(buildNavigablePath(ref.uuid, currentUuid ?? null, ref.Container_UUID ?? null));
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

  const allReferences = useMemo(() => [
    ...references.parent,
    ...references.child,
    ...references.structuralParent,
    ...references.structuralChild,
  ], [references]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allReferences) {
      m.set(r.Object_Type, (m.get(r.Object_Type) ?? 0) + 1);
    }
    return m;
  }, [allReferences]);

  const queryLower = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const filterFn = (r: ReferenceItem) => {
      if (activeTypes.size > 0 && !activeTypes.has(r.Object_Type)) return false;
      if (queryLower !== '' && !buildSearchText(r).includes(queryLower)) return false;
      return true;
    };
    return {
      parent: references.parent.filter(filterFn),
      child: references.child.filter(filterFn),
      structuralParent: references.structuralParent.filter(filterFn),
      structuralChild: references.structuralChild.filter(filterFn),
    };
  }, [references, activeTypes, queryLower]);

  const totalCount = allReferences.length;
  const matchCount = matches.parent.length + matches.child.length
    + matches.structuralParent.length + matches.structuralChild.length;

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

  const renderReferenceItem = (ref: ReferenceItem) => (
    <li
      key={`${ref.uuid}-${ref.Link_Role}`}
      className="reference-item"
      onClick={() => handleReferenceClick(ref)}
      onKeyDown={(e) => handleItemKeyDown(e, ref)}
      tabIndex={0}
      role="button"
      aria-label={t('detail:hierarchyTree.itemAriaLabel', {
        type: ref.Object_Type,
        name: ref.Object_Name,
      }) as string}
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
      <span className="ref-role">
        {ref.Link_Role}
      </span>
    </li>
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
        {hasParents && (
          <section className="hierarchy-section">
            <h2>{filterActive
              ? t('detail:hierarchyTree.usedByFiltered', { count: matches.parent.length, total: references.parent.length })
              : t('detail:hierarchyTree.usedBy', { count: matches.parent.length })}</h2>
            <ul className="reference-list">
              {matches.parent.map(renderReferenceItem)}
            </ul>
          </section>
        )}

        {hasChildren && (
          <section className="hierarchy-section">
            <h2>{filterActive
              ? t('detail:hierarchyTree.usesFiltered', { count: matches.child.length, total: references.child.length })
              : t('detail:hierarchyTree.uses', { count: matches.child.length })}</h2>
            <ul className="reference-list">
              {matches.child.map(renderReferenceItem)}
            </ul>
          </section>
        )}

        {hasStructParents && (
          <section className="hierarchy-section">
            <h2>{filterActive
              ? t('detail:hierarchyTree.structurallyContainedByFiltered', { count: matches.structuralParent.length, total: references.structuralParent.length })
              : t('detail:hierarchyTree.structurallyContainedBy', { count: matches.structuralParent.length })}</h2>
            <ul className="reference-list">
              {matches.structuralParent.map(renderReferenceItem)}
            </ul>
          </section>
        )}

        {hasStructChildren && (
          <section className="hierarchy-section">
            <h2>{filterActive
              ? t('detail:hierarchyTree.structurallyContainsFiltered', { count: matches.structuralChild.length, total: references.structuralChild.length })
              : t('detail:hierarchyTree.structurallyContains', { count: matches.structuralChild.length })}</h2>
            <ul className="reference-list">
              {matches.structuralChild.map(renderReferenceItem)}
            </ul>
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
