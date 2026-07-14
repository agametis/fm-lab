import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SubNav } from '../components/SubNav';
import { StatusBar } from '../components/StatusBar';
import { buildBreadcrumb } from '../lib/navigation';
import { useUrlState } from '../hooks/useUrlState';
import { useApiLang } from '../hooks/useApiLang';
import {
  fetchFmSpecMeta,
  fetchFmSpecSteps,
  fetchFmSpecFunctions,
  type FmSpecMeta,
  type FmSpecStep,
  type FmSpecFunction,
  type RefCategory,
} from '../api/fmSpecApi';
import './FmSpecView.css';

/**
 * fm-spec Schema-Viewer (`/fm-spec`).
 *
 * Lesende Inspektion der generativen Referenz-DB: Metadaten-Kopf + drei Tabs
 * (ScriptSteps · Functions · Locales), jeweils mit Live-Suchfilter. Tab-Zustand
 * hängt am URL-Query (`?tab=…`) für Deep-Links / Browser-Back. Klick auf einen
 * Step öffnet den Detail-View (`/fm-spec/step/:stepId`).
 */

type TabId = 'steps' | 'functions' | 'locales';
const TABS: TabId[] = ['steps', 'functions', 'locales'];

// Functions-Domäne kennt kein zh-Hans → auf Englisch zurückfallen (Steps: alle 11).
const FUNCTION_LANGS = new Set(['en', 'de', 'es', 'fr', 'it', 'nl', 'pt', 'sv', 'ja', 'ko']);

function catName(categories: RefCategory[], id: number): string {
  const c = categories.find((x) => x.id === id);
  return c ? c.name : String(id);
}

export function FmSpecView() {
  const { t, i18n } = useTranslation(['fmSpec', 'nav']);
  const navigate = useNavigate();
  // Auf einen unterstützten Referenz-Code normalisieren (en-US → en). i18n.language
  // (volles Regions-Tag) bleibt der Datumsformatierung unten vorbehalten.
  const uiLang = useApiLang();
  const fnLang = FUNCTION_LANGS.has(uiLang) ? uiLang : 'en';

  const [tab, setTab] = useUrlState<TabId>('tab', 'steps', {
    parse: (raw) => (TABS.includes(raw as TabId) ? (raw as TabId) : 'steps'),
    serialize: (v) => (v === 'steps' ? null : v),
  });
  const [search, setSearch] = useUrlState('q', '');

  const [meta, setMeta] = useState<FmSpecMeta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [steps, setSteps] = useState<FmSpecStep[] | null>(null);
  const [stepCats, setStepCats] = useState<RefCategory[]>([]);
  const [functions, setFunctions] = useState<FmSpecFunction[] | null>(null);
  const [fnCats, setFnCats] = useState<RefCategory[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);

  const breadcrumbs = buildBreadcrumb({ kind: 'fmSpec' }, t);
  const dash = t('fmSpec:dash');

  // Kopf-Metadaten immer laden.
  useEffect(() => {
    let cancelled = false;
    fetchFmSpecMeta()
      .then((d) => { if (!cancelled) { setMeta(d); setMetaErr(null); } })
      .catch((e) => { if (!cancelled) setMetaErr(e.message || 'error'); });
    return () => { cancelled = true; };
  }, []);

  // Steps lazy bei erster Aktivierung (bzw. Sprachwechsel).
  useEffect(() => {
    if (tab !== 'steps' || steps !== null) return;
    let cancelled = false;
    fetchFmSpecSteps(uiLang)
      .then((d) => { if (!cancelled) { setSteps(d.steps); setStepCats(d.categories); setListErr(null); } })
      .catch((e) => { if (!cancelled) setListErr(e.message || 'error'); });
    return () => { cancelled = true; };
  }, [tab, steps, uiLang]);

  // Functions lazy bei erster Aktivierung.
  useEffect(() => {
    if (tab !== 'functions' || functions !== null) return;
    let cancelled = false;
    fetchFmSpecFunctions(fnLang)
      .then((d) => { if (!cancelled) { setFunctions(d.functions); setFnCats(d.categories); setListErr(null); } })
      .catch((e) => { if (!cancelled) setListErr(e.message || 'error'); });
    return () => { cancelled = true; };
  }, [tab, functions, fnLang]);

  // Sprachwechsel → geladene Listen invalidieren (lokalisierte Spalten neu holen).
  useEffect(() => {
    setSteps(null);
    setFunctions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLang]);

  const q = search.trim().toLowerCase();

  const filteredSteps = useMemo(() => {
    if (!steps) return [];
    if (!q) return steps;
    return steps.filter((s) => {
      const hay = [s.stepId, s.name, s.categoryId, catName(stepCats, s.categoryId), s.originVersion]
        .filter((v) => v != null).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [steps, stepCats, q]);

  const filteredFns = useMemo(() => {
    if (!functions) return [];
    if (!q) return functions;
    return functions.filter((f) => {
      const hay = [f.functionId, f.name, catName(fnCats, f.categoryId), f.returnType, f.originVersion]
        .filter((v) => v != null).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [functions, fnCats, q]);

  const filteredLocales = useMemo(() => {
    const locales = meta?.locales ?? [];
    if (!q) return locales;
    return locales.filter((l) => l.code.toLowerCase().includes(q));
  }, [meta, q]);

  const rm = meta?.referenceMeta;
  const counts = meta?.counts;
  const builtAt = rm?.built_at ? new Date(rm.built_at).toLocaleDateString(i18n.language) : dash;

  const totalForTab =
    tab === 'steps' ? (steps?.length ?? 0)
    : tab === 'functions' ? (functions?.length ?? 0)
    : (meta?.locales.length ?? 0);
  const shownForTab =
    tab === 'steps' ? filteredSteps.length
    : tab === 'functions' ? filteredFns.length
    : filteredLocales.length;

  return (
    <div className="app fmspec-view">
      <SubNav breadcrumbs={breadcrumbs} />
      <StatusBar />

      <div className="fmspec-page">
        <header className="fmspec-header">
          <h1 className="fmspec-title">{t('fmSpec:title')}</h1>
          <p className="fmspec-subtitle">{t('fmSpec:subtitle')}</p>
        </header>

        {metaErr ? (
          <div className="fmspec-error">{t('fmSpec:error')}: {metaErr}</div>
        ) : (
          <section className="fmspec-kpis">
            <Kpi label={t('fmSpec:header.schemaVersion')} value={rm?.schema_version ?? dash} />
            <Kpi label={t('fmSpec:header.coverage')} value={rm?.filemaker_coverage ?? dash} />
            <Kpi label={t('fmSpec:header.built')} value={builtAt} />
            <Kpi label={t('fmSpec:header.steps')} value={counts ? String(counts.scriptSteps) : dash} />
            <Kpi label={t('fmSpec:header.functions')} value={counts ? String(counts.functions) : dash} />
            <Kpi
              label={t('fmSpec:header.locales')}
              value={counts ? t('fmSpec:header.localesValue', { steps: counts.stepLocales, functions: counts.functionLocales }) as string : dash}
            />
            <Kpi
              label={t('fmSpec:header.grammar')}
              value={counts ? t('fmSpec:header.grammarValue', { covered: counts.grammarSteps, total: counts.scriptSteps }) as string : dash}
            />
          </section>
        )}

        <p className="fmspec-attribution">{t('fmSpec:header.attribution')}</p>

        <div className="fmspec-toolbar">
          <div className="fmspec-tabs" role="tablist" aria-label={t('fmSpec:title') as string}>
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`fmspec-tab${tab === id ? ' active' : ''}`}
                onClick={() => setTab(id)}
              >
                {t(`fmSpec:tabs.${id}`)}
              </button>
            ))}
          </div>
          <span className="fmspec-count">{t('fmSpec:list.count', { shown: shownForTab, total: totalForTab })}</span>
          <input
            type="search"
            className="fmspec-search"
            placeholder={t('fmSpec:search.placeholder') as string}
            aria-label={t('fmSpec:search.placeholder') as string}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {listErr && tab !== 'locales' && <div className="fmspec-error">{t('fmSpec:error')}: {listErr}</div>}

        {tab === 'steps' && (
          <div className="fmspec-table-wrap">
            <table className="fmspec-table">
              <thead>
                <tr>
                  <th className="num">{t('fmSpec:steps.col.id')}</th>
                  <th>{t('fmSpec:steps.col.name')}</th>
                  <th className="num">{t('fmSpec:steps.col.categoryId')}</th>
                  <th>{t('fmSpec:steps.col.category')}</th>
                  <th>{t('fmSpec:steps.col.originVersion')}</th>
                  <th>{t('fmSpec:steps.col.grammar')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSteps.map((s) => (
                  <tr
                    key={s.stepId}
                    className="fmspec-row--clickable"
                    tabIndex={0}
                    onClick={() => navigate(`/fm-spec/step/${s.stepId}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/fm-spec/step/${s.stepId}`); }
                    }}
                  >
                    <td className="num">{s.stepId}</td>
                    <td>{s.name}</td>
                    <td className="num">{s.categoryId}</td>
                    <td>{catName(stepCats, s.categoryId)}</td>
                    <td>{s.originVersion ?? dash}</td>
                    <td>
                      {s.hasGrammar
                        ? <span className="fmspec-badge fmspec-badge--yes">{t('fmSpec:steps.grammarYes')}</span>
                        : <span className="fmspec-badge fmspec-badge--no">{t('fmSpec:steps.grammarNo')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {steps === null && !listErr && <div className="fmspec-loading">{t('fmSpec:loading')}</div>}
          </div>
        )}

        {tab === 'functions' && (
          <div className="fmspec-table-wrap">
            <table className="fmspec-table">
              <thead>
                <tr>
                  <th className="num">{t('fmSpec:functions.col.id')}</th>
                  <th>{t('fmSpec:functions.col.name')}</th>
                  <th>{t('fmSpec:functions.col.category')}</th>
                  <th>{t('fmSpec:functions.col.returnType')}</th>
                  <th>{t('fmSpec:functions.col.originVersion')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredFns.map((f) => (
                  <tr
                    key={f.functionId}
                    className="fmspec-row--clickable"
                    tabIndex={0}
                    onClick={() => navigate(`/fm-spec/function/${f.functionId}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/fm-spec/function/${f.functionId}`); }
                    }}
                  >
                    <td className="num">{f.functionId}</td>
                    <td>{f.name}</td>
                    <td>{catName(fnCats, f.categoryId)}</td>
                    <td>{f.returnType ?? dash}</td>
                    <td>{f.originVersion ?? dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {functions === null && !listErr && <div className="fmspec-loading">{t('fmSpec:loading')}</div>}
          </div>
        )}

        {tab === 'locales' && (
          <div className="fmspec-table-wrap">
            <table className="fmspec-table">
              <thead>
                <tr>
                  <th>{t('fmSpec:locales.col.code')}</th>
                  <th className="num">{t('fmSpec:locales.col.steps')}</th>
                  <th className="num">{t('fmSpec:locales.col.functions')}</th>
                  <th className="num">{t('fmSpec:locales.col.parameters')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocales.map((l) => (
                  <tr key={l.code}>
                    <td className="mono">{l.code}</td>
                    <td className="num">{l.steps}</td>
                    <td className="num">{l.functions}</td>
                    <td className="num">{l.stepParameters}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!meta && !metaErr && <div className="fmspec-loading">{t('fmSpec:loading')}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="fmspec-kpi">
      <span className="fmspec-kpi__label">{label}</span>
      <span className={`fmspec-kpi__value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

export default FmSpecView;
