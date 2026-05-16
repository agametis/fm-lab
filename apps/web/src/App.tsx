import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Routes, Route, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from './api/client';
import { OBJECT_TYPES, OBJECT_TYPE_LABELS_DE } from '@packages/shared/constants';

// PRD prd_pseudo_object_types_filter.md §8.1 — vier Pseudo-Typen für
// die Sektion "Verwendete Tokens" im Type-Dropdown.
const PSEUDO_TYPE_GROUP = ['ScriptStepType', 'BuiltinFunction', 'PluginComponent', 'PluginFunction'] as const;
const PSEUDO_TYPE_SET = new Set<string>(PSEUDO_TYPE_GROUP);
import { useInfiniteSearch, useDebounce, useScrollRestore } from './hooks';
import { VirtualList, DetailView, SearchOptions, FolderTree, ThemeToggle, PseudoTokenView, type FolderTreeSubtype } from './components';
import { SettingsView } from './views/SettingsView';
import { RelationshipGraphView } from './views/RelationshipGraphView';
import { LayoutView } from './views/LayoutView';
import { DashboardHost } from './dashboard/DashboardHost';
import { DashboardView } from './dashboard/DashboardView';
import { QueryView } from './dashboard/QueryView';
import type { SortOption, GroupOption, VirtualListRow, FMObject } from './types';
import './App.css';

type FileInfo = {
  File_Name?: string;
  File_FullName?: string;
  FileMaker_Version?: string;
  Has_DDR_INFO?: boolean;
  Import_Timestamp?: string;
};

type ViewMode = 'search' | 'tree';

const TREE_SUBTYPE_LABELS: Record<FolderTreeSubtype, string> = {
  ScriptCatalog: 'Scripts',
  Layouts: 'Layouts',
  CustomFunctionsCatalog: 'Custom Functions',
};

const TREE_SUBTYPE_URL: Record<FolderTreeSubtype, string> = {
  ScriptCatalog: 'script',
  Layouts: 'layout',
  CustomFunctionsCatalog: 'customfunction',
};

function urlToSubtype(value: string | null): FolderTreeSubtype {
  switch (value) {
    case 'layout':         return 'Layouts';
    case 'customfunction': return 'CustomFunctionsCatalog';
    default:               return 'ScriptCatalog';
  }
}

function SearchView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { saveScrollPosition, restoreScrollPosition } = useScrollRestore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Initialize filter states from URL params (for deep linking & back-navigation)
  const [mode, setMode] = useState<ViewMode>(searchParams.get('mode') === 'tree' ? 'tree' : 'search');
  const [searchName, setSearchName] = useState(searchParams.get('q') || '');
  const [selectedFile, setSelectedFile] = useState<string>(searchParams.get('file') || '');
  const [objectType, setObjectType] = useState<string>(searchParams.get('type') || '');
  const [treeSubtype, setTreeSubtype] = useState<FolderTreeSubtype>(urlToSubtype(searchParams.get('subtype')));
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>((searchParams.get('sort') as SortOption) || 'standard');
  const [groupBy, setGroupBy] = useState<GroupOption>((searchParams.get('group') as GroupOption) || 'none');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Ref to track if search input should maintain focus
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wasFocusedRef = useRef(false);

  // Debounce search/filter input (300ms delay)
  const debouncedSearchName = useDebounce(searchName, 300);

  // Use infinite search hook (only relevant in 'search' mode, but called unconditionally
  // to keep hook order stable; the result is simply ignored when mode === 'tree').
  const { items, loading, loadingMore, hasMore, totalCount, error, loadMore } = useInfiniteSearch({
    searchName: debouncedSearchName || '*',
    selectedFile,
    objectType,
  });

  // Zwei-Wege-Sync zwischen URL und Filter-State. Die Implementierung muss zwei
  // Falle vermeiden:
  //   1) Beim Mount oder externen navigate() sollen URL→State greifen, nicht
  //      State→URL die URL mit altem State überschreiben.
  //   2) Wenn der User in den Inputs tippt, soll State→URL die URL aktualisieren,
  //      ohne dass URL→State daraufhin den gerade gesetzten State zurücksetzt.
  // Lösung: ein Ref, das markiert, dass der letzte State-Change *aus der URL*
  // stammt — in diesem Fall überspringt State→URL einen Tick.
  const internalSyncRef = useRef(false);
  // Tracks the last label URL→State has seen. Allows detecting when a
  // ?label=... param arrives externally (dashboard click) so State→URL
  // doesn't immediately strip it on mount.
  const prevLabelRef = useRef('');
  const searchParamsString = searchParams.toString();

  // URL → State
  useEffect(() => {
    const qName = searchParams.get('q') || '';
    const qFile = searchParams.get('file') || '';
    const qType = searchParams.get('type') || '';
    const qMode: ViewMode = searchParams.get('mode') === 'tree' ? 'tree' : 'search';
    const qLabel = searchParams.get('label') || '';
    const changed =
      qName !== searchName ||
      qFile !== selectedFile ||
      qType !== objectType ||
      qMode !== mode ||
      qLabel !== prevLabelRef.current;
    if (changed) {
      prevLabelRef.current = qLabel;
      internalSyncRef.current = true;
      if (qName !== searchName) setSearchName(qName);
      if (qFile !== selectedFile) setSelectedFile(qFile);
      if (qType !== objectType) setObjectType(qType);
      if (qMode !== mode) setMode(qMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsString]);

  // State → URL
  useEffect(() => {
    if (internalSyncRef.current) {
      // Dieser State-Change kommt gerade aus der URL — nicht zurückschreiben.
      internalSyncRef.current = false;
      return;
    }
    const params = new URLSearchParams();
    if (mode === 'tree') {
      params.set('mode', 'tree');
      params.set('subtype', TREE_SUBTYPE_URL[treeSubtype]);
      if (selectedFile) params.set('file', selectedFile);
      if (debouncedSearchName) params.set('q', debouncedSearchName);
    } else {
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (objectType) params.set('type', objectType);
      if (sortBy !== 'standard') params.set('sort', sortBy);
      if (groupBy !== 'none') params.set('group', groupBy);
    }
    const nextString = params.toString();
    // ?label=... ist ein externer Dekorations-Param (kommt aus Dashboard-Navigation),
    // der nicht von diesem Effekt verwaltet wird. Beim Vergleich ignorieren, damit
    // State→URL den Label-Param nicht beim nächsten Mount-Tick strippt.
    const currentWithoutLabel = new URLSearchParams(searchParamsString);
    currentWithoutLabel.delete('label');
    if (nextString !== currentWithoutLabel.toString()) {
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, treeSubtype, debouncedSearchName, selectedFile, objectType, sortBy, groupBy]);

  // Load available files on mount
  useEffect(() => {
    async function loadFiles() {
      try {
        const response = await api.info();
        if (response.success && response.data?.solution?.files) {
          setFiles(response.data.solution.files);
        }
      } catch (err) {
        console.error('Fehler beim Laden der Dateien:', err);
      }
    }
    loadFiles();
  }, []);

  // Restore focus to search input after loading states change
  useEffect(() => {
    if (wasFocusedRef.current && searchInputRef.current && !loading) {
      searchInputRef.current.focus();
    }
  }, [loading]);

  // Restore scroll position when items are loaded (after back-navigation)
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (mode === 'search' && items.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('search-list', scrollContainerRef.current);
    }
  }, [mode, items.length, restoreScrollPosition]);

  // Reset restore flag when search params change
  useEffect(() => {
    hasRestoredRef.current = false;
  }, [debouncedSearchName, selectedFile, objectType, mode, treeSubtype]);

  // Reset expanded groups when grouping changes (all collapsed by default)
  useEffect(() => {
    setExpandedGroups(new Set());
  }, [groupBy]);

  // Sort and group items for the virtual list
  const processedRows: VirtualListRow[] = useMemo(() => {
    let sorted: FMObject[];
    if (sortBy === 'standard') {
      sorted = items;
    } else {
      sorted = [...items].sort((a, b) => {
        switch (sortBy) {
          case 'name':
            return (a.Object_Name || '').localeCompare(b.Object_Name || '', 'de');
          case 'type':
            return (a.Object_Type || '').localeCompare(b.Object_Type || '', 'de')
              || (a.Object_Name || '').localeCompare(b.Object_Name || '', 'de');
          case 'file':
            return (a.File_Name || '').localeCompare(b.File_Name || '', 'de')
              || (a.Object_Name || '').localeCompare(b.Object_Name || '', 'de');
          default:
            return 0;
        }
      });
    }

    if (groupBy === 'none') {
      return sorted.map(obj => ({ _type: 'item' as const, object: obj }));
    }

    const groups = new Map<string, FMObject[]>();
    for (const obj of sorted) {
      const key = groupBy === 'type'
        ? (obj.Object_Type || '(Unbekannt)')
        : (obj.File_Name || '(Unbekannt)');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(obj);
    }

    const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'de'));

    const rows: VirtualListRow[] = [];
    for (const key of sortedKeys) {
      const groupItems = groups.get(key)!;
      const isExpanded = expandedGroups.has(key);
      rows.push({ _type: 'header', groupKey: key, groupLabel: key, itemCount: groupItems.length, isExpanded });
      if (isExpanded) {
        for (const obj of groupItems) {
          rows.push({ _type: 'item', object: obj });
        }
      }
    }
    return rows;
  }, [items, sortBy, groupBy, expandedGroups]);

  // Scroll-Reset bei Filter-/Sort-/Group-Wechsel. Sonst bleibt nach einem weit
  // gescrollten Ergebnis die alte Scroll-Position stehen, während die neue
  // (oft viel kleinere) Trefferliste oben rendert — das Fenster wirkt leer.
  // Guard: wenn bereits oben, nichts tun (kein erzwungenes Scroll-Event,
  // kein Konflikt mit useScrollRestore beim Back-Navigieren).
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el && el.scrollTop > 0) {
      el.scrollTop = 0;
    }
  }, [sortBy, groupBy, debouncedSearchName, selectedFile, objectType]);

  const handleToggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const handleItemClick = useCallback((uuid: string) => {
    saveScrollPosition('search-list', scrollContainerRef.current);
    navigate(`/object/${uuid}`);
  }, [navigate, saveScrollPosition]);

  // Pseudo-Token-Drilldown: PluginComponent → PluginFunction (Hierarchie
  // aus PSEUDO_TYPE_DRILLDOWN in shared/constants). Statt zur DetailView
  // navigieren wir auf die Filteransicht des Kind-Typs mit dem Container-
  // Namen als Category-Filter — File-/Sort-Kontext bleibt erhalten.
  const handlePseudoDrilldown = useCallback((d: { type: string; via: 'category'; value: string }) => {
    const params = new URLSearchParams();
    params.set('type', d.type);
    params.set(d.via, d.value);
    if (selectedFile) params.set('file', selectedFile);
    const currentSort = searchParams.get('sort');
    if (currentSort) params.set('sort', currentSort);
    setSearchParams(params, { replace: false });
  }, [selectedFile, searchParams, setSearchParams]);

  const isTreeMode = mode === 'tree';
  const filterLabel = isTreeMode ? 'Filter:' : 'Suche nach Name:';
  const filterPlaceholder = isTreeMode
    ? 'Filtere die Hierarchie nach Namen'
    : 'z.B. Import, Email (leer = alle Objekte)';
  const filterTitle = isTreeMode
    ? 'Items mit diesem Text im Namen werden hervorgehoben (inkl. Eltern-Folder)'
    : 'Wildcard * fuer beliebige Zeichen (z.B. *Import, Email*). Leer lassen fuer alle Objekte.';

  return (
    <div className="app">
      <div className="app-title-row">
        <h1>FileMaker Object Browser</h1>
        <div className="app-title-actions">
          <ThemeToggle />
          <Link to="/settings" className="app-settings-link" aria-label="Plugin-Einstellungen" title="Plugin-Einstellungen">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
        </div>
      </div>

      <nav className="app-mode-tabs" role="tablist" aria-label="Ansichts-Modus">
        <button
          type="button"
          className={`tab-button tab-button--home${!debouncedSearchName && !selectedFile && !objectType && mode === 'search' ? ' active' : ''}`}
          onClick={() => navigate('/')}
          title="Startseite (Filter zurücksetzen)"
          aria-label="Startseite"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'search'}
          className={`tab-button${mode === 'search' ? ' active' : ''}`}
          onClick={() => setMode('search')}
        >
          Suche
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'tree'}
          className={`tab-button${mode === 'tree' ? ' active' : ''}`}
          onClick={() => setMode('tree')}
        >
          Hierarchie
        </button>
      </nav>

      <div className="search-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="search-name">{filterLabel}</label>
            <input
              ref={searchInputRef}
              id="search-name"
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchName('');
                  e.currentTarget.blur();
                }
              }}
              onFocus={() => { wasFocusedRef.current = true; }}
              onBlur={() => { wasFocusedRef.current = false; }}
              placeholder={filterPlaceholder}
              title={filterTitle}
            />
          </div>

          <div className="form-group">
            <label htmlFor="file-name">Datei:</label>
            <select
              id="file-name"
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
            >
              <option value="">Alle Dateien</option>
              {files.map((file) => (
                <option key={file.File_Name || ''} value={file.File_Name || ''}>
                  {file.File_Name}
                </option>
              ))}
            </select>
          </div>

          {isTreeMode ? (
            <div className="form-group">
              <label htmlFor="tree-subtype">Typ:</label>
              <select
                id="tree-subtype"
                value={treeSubtype}
                onChange={(e) => setTreeSubtype(e.target.value as FolderTreeSubtype)}
              >
                {(Object.keys(TREE_SUBTYPE_LABELS) as FolderTreeSubtype[]).map(st => (
                  <option key={st} value={st}>{TREE_SUBTYPE_LABELS[st]}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="object-type">Objekttyp:</label>
              <select
                id="object-type"
                value={objectType}
                onChange={(e) => setObjectType(e.target.value)}
              >
                <option value="">Alle Typen</option>
                {OBJECT_TYPES.filter(t => !PSEUDO_TYPE_SET.has(t)).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
                <optgroup label="Verwendete Tokens">
                  {PSEUDO_TYPE_GROUP.map((type) => (
                    <option key={type} value={type}>
                      {OBJECT_TYPE_LABELS_DE[type] ?? type}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}

          {!isTreeMode && (
            <button
              className="search-options-toggle"
              onClick={() => setOptionsOpen(prev => !prev)}
              aria-expanded={optionsOpen}
              type="button"
            >
              {optionsOpen ? 'Optionen ▴' : 'Optionen...'}
            </button>
          )}
        </div>

        {!isTreeMode && optionsOpen && (
          <SearchOptions
            sortBy={sortBy}
            groupBy={groupBy}
            onSortChange={setSortBy}
            onGroupChange={setGroupBy}
          />
        )}
      </div>

      {/* Context-Label — gesetzt wenn via Dashboard-Action mit ?label=... navigiert */}
      {!isTreeMode && (debouncedSearchName || selectedFile || objectType) && searchParams.get('label') && (
        <div className="search-context-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          {searchParams.get('label')}
        </div>
      )}

      {/* Error message (search mode only) */}
      {!isTreeMode && error && objectType !== 'RelationshipGraph' && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* RelationshipGraph: Spezial-Einstiegspunkt — keine Liste, sondern Direktlink */}
      {!isTreeMode && objectType === 'RelationshipGraph' && (
        <div className="relationship-graph-entry">
          {selectedFile ? (
            <Link
              to={`/relationship-graph/${encodeURIComponent(selectedFile)}`}
              className="relationship-graph-entry-card"
            >
              <span className="relationship-graph-entry-title">
                Beziehungsdiagramm öffnen
              </span>
              <span className="relationship-graph-entry-file">{selectedFile}</span>
              <span className="relationship-graph-entry-hint">→</span>
            </Link>
          ) : (
            <div className="relationship-graph-entry-empty">
              Bitte oben eine Datei auswählen, um das Beziehungsdiagramm anzuzeigen.
            </div>
          )}
        </div>
      )}

      {/* Search mode: Pseudo-Token-Typen — eigene aggregierte Ansicht (PRD §8) */}
      {!isTreeMode && PSEUDO_TYPE_SET.has(objectType) && (
        <PseudoTokenView
          objectType={objectType}
          file={selectedFile || undefined}
          onItemClick={handleItemClick}
          onDrilldown={handlePseudoDrilldown}
          initialCategory={searchParams.get('category') || undefined}
          initialSort={(searchParams.get('sort') as 'usage' | 'name' | 'category') || undefined}
        />
      )}

      {/* Search mode: Default-Dashboard — sichtbar wenn KEINE Filter aktiv (PRD §8) */}
      {!isTreeMode && !debouncedSearchName && !selectedFile && !objectType && (
        <DashboardHost id="home" />
      )}

      {/* Search mode: Virtual list — nur wenn Filter aktiv und kein Spezial-Typ */}
      {!isTreeMode && (debouncedSearchName || selectedFile || objectType) && !error && objectType !== 'RelationshipGraph' && !PSEUDO_TYPE_SET.has(objectType) && (
        <VirtualList
          rows={processedRows}
          itemCount={items.length}
          isLoading={loading || loadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          totalCount={totalCount}
          onItemClick={handleItemClick}
          onToggleGroup={handleToggleGroup}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* Search mode: Initial loading state (nicht für Pseudo-Typen — eigener Loader) */}
      {!isTreeMode && (debouncedSearchName || selectedFile || objectType) && objectType !== 'RelationshipGraph' && !PSEUDO_TYPE_SET.has(objectType) && loading && items.length === 0 && (
        <div className="virtual-list-empty">
          Lade Objekte...
        </div>
      )}

      {/* Tree mode: Folder tree */}
      {isTreeMode && (
        <FolderTree
          subtype={treeSubtype}
          file={selectedFile || undefined}
          filter={debouncedSearchName}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<SearchView />} />
      <Route path="/object/:uuid" element={<DetailView />} />
      <Route path="/settings" element={<SettingsView />} />
      <Route path="/relationship-graph/:fileName" element={<RelationshipGraphView />} />
      <Route path="/relationship-graph" element={<RelationshipGraphView />} />
      <Route path="/layout/:uuid" element={<LayoutView />} />
      <Route path="/dashboard/:id" element={<DashboardView />} />
      <Route path="/query/:queryName" element={<QueryView />} />
    </Routes>
  );
}

export default App;
