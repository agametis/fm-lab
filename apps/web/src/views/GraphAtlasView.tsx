import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { recordDebug } from '../debug/session';
import { useTranslation } from 'react-i18next';
import { getTypeColor } from '../lib/graphColors';
import { buildObjectPath } from '../lib/navigation';
import type { BreadcrumbItem } from '../types';
import { SubNav } from '../components/SubNav';
import { StatusBar } from '../components/StatusBar';
import { NoDataYet } from '../components/NoDataYet';
import { isNoImportError } from '../lib/errors';
import { AtlasNameStatus } from '../components/AtlasNameStatus';
import type { PanelTarget } from '../components/AtlasInfoPanel';
import type { TileInfoKind } from '../components/AtlasTreemap';
import { useCommunityStats } from '../hooks/useCommunityStats';
import { usePersistentState } from '../hooks/usePersistentState';
import {
  useGraphOverview,
  type AtlasQuery,
  type AtlasView,
  type AtlasSegmentBy,
  type AtlasWeight,
  type AtlasTile,
  type AtlasMetaNode,
  type AtlasCompositionResponse,
  type AtlasTopologyResponse,
} from '../hooks/useGraphOverview';
import './GraphAtlasView.css';

/**
 * Graph-Atlas — generischer Top-Down-Einstieg vor dem fokus-zentrierten Graph
 * Explorer. Zwei orthogonale Achsen: Segmentierung (A, Segment-Leiste:
 * Community · Datei · Objekttyp · Top-Knoten) × Darstellung (B, Toggle:
 * Komposition/Treemap ↔ Topologie/Meta-Graph). Linsen: lokales Suchfeld (E6),
 * Objekttyp-Filterleiste (Exclusion), Top-N-Schieberegler (interaktiver
 * „Rest"-Cutoff) und „Weitere"-ausblenden (Button in der Rest-Kachel). Der
 * Atlas rechnet fix mit dem Domänen-Grad (Gewichts-Schalter entfernt, E3).
 *
 * Der gesamte Navigationszustand lebt in der URL (`useSearchParams`) → Ebene,
 * Modus, Drill, Linsen sind deep-link- und reload-fest. visx-Treemap und
 * Cytoscape-Meta-Graph werden lazy geladen (eigene Bundle-Chunks).
 */

const AtlasTreemap = lazy(() => import('../components/AtlasTreemap'));
const AtlasMetaGraph = lazy(() => import('../components/AtlasMetaGraph'));
const AtlasInfoPanel = lazy(() => import('../components/AtlasInfoPanel'));
const AtlasHiddenManager = lazy(() => import('../components/AtlasHiddenManager'));

const SEGMENTS: AtlasSegmentBy[] = ['community', 'file', 'type', 'hubs'];
const VIEWS: AtlasView[] = ['composition', 'topology'];

const TOP_N_MIN = 10;
const TOP_N_MAX = 200;
const TOP_N_STEP = 10;

/** Topologie gibt es nur für Community/Datei (Hubs/Typ sind bereits Einzelknoten). */
const topologyAvailable = (s: AtlasSegmentBy) => s === 'community' || s === 'file';

/** Selektion entlang des Trichters (mit Labels für den Breadcrumb). */
type Drill = {
  segmentBy: AtlasSegmentBy;
  seg?: { key: string; label: string };
  type?: { key: string; label: string };
};

/**
 * Adaptiver Top-N-Default je AKTUELLER Ebene/Modus — die gemessenen Optima
 * (Community 30, Datei/Blatt ~60, Typ-Aggregate ≤27 ⇒ 40 = ungefaltet). Greift,
 * solange der Nutzer den Slider nicht angefasst hat; ein expliziter Wert (URL
 * `top_n`) überschreibt ihn und wird bei jedem Ebenen-/Modus-Wechsel zurückgesetzt,
 * damit der Cutoff wieder zur neuen Kardinalität passt.
 */
function defaultTopN(d: Drill, isTopology: boolean): number {
  if (isTopology) return d.segmentBy === 'community' ? 30 : 60; // Datei-Meta-Graph: alle ~57
  if (d.segmentBy === 'hubs') return 60;                        // Top-Knoten (Blätter)
  if (!d.seg) {                                                 // Ebene 0 (root)
    if (d.segmentBy === 'community') return 30;                 // hunderte → falten
    if (d.segmentBy === 'file') return 60;                      // ~alle Dateien
    return 40;                                                  // Typ (≤27) → ungefaltet
  }
  if (!d.type) return d.segmentBy === 'type' ? 60 : 40;         // Segment: Typ→Datei vs *→Typ
  return 60;                                                    // Blattebene
}

/** Parent-Filter der Segment-Ebene (root → segment), je nach Achse-A-Modus. */
function segParent(segmentBy: AtlasSegmentBy, segKey: string) {
  if (segmentBy === 'community') return { parentCommunity: Number(segKey) };
  if (segmentBy === 'file') return { parentFile: segKey };
  return { parentType: segKey }; // type → group_dim=file
}

/** Parent-Filter der Blattebene (segment → leaf): erste + zweite Selektion. */
function leafParents(segmentBy: AtlasSegmentBy, segKey: string, subKey: string) {
  if (segmentBy === 'community') return { parentCommunity: Number(segKey), parentType: subKey };
  if (segmentBy === 'file') return { parentFile: segKey, parentType: subKey };
  return { parentType: segKey, parentFile: subKey }; // type-Modus: seg=Typ, sub=Datei
}

type Lenses = { view: AtlasView; weight: AtlasWeight; excluded: string[]; topN: number };

/** Trichter-Selektion + Linsen → Endpoint-Query (limit = interaktiver Top-N). */
function buildAtlasQuery(d: Drill, l: Lenses, isTopology: boolean): AtlasQuery {
  const base = {
    weight: l.weight,
    excludeTypes: l.excluded.length ? l.excluded : undefined,
    limit: l.topN,
  };
  if (isTopology) {
    return { view: 'topology', level: 'root', segmentBy: d.segmentBy, ...base };
  }
  if (d.segmentBy === 'hubs') {
    return { view: 'composition', level: 'root', segmentBy: 'hubs', ...base };
  }
  if (!d.seg) {
    return { view: 'composition', level: 'root', segmentBy: d.segmentBy, ...base };
  }
  if (!d.type) {
    return { view: 'composition', level: 'segment', segmentBy: d.segmentBy, ...segParent(d.segmentBy, d.seg.key), ...base };
  }
  return {
    view: 'composition',
    level: 'leaf',
    segmentBy: d.segmentBy,
    ...leafParents(d.segmentBy, d.seg.key, d.type.key),
    ...base,
  };
}

/** Deep-Link in den Graph Explorer (Klon-disambiguiert via focus_file). */
function explorerPath(uuid: string, file: string | null): string {
  const p = new URLSearchParams();
  p.set('focus', uuid);
  if (file) p.set('focus_file', file);
  p.set('depth', '1');
  p.set('dir', 'both');
  return `/graph?${p.toString()}`;
}

const oneOf = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

export function GraphAtlasView() {
  const { t } = useTranslation('atlas');
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  // ── Zustand AUS der URL lesen (Single Source of Truth) ────────────────────
  const segmentBy = oneOf(sp.get('segment_by'), SEGMENTS, 'community');
  const rawView = oneOf(sp.get('view'), VIEWS, 'composition');
  // F4: Gewichts-Schalter (Domäne|Roh) aus der UI entfernt — der Atlas rechnet
  // immer mit dem Domänen-Grad. Backend akzeptiert `weight` weiter (E3), daher
  // fix verdrahtet statt aus der URL gelesen (reaktivierbar ohne Backend-Arbeit).
  const weight: AtlasWeight = 'domain';
  const excluded = (sp.get('exclude') ?? '').split(',').filter(Boolean);
  const search = sp.get('q') ?? '';
  const hideRest = sp.get('hide_rest') === '1';
  // Noise-Filter-Modus für vom Nutzer ausgeblendete Knoten (analog Graph Explorer):
  // 'dim' (Default, rücknehmbar sichtbar) | 'hide' (entfernt, Recovery via Liste).
  // Browser-lokale Präferenz (localStorage, NICHT URL) → überlebt „Zurück"/Reload
  // und verschmutzt Deep-Links nicht; es ist Darstellung, kein Navigationszustand.
  const [hiddenMode, setHiddenMode] = usePersistentState<'dim' | 'hide'>(
    'fmlab.atlas.hiddenMode',
    'dim',
    ['dim', 'hide'],
  );

  // F5/F6: Community-Namen-Status + Cluster-Verfügbarkeit (ein leichter Fetch).
  // Bis der Status geladen ist, OPTIMISTISCH von vorhandenem Clustering ausgehen
  // (kein Aufflackern von Dimmen → Un-Dimmen). Ohne Clustering (frische DB /
  // Cluster-Layer gewischt) ist die Community-Segmentierung + Topologie leer →
  // Failover auf Datei+Komposition (Effekt unten) und beide Schalter gedimmt.
  const { data: communityStats, refetch: refetchStats } = useCommunityStats();
  const clustersAvailable = communityStats?.clusters_available ?? true;

  const isHubs = segmentBy === 'hubs';
  const segKey = !isHubs ? sp.get('seg') : null;
  const subKey = !isHubs ? sp.get('sub') : null;
  const drill: Drill = {
    segmentBy,
    seg: segKey ? { key: segKey, label: sp.get('seg_label') ?? segKey } : undefined,
    type: subKey ? { key: subKey, label: sp.get('sub_label') ?? subKey } : undefined,
  };
  // Topologie braucht die Cluster-Partition (Inter-Segment-Kopplung) → ohne
  // Clustering nicht verfügbar (F6).
  const isTopology = rawView === 'topology' && topologyAvailable(segmentBy) && clustersAvailable;
  const view: AtlasView = isTopology ? 'topology' : 'composition';

  // Expliziter Slider-Wert (URL) überschreibt den adaptiven Per-Ebenen-Default.
  const topNRaw = sp.get('top_n');
  const topN =
    topNRaw !== null && Number.isFinite(Number(topNRaw))
      ? Math.min(Math.max(Number(topNRaw), TOP_N_MIN), TOP_N_MAX)
      : defaultTopN(drill, isTopology);
  const topNExplicit = topNRaw !== null;

  // ── URL-Patch-Helfer ──────────────────────────────────────────────────────
  // push=true legt einen History-Eintrag an (Drill-Schritte → Browser-Back geht
  // eine Ebene hoch); Linsen-Änderungen patchen mit replace (kein History-Spam).
  const patch = useCallback(
    (updates: Record<string, string | null>, push = false) => {
      const next = new URLSearchParams(sp);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      setSp(next, { replace: !push });
    },
    [sp, setSp],
  );

  // F6-Failover: Ist die DB (noch) nicht geclustert, auf Datei+Komposition
  // umschalten — die Community-Segmentierung/Topologie wären sonst leer. Wir
  // patchen die URL EINMAL (replace, kein History-Eintrag), sobald der Status
  // geladen ist und clusters_available=false meldet. Der Backend-Stub verhindert
  // den Crash bereits; dieser Effekt sorgt für den sauberen UI-Zustand.
  useEffect(() => {
    if (clustersAvailable) return;
    if (segmentBy === 'community' || rawView === 'topology') {
      patch({
        segment_by: 'file',
        view: null,
        seg: null, seg_label: null, sub: null, sub_label: null, top_n: null,
      });
    }
  }, [clustersAvailable, segmentBy, rawView, patch]);

  const lenses: Lenses = useMemo(() => ({ view, weight, excluded, topN }), [view, weight, excluded, topN]);
  const query = useMemo<AtlasQuery>(() => buildAtlasQuery(drill, lenses, isTopology), [drill, lenses, isTopology]);
  const { data, loading, error, refetch } = useGraphOverview(query);
  // Kein Import vorhanden → die Cluster-/Graph-Views (ClusterEdges, …) existieren
  // noch nicht. Statt des rohen Katalog-Fehlers eine neutrale "noch keine
  // Daten"-Info mit Rückweg zur Startseite.
  const noImport = isNoImportError(error);

  // „(...)"-Optionen-Panel (flüchtig, NICHT in der URL — anders als der Drill).
  const [panelTarget, setPanelTarget] = useState<PanelTarget | null>(null);
  // „Ausgeblendete verwalten"-Liste (flüchtig).
  const [showHidden, setShowHidden] = useState(false);

  // Debug-Session: User-Ebene des Atlas (die navigierte URL-Koordinate) in die
  // Zeitachse legen — VOR den daraus abgeleiteten Fetches. So steht im Log
  // zuerst „User ist auf seg=6/topology/exclude=Script" und danach die Queries,
  // die das auslöst (Haupt + Typ-Universum) inkl. Memory-Delta.
  const spString = sp.toString();
  useEffect(() => {
    recordDebug('atlas_state', {
      url: `${window.location.pathname}?${spString}`,
      segmentBy, view, weight, excluded,
      seg: segKey, sub: subKey, hideRest, topN,
    });
    // spString deckt alle abgeleiteten Werte ab → einzige Dependency nötig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spString]);

  // Objekttyp-Universum für die Filterleiste — fixes Gewicht (Typ-Menge ist
  // gewichts-unabhängig) → genau EIN gecachter Treffer, kein Refetch beim Toggle.
  const typeUniverseQuery: AtlasQuery = useMemo(
    () => ({ view: 'composition', level: 'root', segmentBy: 'type', weight: 'domain' }),
    [],
  );
  const typeUniverse = useGraphOverview(typeUniverseQuery);
  const globalTypes = useMemo(() => {
    const d = typeUniverse.data;
    if (!d || d.view !== 'composition') return [];
    return d.tiles.filter((tl) => tl.kind === 'aggregate').map((tl) => tl.key);
  }, [typeUniverse.data]);

  // E1 — nur TATSÄCHLICH angezeigte Objekttypen anbieten: aus den aktuellen Daten
  // ableiten (Typ-Aggregate auf Segment-/Typ-Ebene ODER Blatt-Typen). Ist im
  // Kontext kein Typ ablesbar (Ebene 0 Community/Datei, Topologie), fällt es auf
  // das globale Typ-Universum zurück. Ausgeschlossene Typen immer mit aufnehmen,
  // damit sie wieder einschaltbar bleiben.
  const allTypes = useMemo(() => {
    const ctx = new Set<string>();
    if (data && data.view === 'composition') {
      const dimIsType =
        (data.level === 'segment' && (segmentBy === 'community' || segmentBy === 'file')) ||
        (data.level === 'root' && segmentBy === 'type');
      for (const tl of data.tiles) {
        if (tl.kind === 'aggregate' && dimIsType) ctx.add(tl.key);
        else if (tl.kind === 'leaf') ctx.add(tl.type);
      }
    }
    const base = ctx.size > 0 ? [...ctx] : globalTypes;
    return [...new Set([...base, ...excluded])].sort();
  }, [data, segmentBy, globalTypes, excluded]);

  // ── Aktionen ──────────────────────────────────────────────────────────────
  const setSegmentBy = useCallback(
    (s: AtlasSegmentBy) => {
      patch(
        {
          segment_by: s === 'community' ? null : s,
          seg: null, seg_label: null, sub: null, sub_label: null, q: null, top_n: null,
          // Topologie ist bei hubs/type n. v. → zurück auf Komposition.
          ...(topologyAvailable(s) ? {} : { view: null }),
        },
        true,
      );
    },
    [patch],
  );

  // View-Wechsel ändert den Cutoff-Kontext → top_n auf den adaptiven Default zurück.
  const changeView = useCallback((v: AtlasView) => patch({ view: v === 'composition' ? null : v, top_n: null }), [patch]);
  const setSearch = useCallback((q: string) => patch({ q: q || null }), [patch]);
  const setTopN = useCallback((n: number) => patch({ top_n: String(n) }), [patch]); // expliziter Override
  const toggleHideRest = useCallback(() => patch({ hide_rest: hideRest ? null : '1' }), [patch, hideRest]);

  const toggleType = useCallback(
    (type: string) => {
      const next = excluded.includes(type) ? excluded.filter((x) => x !== type) : [...excluded, type];
      patch({ exclude: next.length ? next.join(',') : null });
    },
    [patch, excluded],
  );

  const onTileClick = useCallback(
    (tile: AtlasTile) => {
      if (tile.kind === 'leaf') {
        navigate(explorerPath(tile.uuid, tile.file));
        return;
      }
      if (tile.kind === 'rest') {
        // „Rest" anklicken → Top-N anheben (mehr Segmente sichtbar machen).
        setTopN(Math.min(topN + 40, TOP_N_MAX));
        return;
      }
      // Aggregat → eine Ebene tiefer (Drill in die URL, push für Browser-Back).
      // top_n zurücksetzen → neue Ebene startet mit ihrem adaptiven Default.
      if (!drill.seg) patch({ seg: tile.key, seg_label: tile.label, top_n: null }, true);
      else if (!drill.type) patch({ sub: tile.key, sub_label: tile.label, top_n: null }, true);
    },
    [navigate, patch, drill, topN, setTopN],
  );

  // Super-Node → Explorer, fokussiert auf das schwerste Mitglied des Segments.
  const onMetaNodeClick = useCallback(
    (node: AtlasMetaNode) => {
      if (node.top_member_uuid) navigate(explorerPath(node.top_member_uuid, node.top_member_file ?? null));
    },
    [navigate],
  );

  // ── „(...)"-Panel ─────────────────────────────────────────────────────────
  // Welche Panel-Art passt zu einer Kachel (Parent kennt den Drill-Kontext):
  // Blatt → Knoten-Panel; Community-Aggregat auf Ebene 0 → Community-Panel.
  const infoKindFor = useCallback<(tile: AtlasTile) => TileInfoKind>(
    (tile) => {
      if (tile.kind === 'leaf') return 'node';
      if (tile.kind === 'aggregate' && segmentBy === 'community' && !drill.seg) return 'community';
      return null;
    },
    [segmentBy, drill.seg],
  );

  const onTileInfo = useCallback((tile: AtlasTile) => {
    if (tile.kind === 'leaf') {
      setPanelTarget({
        kind: 'node',
        uuid: tile.uuid,
        file: tile.file,
        label: tile.label,
        type: tile.type,
        hidden: tile.hidden === true,
      });
    } else if (tile.kind === 'aggregate') {
      setPanelTarget({
        kind: 'community',
        engine: tile.engine ?? '',
        community: Number(tile.key),
        label: tile.label,
        userName: tile.user_name ?? '',
        userNotes: tile.user_notes ?? '',
        topMemberUuid: tile.top_member_uuid ?? null,
      });
    }
  }, []);

  const onMetaNodeInfo = useCallback((node: AtlasMetaNode) => {
    setPanelTarget({
      kind: 'community',
      engine: node.engine ?? '',
      community: Number(node.key),
      label: node.label,
      userName: node.user_name ?? '',
      userNotes: node.user_notes ?? '',
      topMemberUuid: node.top_member_uuid ?? null,
    });
  }, []);

  const openExplorer = useCallback((uuid: string, file: string | null) => navigate(explorerPath(uuid, file)), [navigate]);
  const openDetail = useCallback((uuid: string, file: string | null) => navigate(buildObjectPath(uuid, null, file)), [navigate]);

  // Atlas-Pfad mit den AKTUELLEN Lens-Params, nur die genannten Drill-Keys
  // entfernt → Breadcrumb-Sprünge erhalten hide_rest/exclude/segment_by/view/…
  // (anders als ein nackter `/atlas`, der alle Linsen verwürfe).
  const atlasUrl = useCallback(
    (dels: string[]) => {
      const p = new URLSearchParams(sp);
      for (const k of dels) p.delete(k);
      const qs = p.toString();
      return qs ? `/atlas?${qs}` : '/atlas';
    },
    [sp],
  );

  // Verschmolzene Haupt-Breadcrumb (statt einer eigenen Atlas-Leiste):
  //   Start / Graph / {Atlas-Ebene 2} / {Atlas-Ebene 3}
  // „Graph" ist die Atlas-Wurzel (Drill zurücksetzen, Linsen behalten); die
  // Sub-Ebenen sind die Drill-Schritte (seg → type). Die Drill-Crumbs erscheinen
  // nur in der Komposition (Topologie/Top-Knoten sind einstufig — wie zuvor).
  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    const showDrill = !isTopology && segmentBy !== 'hubs';
    const hasSeg = showDrill && !!drill.seg;
    const hasType = showDrill && !!drill.type;
    const items: BreadcrumbItem[] = [
      { label: t('nav:crumbs.home'), path: '/' },
      { label: t('nav:crumbs.graph'), path: hasSeg ? atlasUrl(['seg', 'seg_label', 'sub', 'sub_label', 'top_n']) : null },
    ];
    if (hasSeg) {
      items.push({ label: drill.seg!.label, path: hasType ? atlasUrl(['sub', 'sub_label', 'top_n']) : null });
    }
    if (hasType) {
      items.push({ label: drill.type!.label, path: null });
    }
    return items;
  }, [t, isTopology, segmentBy, drill, atlasUrl]);

  // ── Daten + „Weitere"-Ausblendung ────────────────────────────────────────
  const composition = data && data.view === 'composition' ? (data as AtlasCompositionResponse) : null;
  const topology = data && data.view === 'topology' ? (data as AtlasTopologyResponse) : null;
  const rawTiles = composition?.tiles ?? [];
  const tiles = hideRest ? rawTiles.filter((tl) => tl.kind !== 'rest') : rawTiles;
  const metaNodes = topology ? (hideRest ? topology.nodes.filter((n) => n.kind !== 'rest') : topology.nodes) : [];
  const truncated = composition?.truncated ?? false;
  const hasContent = isTopology ? metaNodes.length > 0 : tiles.length > 0;

  return (
    <div className="atlas-view">
      <SubNav breadcrumbs={breadcrumbs} />
      <StatusBar message={<AtlasNameStatus stats={communityStats} />} />
      <header className="atlas-header">
        <div className="atlas-axes">
          <div className="atlas-segbar" role="tablist" aria-label={t('segmentation') as string}>
            {SEGMENTS.map((s) => {
              // F6: Community-Segmentierung ohne Clustering nicht verfügbar (gedimmt).
              const segDisabled = s === 'community' && !clustersAvailable;
              return (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={segmentBy === s}
                  className={`atlas-segbtn${segmentBy === s ? ' active' : ''}`}
                  disabled={segDisabled}
                  title={segDisabled ? (t('status.clustersMissing') as string) : undefined}
                  onClick={() => setSegmentBy(s)}
                >
                  {t(`segment.${s}`)}
                </button>
              );
            })}
          </div>
          <div className="atlas-viewbar" role="group" aria-label={t('representation') as string}>
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                className={`atlas-viewbtn${view === v ? ' active' : ''}`}
                aria-pressed={view === v}
                disabled={v === 'topology' && (!topologyAvailable(segmentBy) || !clustersAvailable)}
                title={
                  v === 'topology' && !clustersAvailable
                    ? (t('status.clustersMissing') as string)
                    : (t(`view.${v}_hint`) as string)
                }
                onClick={() => changeView(v)}
              >
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="atlas-topn" title={t('topN.hint') as string}>
          <span className="atlas-topn-label">{t('topN.label')}</span>
          <input
            type="range"
            aria-label={t('topN.label') as string}
            min={TOP_N_MIN}
            max={TOP_N_MAX}
            step={TOP_N_STEP}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
          />
          <span className="atlas-topn-value">{topN}</span>
          {topNExplicit ? (
            <button
              type="button"
              className="atlas-topn-reset"
              title={t('topN.auto') as string}
              aria-label={t('topN.auto') as string}
              onClick={() => patch({ top_n: null })}
            >
              ↺
            </button>
          ) : (
            <span className="atlas-topn-auto">{t('topN.autoTag')}</span>
          )}
        </div>
      </header>

      <div className="atlas-toolbar">
        <div className="atlas-hiddenmode" role="group" aria-label={t('hidden.mode') as string}>
          <span className="atlas-hiddenmode-label">{t('hidden.mode')}</span>
          {(['dim', 'hide'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`atlas-segctl-btn${hiddenMode === m ? ' active' : ''}`}
              aria-pressed={hiddenMode === m}
              title={t(`hidden.${m}_hint`) as string}
              onClick={() => setHiddenMode(m)}
            >
              {t(`hidden.${m}`)}
            </button>
          ))}
          <button
            type="button"
            className="atlas-hiddenmanage"
            title={t('hidden.manage_hint') as string}
            onClick={() => setShowHidden(true)}
          >
            {t('hidden.manage')}
          </button>
        </div>
        <input
          type="search"
          className="atlas-search"
          placeholder={t('search.placeholder') as string}
          aria-label={t('search.placeholder') as string}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {allTypes.length > 0 && !(segmentBy === 'type' && drill.seg) && (
        <div className="atlas-typebar" role="group" aria-label={t('types.label') as string}>
          {allTypes.map((type) => {
            const off = excluded.includes(type);
            return (
              <button
                key={type}
                type="button"
                className={`atlas-typechip${off ? ' off' : ''}`}
                aria-pressed={!off}
                onClick={() => toggleType(type)}
                title={t(off ? 'types.show' : 'types.hide', { type }) as string}
              >
                <span className="atlas-typeswatch" style={{ background: getTypeColor(type) }} />
                {type}
              </button>
            );
          })}
          {excluded.length > 0 && (
            <button type="button" className="atlas-typereset" onClick={() => patch({ exclude: null })}>
              {t('types.reset')}
            </button>
          )}
        </div>
      )}

      <div className="atlas-body">
        {error && noImport && <NoDataYet />}
        {error && !noImport && <div className="atlas-state atlas-error">{t('error', { message: error })}</div>}
        {!error && loading && !hasContent && <div className="atlas-state">{t('loading')}</div>}
        {!error && !loading && !hasContent && <div className="atlas-state">{t('empty')}</div>}
        {!error && isTopology && metaNodes.length > 0 && (
          <Suspense fallback={<div className="atlas-state">{t('loading')}</div>}>
            <AtlasMetaGraph
              nodes={metaNodes}
              edges={topology?.edges ?? []}
              onNodeClick={onMetaNodeClick}
              onNodeInfo={onMetaNodeInfo}
              filterText={search}
            />
          </Suspense>
        )}
        {!error && !isTopology && tiles.length > 0 && (
          <Suspense fallback={<div className="atlas-state">{t('loading')}</div>}>
            <AtlasTreemap
              tiles={tiles}
              onTileClick={onTileClick}
              onTileInfo={onTileInfo}
              onHideRest={toggleHideRest}
              hideRestLabel={t('rest.hide') as string}
              infoKindFor={infoKindFor}
              filterText={search}
              hiddenMode={hiddenMode}
            />
          </Suspense>
        )}
      </div>

      {panelTarget && (
        <Suspense fallback={null}>
          <AtlasInfoPanel
            target={panelTarget}
            onClose={() => setPanelTarget(null)}
            onChanged={() => { refetch(); refetchStats(); }}
            onOpenExplorer={openExplorer}
            onOpenDetail={openDetail}
          />
        </Suspense>
      )}

      {showHidden && (
        <Suspense fallback={null}>
          <AtlasHiddenManager onClose={() => setShowHidden(false)} onChanged={refetch} />
        </Suspense>
      )}

      <footer className="atlas-footer">
        <span className="atlas-hint">{t(isTopology ? 'hint.metaClick' : 'hint.leafClick')}</span>
        {truncated && !isTopology && !hideRest && <span className="atlas-truncated">{t('truncated')}</span>}
      </footer>
    </div>
  );
}
