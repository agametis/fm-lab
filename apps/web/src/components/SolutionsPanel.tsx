import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  fetchSolutions,
  activateSolution,
  createSolution,
  renameSolution,
  renameSolutionBundle,
  deleteSolution,
  type SolutionInfo,
} from '../api/solutionsApi';
import { setSelectedSolution } from '../lib/solutionStore';
import './SolutionsPanel.css';

/** Polling-Intervall für den Live-Import-Status (nur bei sichtbarer Seite). */
const IMPORT_POLL_MS = 5000;

/** Sortierbare Spalten der Solution-Liste. */
type SortKey = 'id' | 'name' | 'size' | 'files' | 'lastImport' | 'duration';

/**
 * Settings section "Solutions" (multi-solution phase 1): lists every solution
 * bundle with size / file count / last import, offers activate, create and
 * delete. Deleting removes the WHOLE bundle including the XML sources — hence
 * a double confirmation with an explicit hint and an export suggestion.
 *
 * Additionally, per-row "XML import" jumps to the context-aware import page
 * (`/xml-import?solution_id=<id>`) WITHOUT activating; the "last import"
 * column shows a pulsing live state while an import runs (per-solution lock,
 * CLI runs included), polled every 5 s while the page is visible; running rows
 * disable activate/delete/rename; "Change ID…" performs the bundle rename
 * (folder/id — the manifest UUID keeps the identity).
 */
export const SolutionsPanel: React.FC = () => {
  const { t, i18n } = useTranslation(['detail']);
  const navigate = useNavigate();
  const [solutions, setSolutions] = useState<SolutionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const load = useCallback(async () => {
    try {
      setSolutions(await fetchSolutions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live-Status-Polling: das Listing ist billig (Manifest-Scan + Lock-Check,
  // kein DB-Open) — 5 s reichen, und nur solange der Tab sichtbar ist.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = window.setInterval(tick, IMPORT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Aktionsmenü (Hamburger-Popout) schließen bei Klick außerhalb oder Escape.
  useEffect(() => {
    if (menuId == null) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.solutions-panel__menu-wrap')) setMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuId(null); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(i18n.language) : '—';

  // Dauer des letzten Konvertierungs-Laufs: unter 60 s mit einer
  // Nachkommastelle, darüber als "Xm YYs".
  const fmtDuration = (ms: number | null) => {
    if (ms == null) return '—';
    if (ms < 60_000) return `${(ms / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} s`;
    const totalSec = Math.round(ms / 1000);
    return `${Math.floor(totalSec / 60)}m ${String(totalSec % 60).padStart(2, '0')}s`;
  };

  // Klick auf einen Spaltenkopf: gleiche Spalte → Richtung umkehren, sonst neue
  // Spalte aufsteigend beginnen.
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // Sichtbare Zeilen: erst nach Suchtext filtern (ID + Anzeigename), dann
  // optional nach der gewählten Spalte sortieren. Ohne aktive Sortierung bleibt
  // die Server-Reihenfolge erhalten.
  const visibleSolutions = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = q
      ? solutions.filter((s) =>
          `${s.id} ${s.display_name ?? ''}`.toLowerCase().includes(q))
      : solutions;
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1;
      const name = (s: SolutionInfo) => (s.display_name || s.id);
      const time = (iso: string | null) => (iso ? new Date(iso).getTime() : -Infinity);
      rows = [...rows].sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case 'id':         cmp = a.id.localeCompare(b.id, i18n.language, { numeric: true }); break;
          case 'name':       cmp = name(a).localeCompare(name(b), i18n.language, { numeric: true, sensitivity: 'base' }); break;
          case 'size':       cmp = (a.size_mb ?? -1) - (b.size_mb ?? -1); break;
          case 'files':      cmp = (a.file_count ?? -1) - (b.file_count ?? -1); break;
          case 'lastImport': cmp = time(a.last_import_at) - time(b.last_import_at); break;
          case 'duration':   cmp = (a.last_run_duration_ms ?? -1) - (b.last_run_duration_ms ?? -1); break;
        }
        // Gleichstand stabil nach ID reihen.
        return (cmp !== 0 ? cmp : a.id.localeCompare(b.id)) * dir;
      });
    }
    return rows;
  }, [solutions, query, sortKey, sortDir, i18n.language]);

  const startRename = (s: SolutionInfo) => {
    setEditingId(s.id);
    setEditValue(s.display_name || s.id);
  };

  const commitRename = async () => {
    const id = editingId;
    const name = editValue.trim();
    if (!id) return;
    setEditingId(null);
    const current = solutions.find((s) => s.id === id);
    if (!name || name === (current?.display_name || id)) return;
    setBusy(id);
    try {
      await renameSolution(id, name);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleActivate = async (id: string) => {
    setBusy(id);
    try {
      await activateSolution(id);
      setSelectedSolution(id);
      // Same clean-slate path as the header picker / import reload.
      window.location.reload();
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreate = async () => {
    const id = newId.trim();
    if (!id) return;
    setBusy('__create');
    try {
      await createSolution(id, newName.trim() || undefined);
      setNewId('');
      setNewName('');
      setCreateOpen(false);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // Bundle-Rename (ID/Ordnername — die UUID bleibt die Identität). Bewusst als
  // expliziter Dialog mit Folgen-Hinweis, getrennt vom Inline-Anzeigename-Edit.
  const handleRenameId = async (s: SolutionInfo) => {
    const input = window.prompt(
      t('detail:settingsView.solutions.renameIdPrompt', { id: s.id }) as string,
      s.id,
    );
    if (input == null) return;
    const to = input.trim();
    if (!to || to === s.id) return;
    setBusy(s.id);
    try {
      const result = await renameSolutionBundle(s.id, to);
      if (result.was_active) {
        // Aktive Lösung umbenannt → Server hat Pointer + Reload nachgezogen.
        setSelectedSolution(result.to);
        window.location.reload();
        return;
      }
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (s: SolutionInfo) => {
    // Double confirmation: the bundle contains the XML sources.
    const name = s.display_name || s.id;
    if (!window.confirm(t('detail:settingsView.solutions.deleteConfirm1', { name }) as string)) return;
    if (!window.confirm(t('detail:settingsView.solutions.deleteConfirm2', { id: s.id }) as string)) return;
    setBusy(s.id);
    try {
      await deleteSolution(s.id);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="solutions-panel">
      <h2 className="api-settings-heading">{t('detail:settingsView.solutions.heading')}</h2>
      <p className="api-settings-desc">{t('detail:settingsView.solutions.description')}</p>

      {error && <div className="solutions-panel__error">{error}</div>}

      <input
        type="search"
        className="solutions-panel__search"
        placeholder={t('detail:settingsView.solutions.searchPlaceholder') as string}
        aria-label={t('detail:settingsView.solutions.searchPlaceholder') as string}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <table className="solutions-panel__table">
        <thead>
          <tr>
            {([
              ['id', 'colId'],
              ['name', 'colName'],
              ['size', 'colSize'],
              ['files', 'colFiles'],
              ['lastImport', 'colLastImport'],
              ['duration', 'colDuration'],
            ] as [SortKey, string][]).map(([key, label]) => (
              <th
                key={key}
                className="solutions-panel__th--sortable"
                aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                onClick={() => toggleSort(key)}
              >
                {t(`detail:settingsView.solutions.${label}`)}{sortIndicator(key)}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {visibleSolutions.map((s) => (
            <tr key={s.id} className={s.is_active ? 'solutions-panel__row--active' : undefined}>
              <td>
                <span className="solutions-panel__id">{s.id}</span>
              </td>
              <td>
                {editingId === s.id ? (
                  <input
                    type="text"
                    className="solutions-panel__rename-input"
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <span
                      className="solutions-panel__name solutions-panel__name--editable"
                      title={t('detail:settingsView.solutions.renameTitle') as string}
                      onClick={() => startRename(s)}
                    >
                      {s.display_name || s.id}
                    </span>
                    <button
                      type="button"
                      className="solutions-panel__rename"
                      title={t('detail:settingsView.solutions.renameTitle') as string}
                      aria-label={t('detail:settingsView.solutions.renameTitle') as string}
                      onClick={() => startRename(s)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    </button>
                  </>
                )}
              </td>
              <td>{s.size_mb != null ? `${s.size_mb.toLocaleString(i18n.language)} MB` : '—'}</td>
              <td>{s.file_count ?? '—'}</td>
              <td>
                {s.import_running ? (
                  <span className="solutions-panel__importing">
                    {t('detail:settingsView.solutions.importRunning')}
                  </span>
                ) : (
                  fmtDate(s.last_import_at)
                )}
              </td>
              <td>{fmtDuration(s.last_run_duration_ms)}</td>
              <td className="solutions-panel__actions">
                {s.is_active && (
                  <span
                    className="solutions-panel__badge"
                    role="img"
                    title={t('detail:settingsView.solutions.activeBadge') as string}
                    aria-label={t('detail:settingsView.solutions.activeBadge') as string}
                  >
                    <span className="solutions-panel__badge-dot" aria-hidden="true" />
                  </span>
                )}
                <div className="solutions-panel__menu-wrap">
                  <button
                    type="button"
                    className="solutions-panel__menu-toggle"
                    aria-haspopup="true"
                    aria-expanded={menuId === s.id}
                    title={t('detail:settingsView.solutions.menuLabel') as string}
                    aria-label={t('detail:settingsView.solutions.menuLabel') as string}
                    onClick={() => setMenuId((cur) => (cur === s.id ? null : s.id))}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <line x1="3" y1="12" x2="21" y2="12" />
                      <line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                  </button>
                  {menuId === s.id && (
                    <div className="solutions-panel__menu" role="menu">
                      <div className="solutions-panel__menu-title" title={s.display_name || s.id}>
                        {s.display_name || s.id}
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy != null}
                        onClick={() => {
                          setMenuId(null);
                          navigate(`/xml-import?solution_id=${encodeURIComponent(s.id)}`);
                        }}
                        title={t('detail:settingsView.solutions.importButtonTitle') as string}
                      >
                        {t('detail:settingsView.solutions.importButton')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy != null || s.import_running}
                        onClick={() => { setMenuId(null); handleRenameId(s); }}
                        title={t('detail:settingsView.solutions.renameIdTitle') as string}
                      >
                        {t('detail:settingsView.solutions.renameIdButton')}
                      </button>
                      {!s.is_active && (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy != null || s.import_running}
                            onClick={() => { setMenuId(null); handleActivate(s.id); }}
                          >
                            {busy === s.id
                              ? t('detail:settingsView.solutions.activating')
                              : t('detail:settingsView.solutions.activate')}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="solutions-panel__delete"
                            disabled={busy != null || s.import_running || s.id === 'default'}
                            onClick={() => { setMenuId(null); handleDelete(s); }}
                          >
                            {t('detail:settingsView.solutions.deleteButton')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {visibleSolutions.length === 0 && !error && (
            <tr>
              <td colSpan={7}>
                {solutions.length > 0
                  ? t('detail:settingsView.solutions.noMatches')
                  : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {createOpen ? (
        <div className="solutions-panel__create">
          <input
            type="text"
            value={newId}
            placeholder={t('detail:settingsView.solutions.createIdPlaceholder') as string}
            spellCheck={false}
            onChange={(e) => setNewId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <input
            type="text"
            value={newName}
            placeholder={t('detail:settingsView.solutions.createNamePlaceholder') as string}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button type="button" disabled={busy != null || !newId.trim()} onClick={handleCreate}>
            {t('detail:settingsView.solutions.createButton')}
          </button>
          <button type="button" onClick={() => setCreateOpen(false)}>
            {t('detail:settingsView.solutions.createCancel')}
          </button>
        </div>
      ) : (
        <button type="button" className="solutions-panel__new" onClick={() => setCreateOpen(true)}>
          {t('detail:settingsView.solutions.newButton')}
        </button>
      )}
    </section>
  );
};
