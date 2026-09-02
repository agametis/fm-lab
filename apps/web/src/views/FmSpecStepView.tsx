import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SubNav } from '../components/SubNav';
import { StatusBar } from '../components/StatusBar';
import { buildBreadcrumb } from '../lib/navigation';
import { useApiLang } from '../hooks/useApiLang';
import {
  fetchStepLangs,
  fetchStepGrammar,
  resolveHelpHref,
  PLATFORM_LABELS,
  OS_LABELS,
  STEP_COMPAT_PLATFORMS,
  type StepAllLangs,
  type StepGrammar,
} from '../api/fmSpecApi';
import './FmSpecView.css';

// Bug-registry kinds in step_constraints (fm_spec >= 1.14.4) — rendered with
// a badge: warning class, never a validity rule (the step is valid, the risk
// lies with FileMaker's own serialization).
const KNOWN_BUG_KINDS = new Set([
  'clipboard_loss', 'version_skew', 'save_corruption',
  'serialization_unstable', 'localized_build_defect',
]);

/** Registry details are long prose — collapse behind the first sentence. */
function ConstraintDetail({ detail }: { detail: string | null }) {
  if (!detail) return null;
  const firstSentence = detail.split('. ')[0];
  if (detail.length <= 200 || firstSentence.length >= detail.length - 1) {
    return <span className="fmspec-constraint__detail">{detail}</span>;
  }
  return (
    <details className="fmspec-constraint__detail">
      <summary>{firstSentence}.</summary>
      {detail}
    </details>
  );
}

/**
 * fm-spec ScriptStep-Detail (`/fm-spec/step/:stepId`).
 *
 * Vier Abschnitte untereinander: (1) lokalisierte Step-Daten über alle Sprachen,
 * (2) strukturierte Parameter (Sprache umschaltbar), (3) XMLSnippet-Grammatik
 * (nur wenn erfasst, sonst Hinweis), (4) SaXML-Details. Read-only.
 */
export function FmSpecStepView() {
  const { stepId } = useParams();
  const { t } = useTranslation(['fmSpec', 'nav']);
  const uiLang = useApiLang();
  const dash = t('fmSpec:dash');

  const [data, setData] = useState<StepAllLangs | null>(null);
  const [grammar, setGrammar] = useState<StepGrammar | null>(null);
  const [grammarAvailable, setGrammarAvailable] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!stepId) return;
    let cancelled = false;
    setData(null); setGrammar(null); setGrammarAvailable(null); setErr(null);
    fetchStepLangs(stepId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e.message || 'error'); });
    fetchStepGrammar(stepId)
      .then((g) => { if (!cancelled) { setGrammar(g); setGrammarAvailable(g != null); } })
      .catch(() => { if (!cancelled) setGrammarAvailable(false); });
    return () => { cancelled = true; };
  }, [stepId, uiLang]);

  const stepName = data?.canonicalName ?? (stepId ? `Step ${stepId}` : '');
  const breadcrumbs = buildBreadcrumb({ kind: 'fmSpecStep', stepName }, t);

  // Parameter folgen der globalen UI-Sprache (kein eigener Selektor mehr);
  // fällt auf den ersten verfügbaren Eintrag zurück, falls die Sprache fehlt.
  const paramEntry = useMemo(
    () => data?.langs.find((l) => l.language === uiLang) ?? data?.langs[0] ?? null,
    [data, uiLang],
  );

  const copyTemplate = () => {
    if (!grammar?.xmlMap?.snippetTemplate) return;
    navigator.clipboard?.writeText(grammar.xmlMap.snippetTemplate).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* clipboard unavailable — ignore */ });
  };

  return (
    <div className="app fmspec-view">
      <SubNav breadcrumbs={breadcrumbs} />
      <StatusBar />

      <div className="fmspec-page">
        <header className="fmspec-header">
          <h1 className="fmspec-title">
            {stepName}
            {data && <span className="fmspec-title__id">#{data.stepId}</span>}
          </h1>
          {data && (
            <p className="fmspec-subtitle">
              {t('fmSpec:step.slug')}: <span className="mono">{data.urlSlug}</span>
              {' · '}{t('fmSpec:steps.col.categoryId')}: {data.categoryId}
              {' · '}{t('fmSpec:steps.col.originVersion')}: {data.originVersion ?? dash}
            </p>
          )}
          {/* Plattform-Kompatibilität (Claris-Tabelle step_compat, tri-state):
              gelistet werden Yes + Partial; Partial ist markiert und NIE als
              „undokumentiert" zu lesen. false-Plattformen werden weggelassen. */}
          {data?.compat && (
            <p className="fmspec-subtitle fmspec-platform-line">
              {t('fmSpec:step.compat.label')}:{' '}
              {STEP_COMPAT_PLATFORMS.filter((p) => data.compat![p] !== false).map((p) => (
                <span
                  key={p}
                  className={`fmspec-tag fmspec-tag--platform${data.compat![p] === null ? ' fmspec-tag--partial' : ''}`}
                  title={data.compat![p] === null ? (t('fmSpec:step.compat.partialHint') as string) : undefined}
                >
                  {PLATFORM_LABELS[p]}
                  {data.compat![p] === null && <> · {t('fmSpec:step.compat.partial')}</>}
                </span>
              ))}
            </p>
          )}
          {/* OS-Bindung (Referenz ≥ 1.13.0, step_os_affinity): kuratierte
              OS-Aussagen aus der Claris-Prosa — exclusive / unsupported
              (quellentreu invers) / variant. OS-Namen sind Eigennamen. */}
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
          <>
            {/* ── Abschnitt: strukturierte Parameter (folgt globaler UI-Sprache) ── */}
            <section className="fmspec-section">
              <h2 className="fmspec-section__title">{t('fmSpec:step.section.parameters')}</h2>
              {paramEntry && paramEntry.parameters.length > 0 ? (
                <div className="fmspec-table-wrap">
                  <table className="fmspec-table">
                    <thead>
                      <tr>
                        <th className="num">{t('fmSpec:params.col.index')}</th>
                        <th>{t('fmSpec:params.col.name')}</th>
                        <th>{t('fmSpec:params.col.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paramEntry.parameters.map((p) => (
                        <tr key={p.index}>
                          <td className="num">{p.index}</td>
                          <td>{p.name ?? dash}</td>
                          <td>{p.description ?? dash}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="fmspec-muted">{t('fmSpec:step.params.none')}</div>
              )}
            </section>

            {/* ── Abschnitt 3: XMLSnippet-Grammatik ── */}
            <section className="fmspec-section">
              <h2 className="fmspec-section__title">{t('fmSpec:step.section.grammar')}</h2>
              {grammarAvailable === false && (
                <div className="fmspec-notice">{t('fmSpec:step.grammar.notAvailable')}</div>
              )}
              {grammar?.xmlMap && (
                <div className="fmspec-grammar">
                  <div className="fmspec-codeblock">
                    <div className="fmspec-codeblock__head">
                      <span>{t('fmSpec:step.grammar.template')}</span>
                      <button type="button" className="fmspec-copy" onClick={copyTemplate}>
                        {copied ? t('fmSpec:step.grammar.copied') : t('fmSpec:step.grammar.copy')}
                      </button>
                    </div>
                    <pre><code>{grammar.xmlMap.snippetTemplate}</code></pre>
                  </div>

                  <dl className="fmspec-facts">
                    <dt>{t('fmSpec:step.grammar.elementOrder')}</dt>
                    <dd className="mono">{grammar.xmlMap.elementOrder ?? dash}</dd>
                    {grammar.xmlMap.variableTargetMarker === true && (
                      <>
                        <dt>{t('fmSpec:step.grammar.variableTargetMarker')}</dt>
                        <dd>{t('fmSpec:step.grammar.variableTargetMarkerHint')}</dd>
                      </>
                    )}
                    <dt>{t('fmSpec:step.grammar.evidence')}</dt>
                    <dd>{grammar.xmlMap.evidence ?? dash}{grammar.xmlMap.verifiedVersion ? ` · ${grammar.xmlMap.verifiedVersion}` : ''}</dd>
                  </dl>

                  {grammar.options.length > 0 && (
                    <>
                      <div className="fmspec-subhead">{t('fmSpec:step.grammar.options')}</div>
                      <div className="fmspec-table-wrap">
                        <table className="fmspec-table fmspec-table--compact">
                          <thead>
                            <tr>
                              <th>{t('fmSpec:step.grammar.opt.key')}</th>
                              <th>{t('fmSpec:step.grammar.opt.type')}</th>
                              <th>{t('fmSpec:step.grammar.opt.required')}</th>
                              <th>{t('fmSpec:step.grammar.opt.label')}</th>
                              <th>{t('fmSpec:step.grammar.opt.xmlPath')}</th>
                              <th>{t('fmSpec:step.grammar.opt.evidence')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grammar.options.map((o) => (
                              <FragmentOption key={o.optionKey} o={o} dash={dash} valuesLabel={t('fmSpec:step.grammar.opt.values') as string} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {grammar.constraints.length > 0 && (
                    <>
                      <div className="fmspec-subhead">{t('fmSpec:step.grammar.constraints')}</div>
                      <ul className="fmspec-constraints">
                        {grammar.constraints.map((c) => (
                          <li key={c.constraintKind}>
                            <span className="fmspec-constraint__kind mono">
                              {c.constraintKind}
                              {KNOWN_BUG_KINDS.has(c.constraintKind) && (
                                <span
                                  className="fmspec-constraint__badge"
                                  title={t('fmSpec:step.grammar.knownBugHint') as string}
                                >
                                  FM bug
                                </span>
                              )}
                              {c.verifiedVersion && (
                                <span className="fmspec-constraint__version">{c.verifiedVersion}</span>
                              )}
                            </span>
                            <ConstraintDetail detail={c.detail} />
                            {c.consumerNote && (
                              <div className="fmspec-muted">
                                {t('fmSpec:step.grammar.consumerNote')}: {c.consumerNote}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {(grammar.repeatGroups?.length ?? 0) > 0 && (
                    <>
                      <div className="fmspec-subhead">{t('fmSpec:step.grammar.repeatGroups')}</div>
                      <ul className="fmspec-repeat-groups">
                        {grammar.repeatGroups!.map((g) => (
                          <li key={g.groupKey}>
                            <span className="fmspec-rg__label mono">{g.groupLabel}</span>
                            <span className="fmspec-rg__meta">
                              {t('fmSpec:step.grammar.rg.container')}: <code>{g.containerPath}</code>
                              {' · '}{g.itemForm}
                              {g.maxItems != null && (
                                <> · {t('fmSpec:step.grammar.rg.fixedSlots', { n: g.maxItems })}
                                  {g.padMode ? ` (${g.padMode})` : ''}</>
                              )}
                              {g.parentGroup && (
                                <> · {t('fmSpec:step.grammar.rg.nestedIn', { parent: g.parentGroup })}</>
                              )}
                              {g.countAttr && (
                                <> · {t('fmSpec:step.grammar.rg.countAttr', { attr: `@${g.countAttr}` })}</>
                              )}
                              {g.evidence && (
                                <> · {g.evidence}{g.verifiedVersion ? ` · ${g.verifiedVersion}` : ''}</>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {(grammar.skeletonElements?.length ?? 0) > 0 && (
                    <>
                      <div className="fmspec-subhead">{t('fmSpec:step.grammar.skeletons')}</div>
                      <ul className="fmspec-repeat-groups">
                        {grammar.skeletonElements!.map((s, i) => (
                          <li key={`${s.parentTag}/${s.childTag}/${i}`}>
                            <span className="fmspec-rg__label mono">{`<${s.childTag}>`}</span>
                            <span className="fmspec-rg__meta">
                              {s.parentTag !== 'Step' && (
                                <>{t('fmSpec:step.grammar.sk.in', { parent: `<${s.parentTag}>` })}{' · '}</>
                              )}
                              {t(`fmSpec:step.grammar.sk.${s.keepMode}`, { defaultValue: s.keepMode })}
                              {s.conditionOption && (
                                <> · {t('fmSpec:step.grammar.sk.condition', {
                                  cond: `${s.conditionOption} = ${s.conditionValue}`,
                                })}</>
                              )}
                              {s.evidence && (
                                <> · {s.evidence}{s.verifiedVersion ? ` · ${s.verifiedVersion}` : ''}</>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {(grammar.elementBindings?.length ?? 0) > 0 && (
                    <>
                      <div className="fmspec-subhead">{t('fmSpec:step.grammar.bindings')}</div>
                      <ul className="fmspec-repeat-groups">
                        {grammar.elementBindings!.map((b, i) => (
                          <li key={`${b.elementPath}/${b.binding}/${i}`}>
                            <span className="fmspec-rg__label mono">{`<${b.elementPath.split('/').pop()}>`}</span>
                            <span className="fmspec-rg__meta">
                              {b.elementPath.includes('/') && (
                                <><code>{b.elementPath}</code>{' · '}</>
                              )}
                              {b.binding === 'requires' && t('fmSpec:step.grammar.bd.requires', {
                                cond: `${b.optionKey} = ${b.optionValue}`,
                              })}
                              {b.binding === 'excludes' && t('fmSpec:step.grammar.bd.excludes', {
                                cond: `${b.optionKey} = ${b.optionValue}`,
                              })}
                              {b.binding === 'requires_option' && t('fmSpec:step.grammar.bd.requiresOption', {
                                option: b.optionKey ?? '',
                              })}
                              {b.binding === 'excludes_option' && t('fmSpec:step.grammar.bd.excludesOption', {
                                option: b.optionKey ?? '',
                              })}
                              {b.binding === 'suppress_empty' && t('fmSpec:step.grammar.bd.suppressEmpty')}
                              {b.evidence && (
                                <> · {b.evidence}{b.verifiedVersion ? ` · ${b.verifiedVersion}` : ''}</>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {(grammar.optionImplications?.length ?? 0) > 0 && (
                    <>
                      <div className="fmspec-subhead">{t('fmSpec:step.grammar.implications')}</div>
                      <ul className="fmspec-repeat-groups">
                        {grammar.optionImplications!.map((im, i) => (
                          <li key={`${im.triggerKind}/${im.trigger}/${i}`}>
                            <span className="fmspec-rg__label mono">{im.trigger}</span>
                            <span className="fmspec-rg__meta">
                              {t(`fmSpec:step.grammar.imp.${im.triggerKind}`, { defaultValue: im.triggerKind })}
                              {' → '}
                              <code>
                                {im.impliedOption}
                                {im.impliedValue != null ? ` = ${im.impliedValue}` : ''}
                              </code>
                              {im.isDefault && <> · {t('fmSpec:step.grammar.imp.default')}</>}
                              {im.evidence && (
                                <> · {im.evidence}{im.verifiedVersion ? ` · ${im.verifiedVersion}` : ''}</>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                </div>
              )}
            </section>

            {/* ── Abschnitt 4: SaXML-Details ── */}
            <section className="fmspec-section">
              <h2 className="fmspec-section__title">{t('fmSpec:step.section.saxml')}</h2>
              {grammar?.xmlMap ? (
                <>
                  <dl className="fmspec-facts">
                    <dt>{t('fmSpec:step.saxml.paramTypes')}</dt>
                    <dd className="mono">{grammar.xmlMap.saxmlParamTypes ?? dash}</dd>
                    <dt>{t('fmSpec:step.grammar.evidence')}</dt>
                    <dd>{grammar.xmlMap.evidence ?? dash}{grammar.xmlMap.verifiedVersion ? ` · ${grammar.xmlMap.verifiedVersion}` : ''}</dd>
                  </dl>
                  {grammar.xmlMap.saxmlExample && (
                    <div className="fmspec-codeblock">
                      <div className="fmspec-codeblock__head">
                        <span>{t('fmSpec:step.saxml.example')}</span>
                      </div>
                      <pre><code>{grammar.xmlMap.saxmlExample}</code></pre>
                    </div>
                  )}
                  <p className="fmspec-hint">{t('fmSpec:step.saxml.hint')}</p>
                  <p className="fmspec-footnote">{t('fmSpec:step.saxml.sourceNote')}</p>
                </>
              ) : (
                <div className="fmspec-muted">{t('fmSpec:step.saxml.none')}</div>
              )}
            </section>

            {/* ── Abschnitt: lokalisierte Step-Daten (ans Ende geschoben) ── */}
            <section className="fmspec-section">
              <h2 className="fmspec-section__title">{t('fmSpec:step.section.localized')}</h2>
              <div className="fmspec-table-wrap">
                <table className="fmspec-table">
                  <thead>
                    <tr>
                      <th>{t('fmSpec:step.localized.language')}</th>
                      <th>{t('fmSpec:step.localized.displayName')}</th>
                      <th>{t('fmSpec:step.localized.description')}</th>
                      <th>{t('fmSpec:step.localized.help')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.langs.map((l) => {
                      const href = resolveHelpHref(l.localHelpUrl, l.helpUrl);
                      return (
                        <tr key={l.language}>
                          <td className="mono">{l.language}</td>
                          <td>{l.displayName}</td>
                          <td>{l.description ?? dash}</td>
                          <td>
                            {href
                              ? <a href={href} target="_blank" rel="noreferrer">{t('fmSpec:help.open')}</a>
                              : dash}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function FragmentOption({
  o,
  dash,
  valuesLabel,
}: {
  o: import('../api/fmSpecApi').StepOption;
  dash: string;
  valuesLabel: string;
}) {
  const { t } = useTranslation(['fmSpec']);
  const [open, setOpen] = useState(false);
  const hasValues = o.values.length > 0;
  // any value whose evidence deviates from the option row is worth a badge;
  // pre-1.7.0 references deliver evidence=null → no badges, no toggle hint
  const hasDeviantEvidence = o.values.some((v) => v.evidence != null && v.evidence !== o.evidence);
  const isBool = o.optionType === 'boolean' && (o.trueText != null || o.falseText != null);
  return (
    <>
      <tr>
        <td className="mono">{o.optionKey}</td>
        <td>
          {o.optionType}
          {hasValues && (
            <button type="button" className="fmspec-values-toggle" onClick={() => setOpen((v) => !v)}>
              {valuesLabel} ({o.values.length}){hasDeviantEvidence ? ' ⚑' : ''}
            </button>
          )}
        </td>
        <td>{o.required ? '✓' : dash}</td>
        <td>
          {o.displayLabelEn ?? dash}
          {isBool && (
            <div className="fmspec-bool-map">
              <span className="mono">{o.trueText ?? 'On'}</span>{' → True · '}
              <span className="mono">{o.falseText ?? 'Off'}</span>{' → False'}
              {o.invertedLabel && (
                <span className="fmspec-inverted" title={t('fmSpec:step.grammar.opt.invertedHint') as string}>
                  {' '}⇄
                </span>
              )}
            </div>
          )}
        </td>
        <td className="mono">{o.xmlPath ?? dash}</td>
        <td>{o.evidence ?? dash}</td>
      </tr>
      {open && hasValues && (
        <tr className="fmspec-detail-row">
          <td colSpan={6}>
            <table className="fmspec-subtable">
              <tbody>
                {o.values.map((v) => (
                  <tr key={v.xmlValue}>
                    <td className="mono">{v.xmlValue}</td>
                    <td>{v.displayTextEn ?? dash}</td>
                    <td>
                      {v.evidence != null && v.evidence !== o.evidence && (
                        <span
                          className={`fmspec-evidence-badge${v.evidence === 'claris-doc' ? ' fmspec-evidence-badge--doc' : ''}`}
                          title={v.evidence === 'claris-doc' ? (t('fmSpec:step.grammar.opt.docOnly') as string) : undefined}
                        >
                          {v.evidence}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export default FmSpecStepView;
