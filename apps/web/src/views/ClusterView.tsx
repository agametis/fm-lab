import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SubNav } from '../components/SubNav';
import { StatusBar } from '../components/StatusBar';
import { CommunityAnnotationForm } from '../components/CommunityAnnotationForm';
import { SemanticNamesStatus } from '../dashboard/primitives/SemanticNamesStatus';
import { buildBreadcrumb } from '../lib/navigation';
import { useCommunityStats } from '../hooks/useCommunityStats';
import { useCommunities, type Community } from '../hooks/useCommunities';
import './ClusterView.css';

/**
 * Cluster-Übersicht (`/cluster`). Eigene React-Page (wie
 * `/atlas`, kein DashboardHost): Hero mit KPI-Kacheln (Communities · Nodes ·
 * Edges) + zweizeiliger Run-Status · Filter-Zeile (alle/benannt/unbenannt +
 * Suche) · Liste aller Communities mit Inline-`[Edit]` (geteilte
 * `CommunityAnnotationForm`) und Klick → Graph-Explorer · Bottom = derselbe
 * Heil-Block wie `/xml-import` (`SemanticNamesStatus` mit `context="cluster"`).
 */

const REFRESH_EVENT = 'fmlab:refresh-datasets';

type FilterMode = 'all' | 'named' | 'unnamed';

/** Deep-Link in den Graph-Explorer (Klon-disambiguiert via focus_file) — Atlas-Muster. */
function explorerPath(uuid: string, file: string | null): string {
  const p = new URLSearchParams();
  p.set('focus', uuid);
  if (file) p.set('focus_file', file);
  p.set('depth', '1');
  p.set('dir', 'both');
  return `/graph?${p.toString()}`;
}

/** „Benannt" = User- oder Semantic-Name greift (sonst nur Heuristik = unbenannt). */
function isNamed(c: Community): boolean {
  return !!(c.user_name || c.semantic_name);
}

export function ClusterView() {
  const { t, i18n } = useTranslation(['cluster', 'nav']);
  const navigate = useNavigate();

  const { data: stats, refetch: refetchStats } = useCommunityStats();
  const { data: communitiesData, loading: listLoading, refetch: refetchList } = useCommunities();

  const [editing, setEditing] = useState<number | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  // Nach „Communities neu" (SemanticNamesStatus feuert REFRESH_EVENT) Status UND
  // Liste neu laden (② kann steigen — neue Module als unbenannt sichtbar).
  useEffect(() => {
    const onRefresh = () => {
      refetchStats();
      refetchList();
    };
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
  }, [refetchStats, refetchList]);

  const breadcrumbs = buildBreadcrumb({ kind: 'cluster' }, t);

  const engine = communitiesData?.engine ?? stats?.engine ?? '';
  const communities = communitiesData?.communities ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return communities.filter((c) => {
      if (filterMode === 'named' && !isNamed(c)) return false;
      if (filterMode === 'unnamed' && isNamed(c)) return false;
      if (!q) return true;
      const hay = [c.display_name, c.description, c.heuristic_name, c.dominant_file, c.dominant_type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [communities, filterMode, search]);

  // ── Hero-KPIs + Run-Status ──
  const run = stats?.run ?? null;
  const dash = t('cluster:status.dash');
  const fmtNum = (v: number | null | undefined) =>
    v == null ? dash : Number(v).toLocaleString(i18n.language);

  const algorithm = engine ? engine.charAt(0).toUpperCase() + engine.slice(1) : dash;
  const modularity = run?.modularity_q != null ? Number(run.modularity_q).toFixed(4) : dash;
  const resolution = run?.resolution != null ? String(run.resolution) : dash;
  const seed = run?.seed != null ? String(run.seed) : dash;
  const lastRun = stats?.last_run
    ? new Date(stats.last_run).toLocaleString(i18n.language, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : dash;

  const openRow = (c: Community) => {
    if (c.top_member_uuid) navigate(explorerPath(c.top_member_uuid, c.top_member_file));
  };

  const onSaved = () => {
    setEditing(null);
    refetchList();
    refetchStats();
  };

  const FILTER_MODES: FilterMode[] = ['all', 'named', 'unnamed'];

  return (
    <div className="app cluster-view">
      <SubNav breadcrumbs={breadcrumbs} />
      <StatusBar />

      <div className="cluster-page">
        <header className="cluster-header">
          <h1 className="cluster-title">{t('cluster:title')}</h1>
          <p className="cluster-subtitle">{t('cluster:subtitle')}</p>
        </header>

        {/* Hero-Balken: KPI-Kacheln + zweizeiliger Run-Status. */}
        <section className="cluster-hero">
          <div className="cluster-hero__kpis">
            <div className="cluster-kpi">
              <span className="cluster-kpi__label">{t('cluster:hero.communities')}</span>
              <span className="cluster-kpi__value">{fmtNum(stats?.total_communities)}</span>
            </div>
            <div className="cluster-kpi">
              <span className="cluster-kpi__label">{t('cluster:hero.nodes')}</span>
              <span className="cluster-kpi__value">{fmtNum(run?.n_nodes)}</span>
            </div>
            <div className="cluster-kpi">
              <span className="cluster-kpi__label">{t('cluster:hero.edges')}</span>
              <span className="cluster-kpi__value">{fmtNum(run?.n_edges)}</span>
            </div>
          </div>
          <div className="cluster-hero__status">
            <div className="cluster-status-line">
              <span>{t('cluster:status.algorithm')}: {algorithm}</span>
              <span className="cluster-status__sep">·</span>
              <span>modularity: {modularity}</span>
              <span className="cluster-status__sep">·</span>
              <span>resolution: {resolution}</span>
              <span className="cluster-status__sep">·</span>
              <span>seed: {seed}</span>
              <span className="cluster-status__sep">·</span>
              <span>{t('cluster:status.lastRun')}: {lastRun}</span>
            </div>
            <div className="cluster-status-line cluster-status-line--named">
              {t('cluster:status.named', {
                named: stats?.named_communities ?? 0,
                total: stats?.total_communities ?? 0,
              })}
            </div>
          </div>
        </section>

        {/* Liste / Empty-State. */}
        {communities.length > 0 ? (
          <>
            <div className="cluster-toolbar">
              <div className="cluster-segbar" role="tablist" aria-label={t('cluster:title') as string}>
                {FILTER_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={filterMode === m}
                    className={`cluster-segbtn${filterMode === m ? ' active' : ''}`}
                    onClick={() => setFilterMode(m)}
                  >
                    {t(`cluster:filter.${m}`)}
                  </button>
                ))}
              </div>
              <span className="cluster-count">
                {t('cluster:list.count', { shown: filtered.length, total: communities.length })}
              </span>
              <input
                type="search"
                className="cluster-search"
                placeholder={t('cluster:list.search') as string}
                aria-label={t('cluster:list.search') as string}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <ul className="cluster-list">
              {filtered.map((c) => {
                const clickable = !!c.top_member_uuid;
                return (
                  <li key={c.community} className="cluster-item">
                    <div className="cluster-row">
                      <div
                        className={`cluster-row__main${clickable ? ' cluster-row__main--clickable' : ''}`}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={clickable ? () => openRow(c) : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openRow(c);
                                }
                              }
                            : undefined
                        }
                        title={clickable ? (t('cluster:list.openHint') as string) : undefined}
                      >
                        <div className="cluster-row__name">
                          {c.display_name}
                          {!isNamed(c) && (
                            <span className="cluster-row__badge">{t('cluster:list.unnamedBadge')}</span>
                          )}
                        </div>
                        <div className="cluster-row__meta">
                          {t('cluster:list.members', { count: c.member_count })}
                          {c.dominant_type ? ` · ${c.dominant_type}` : ''}
                          {c.dominant_file ? ` · ${c.dominant_file}` : ''}
                        </div>
                        {c.description && <div className="cluster-row__desc">{c.description}</div>}
                      </div>
                      <button
                        type="button"
                        className="cluster-row__edit"
                        aria-expanded={editing === c.community}
                        onClick={() => setEditing(editing === c.community ? null : c.community)}
                      >
                        {t('cluster:list.edit')}
                      </button>
                    </div>

                    {editing === c.community && (
                      <div className="cluster-row__editor">
                        <CommunityAnnotationForm
                          engine={engine}
                          community={c.community}
                          initialName={c.user_name ?? ''}
                          initialNotes={c.user_notes ?? ''}
                          onSaved={onSaved}
                          onCancel={() => setEditing(null)}
                          autoFocus
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="cluster-empty">
            <strong>{t('cluster:empty.title')}</strong>
            <p>{listLoading ? t('cluster:loading') : t('cluster:empty.hint')}</p>
          </div>
        )}

        {/* Bottom-Heil-Block — identisch zu /xml-import (Gauges + „Communities neu"
            + Skill-Hinweis), ohne „Communities zeigen"-Button (context="cluster"). */}
        <section className="cluster-heal">
          <SemanticNamesStatus context="cluster" />
        </section>
      </div>
    </div>
  );
}

export default ClusterView;
