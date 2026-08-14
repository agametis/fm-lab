import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SubNav } from '../components/SubNav';
import { StatusBar } from '../components/StatusBar';
import { buildBreadcrumb } from '../lib/navigation';
import { useApiLang } from '../hooks/useApiLang';
import { fetchFunctionDetail, resolveHelpHref, PLATFORM_LABELS, OS_LABELS, type FunctionDetail } from '../api/fmSpecApi';
import './FmSpecView.css';

// Functions-Domäne kennt kein zh-Hans → auf Englisch zurückfallen (wie Liste).
const FUNCTION_LANGS = new Set(['en', 'de', 'es', 'fr', 'it', 'nl', 'pt', 'sv', 'ja', 'ko']);

/**
 * fm-spec Function-Detail (`/fm-spec/function/:functionId`).
 *
 * Schlanke, lesende Detail-Ansicht analog zum ScriptStep-Detail — folgt der
 * globalen UI-Sprache. Nutzt den bestehenden `/reference/functions/:id?content=full`.
 */
export function FmSpecFunctionView() {
  const { functionId } = useParams();
  const { t } = useTranslation(['fmSpec', 'nav']);
  const uiLang = useApiLang();
  const fnLang = FUNCTION_LANGS.has(uiLang) ? uiLang : 'en';
  const dash = t('fmSpec:dash');

  const [data, setData] = useState<FunctionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!functionId) return;
    let cancelled = false;
    setData(null); setErr(null);
    fetchFunctionDetail(functionId, fnLang)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e.message || 'error'); });
    return () => { cancelled = true; };
  }, [functionId, fnLang]);

  const fnName = data?.canonicalName ?? (functionId ? `Function ${functionId}` : '');
  const breadcrumbs = buildBreadcrumb({ kind: 'fmSpecFunction', name: fnName }, t);
  const helpHref = data ? resolveHelpHref(data.localHelpUrl, data.helpUrl) : null;

  return (
    <div className="app fmspec-view">
      <SubNav breadcrumbs={breadcrumbs} />
      <StatusBar />

      <div className="fmspec-page">
        <header className="fmspec-header">
          <h1 className="fmspec-title">
            {fnName}
            {data && <span className="fmspec-title__id">#{data.functionId}</span>}
          </h1>
          {data && (
            <p className="fmspec-subtitle">
              {t('fmSpec:functions.col.category')}: {data.category?.name ?? String(data.categoryId)}
              {' · '}{t('fmSpec:functions.detail.returnType')}: {data.returnTypeDisplay || data.returnType || dash}
              {' · '}{t('fmSpec:functions.col.originVersion')}: {data.originVersion ?? dash}
            </p>
          )}
          {/* Plattform-Bindung (Referenz ≥ 1.12.0) — Affinität, nie
              Kompatibilität: „liefert nur hier sinnvolle Ergebnisse". */}
          {data && (data.platformAffinity?.length ?? 0) > 0 && (
            <p className="fmspec-subtitle fmspec-platform-line">
              {t('fmSpec:functions.detail.platformBinding')}:{' '}
              {data.platformAffinity!.map((a) => (
                <span
                  key={a.platform}
                  className="fmspec-tag fmspec-tag--platform"
                  title={`${t(`fmSpec:functions.detail.affinity_${a.affinity}`)}${a.note ? ` — ${a.note}` : ''}`}
                >
                  {PLATFORM_LABELS[a.platform] ?? a.platform}
                  {' · '}
                  {t(`fmSpec:functions.detail.affinityWord_${a.affinity}`)}
                </span>
              ))}
            </p>
          )}
          {/* OS-Bindung (Referenz ≥ 1.13.0, function_os_affinity): exclusive /
              unsupported / variant je OS; os_probe = Detektions-Funktion
              (Guard-Idiom, os=null) als eigenes Badge. */}
          {data && (data.osAffinity?.length ?? 0) > 0 && (
            <p className="fmspec-subtitle fmspec-platform-line">
              {t('fmSpec:osAffinity.label')}:{' '}
              {data.osAffinity!.map((a) => (
                <span
                  key={`${a.affinity}-${a.os}`}
                  className={`fmspec-tag fmspec-tag--platform fmspec-tag--os-${a.affinity}`}
                  title={`${t(`fmSpec:osAffinity.hint_${a.affinity}`)}${a.note ? ` — ${a.note}` : ''}`}
                >
                  {a.os ? OS_LABELS[a.os] ?? a.os : ''}
                  {a.os ? ' · ' : ''}
                  {t(`fmSpec:osAffinity.word_${a.affinity}`)}
                </span>
              ))}
            </p>
          )}
        </header>

        {err && <div className="fmspec-error">{t('fmSpec:error')}: {err}</div>}
        {!data && !err && <div className="fmspec-loading">{t('fmSpec:loading')}</div>}

        {data && (
          <section className="fmspec-section">
            {data.signature && (
              <>
                <div className="fmspec-subhead">{t('fmSpec:functions.detail.signature')}</div>
                <div className="fmspec-codeblock">
                  <pre><code>{data.signature}</code></pre>
                </div>
              </>
            )}

            {data.purpose && (
              <>
                <div className="fmspec-subhead">{t('fmSpec:functions.detail.purpose')}</div>
                <p className="fmspec-fn-detail__purpose">{data.purpose}</p>
              </>
            )}

            {data.description && data.description !== data.purpose && (
              <>
                <div className="fmspec-subhead">{t('fmSpec:params.col.description')}</div>
                <p className="fmspec-fn-detail__desc">{data.description}</p>
              </>
            )}

            <div className="fmspec-subhead">{t('fmSpec:functions.detail.parameters')}</div>
            {data.parameters.length === 0 ? (
              <div className="fmspec-muted">{t('fmSpec:functions.detail.noParams')}</div>
            ) : (
              <div className="fmspec-table-wrap">
                <table className="fmspec-table">
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>{t('fmSpec:params.col.name')}</th>
                      <th>{t('fmSpec:params.col.description')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.parameters.map((p) => (
                      <tr key={p.position}>
                        <td className="num">{p.position}</td>
                        <td>
                          {p.name || dash}
                          {p.optional && <span className="fmspec-tag">{t('fmSpec:functions.detail.optional')}</span>}
                          {p.variadic && <span className="fmspec-tag">{t('fmSpec:functions.detail.variadic')}</span>}
                        </td>
                        <td>{p.description || dash}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.example1 && (
              <>
                <div className="fmspec-subhead">{t('fmSpec:functions.detail.example')}</div>
                <div className="fmspec-codeblock">
                  <pre><code>{data.example1}</code></pre>
                </div>
              </>
            )}

            {helpHref && (
              <a className="fmspec-help-link" href={helpHref} target="_blank" rel="noreferrer">
                {t('fmSpec:help.open')}
              </a>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default FmSpecFunctionView;
