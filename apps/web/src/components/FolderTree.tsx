import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { useTemplateQuery } from '../hooks/useTemplateQuery';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import './FolderTree.css';

const ROW_HEIGHT = 36;
const SEPARATOR_HEIGHT = 14;
const INDENT_PX = 18;

export type FolderTreeSubtype = 'ScriptCatalog' | 'Layouts' | 'CustomFunctionsCatalog';

interface TreeRow {
  uuid: string;
  name: string;
  type: string;       // Folder | Script | Layout | CustomFunction | Separator
  subtype: string;    // Folder | Item | Separator
  nesting_level: number;
  file: string;
  sequence: number;
}

interface FolderTreeProps {
  subtype: FolderTreeSubtype;
  file?: string;
  filter?: string;
}

function loadExpandedFromStorage(subtype: FolderTreeSubtype): Set<string> {
  try {
    const raw = localStorage.getItem(`folderTree:expanded:${subtype}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function saveExpandedToStorage(subtype: FolderTreeSubtype, expanded: Set<string>): void {
  try {
    localStorage.setItem(`folderTree:expanded:${subtype}`, JSON.stringify([...expanded]));
  } catch {
    // ignore quota errors
  }
}

function computeUnfilteredVisibleRows(rows: TreeRow[], expanded: Set<string>): TreeRow[] {
  const out: TreeRow[] = [];
  let hideUntilLevel = -1;
  for (const row of rows) {
    if (hideUntilLevel >= 0 && row.nesting_level > hideUntilLevel) {
      continue;
    }
    hideUntilLevel = -1;
    out.push(row);
    if (row.subtype === 'Folder' && !expanded.has(row.uuid)) {
      hideUntilLevel = row.nesting_level;
    }
  }
  return out;
}

function computeFilteredVisibleRows(rows: TreeRow[], filterLower: string): TreeRow[] {
  // Pass 1: Sammele Match-UUIDs (Items + Folder die selbst matchen) + alle ihre Eltern-Folder
  const visibleSet = new Set<string>();
  const folderStack: { level: number; uuid: string }[] = [];
  for (const row of rows) {
    while (folderStack.length > 0 && folderStack[folderStack.length - 1].level >= row.nesting_level) {
      folderStack.pop();
    }
    if (row.subtype === 'Folder') {
      folderStack.push({ level: row.nesting_level, uuid: row.uuid });
      if (row.name.toLowerCase().includes(filterLower)) {
        visibleSet.add(row.uuid);
        for (const f of folderStack) visibleSet.add(f.uuid);
      }
    } else if (row.subtype === 'Item') {
      if (row.name.toLowerCase().includes(filterLower)) {
        visibleSet.add(row.uuid);
        for (const f of folderStack) visibleSet.add(f.uuid);
      }
    }
    // Separators matchen nie selbst (Name = '-')
  }

  // Pass 2: Output unter Berücksichtigung der Sichtbarkeit
  const out: TreeRow[] = [];
  const currentStack: { level: number; uuid: string; visible: boolean }[] = [];
  for (const row of rows) {
    while (currentStack.length > 0 && currentStack[currentStack.length - 1].level >= row.nesting_level) {
      currentStack.pop();
    }
    if (row.subtype === 'Folder') {
      const isVis = visibleSet.has(row.uuid);
      currentStack.push({ level: row.nesting_level, uuid: row.uuid, visible: isVis });
      if (isVis) out.push(row);
    } else if (row.subtype === 'Item') {
      if (visibleSet.has(row.uuid)) out.push(row);
    } else if (row.subtype === 'Separator') {
      const parent = currentStack.length > 0 ? currentStack[currentStack.length - 1] : null;
      if (parent?.visible) out.push(row);
    }
  }
  return out;
}

export const FolderTree: React.FC<FolderTreeProps> = ({ subtype, file, filter }) => {
  const { t } = useTranslation(['nav']);
  const navigate = useNavigate();
  const params = useMemo(() => {
    const p: Record<string, string> = { subtype };
    if (file) p.file = file;
    return p;
  }, [subtype, file]);

  const { data, loading, error, retry } = useTemplateQuery('list_with_folders', params, true);

  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpandedFromStorage(subtype));

  useEffect(() => {
    setExpanded(loadExpandedFromStorage(subtype));
  }, [subtype]);

  useEffect(() => {
    saveExpandedToStorage(subtype, expanded);
  }, [subtype, expanded]);

  const rows: TreeRow[] = useMemo(() => {
    if (!data) return [];
    return data.map(r => ({
      uuid: String(r.uuid ?? ''),
      name: String(r.name ?? ''),
      type: String(r.type ?? 'Item'),
      subtype: String(r.subtype ?? 'Item'),
      nesting_level: Number(r.nesting_level ?? 0),
      file: String(r.file ?? ''),
      sequence: Number(r.sequence ?? 0),
    }));
  }, [data]);

  const filterTrimmed = (filter ?? '').trim();
  const filterActive = filterTrimmed.length > 0;

  const visibleRows: TreeRow[] = useMemo(() => {
    if (filterActive) {
      return computeFilteredVisibleRows(rows, filterTrimmed.toLowerCase());
    }
    return computeUnfilteredVisibleRows(rows, expanded);
  }, [rows, expanded, filterActive, filterTrimmed]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      visibleRows[index]?.subtype === 'Separator' ? SEPARATOR_HEIGHT : ROW_HEIGHT,
    overscan: 12,
  });

  // Wenn der Filter sich ändert, muss der Virtualizer die Höhen neu berechnen
  useEffect(() => {
    virtualizer.measure();
  }, [filterActive, filterTrimmed, virtualizer]);

  const toggleFolder = useCallback((uuid: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(rows.filter(r => r.subtype === 'Folder').map(r => r.uuid)));
  }, [rows]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const handleItemClick = useCallback((row: TreeRow) => {
    if (row.subtype === 'Separator') return;
    navigate(`/object/${row.uuid}`);
  }, [navigate]);

  if (loading) {
    return <LoadingSpinner message={t('nav:folderTree.loading') as string} />;
  }
  if (error) {
    return <ErrorMessage message={error} onRetry={retry} />;
  }
  if (!rows.length) {
    return <div className="folder-tree-empty">{t('nav:folderTree.empty')}</div>;
  }

  const folderCount = rows.filter(r => r.subtype === 'Folder').length;
  const itemCount = rows.filter(r => r.subtype === 'Item').length;
  const visibleItemCount = visibleRows.filter(r => r.subtype === 'Item').length;
  const visibleFolderCount = visibleRows.filter(r => r.subtype === 'Folder').length;

  return (
    <div className="folder-tree">
      <div className="folder-tree-toolbar">
        <span className="folder-tree-stats">
          {filterActive ? (
            t('nav:folderTree.statsFiltered', {
              visibleEntries: visibleItemCount,
              totalEntries: itemCount,
              visibleFolders: visibleFolderCount,
              totalFolders: folderCount,
            })
          ) : (
            t('nav:folderTree.stats', {
              entries: itemCount,
              folders: folderCount,
            })
          )}
        </span>
        <button
          type="button"
          onClick={expandAll}
          className="folder-tree-toolbar-button"
          disabled={filterActive}
          title={(filterActive ? t('nav:folderTree.disabledDuringFilter') : t('nav:folderTree.expandAll')) as string}
        >
          {t('nav:folderTree.expandAll')}
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="folder-tree-toolbar-button"
          disabled={filterActive}
          title={(filterActive ? t('nav:folderTree.disabledDuringFilter') : t('nav:folderTree.collapseAll')) as string}
        >
          {t('nav:folderTree.collapseAll')}
        </button>
      </div>

      <div ref={parentRef} className="folder-tree-scroll">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map(vi => {
            const row = visibleRows[vi.index];
            const isFolder = row.subtype === 'Folder';
            const isSeparator = row.subtype === 'Separator';
            const isExpanded = isFolder && (filterActive || expanded.has(row.uuid));
            const indent = row.nesting_level * INDENT_PX;

            return (
              <div
                key={`${row.uuid}-${row.sequence}`}
                className={`folder-tree-row folder-tree-row-${row.subtype.toLowerCase()}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {isSeparator ? (
                  <div className="folder-tree-separator" style={{ paddingLeft: indent + 8 }}>
                    <hr />
                  </div>
                ) : (
                  <div
                    className="folder-tree-item"
                    style={{ paddingLeft: indent + 8 }}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (isFolder && !filterActive) {
                        toggleFolder(row.uuid);
                      } else {
                        handleItemClick(row);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (isFolder && !filterActive) toggleFolder(row.uuid);
                        else handleItemClick(row);
                      }
                    }}
                  >
                    <span className="folder-tree-toggle">
                      {isFolder ? (isExpanded ? '▾' : '▸') : ''}
                    </span>
                    <span className={`folder-tree-badge folder-tree-badge-${row.type.toLowerCase()}`}>
                      {badgeForType(row.type)}
                    </span>
                    <span className="folder-tree-name">{row.name || (t('nav:folderTree.noName') as string)}</span>
                    <span className="folder-tree-file">{row.file}</span>
                    {isFolder && (
                      <button
                        type="button"
                        className="folder-tree-detail-link"
                        title={t('nav:folderTree.folderDetailsTitle') as string}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleItemClick(row);
                        }}
                      >
                        Details
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function badgeForType(type: string): string {
  switch (type) {
    case 'Folder':         return 'DIR';
    case 'Script':         return 'SCR';
    case 'Layout':         return 'LAY';
    case 'CustomFunction': return 'CF';
    default:               return '';
  }
}
