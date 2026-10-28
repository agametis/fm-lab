import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchChangeAuthors,
  saveChangeAuthorAlias,
  deleteChangeAuthorAlias,
  type ChangeAuthor,
  type ChangeAuthorAlias,
  type ChangeAuthorsResponse,
} from '../api/changeAuthorsApi';
import { clearObjectChangeMetaCache } from '../hooks/useObjectChangeMeta';
import { useActiveSolutionName } from '../lib/activeSolutionName';
import { formatStamp } from '../lib/changeStamp';

type Technical = 'auto' | 'yes' | 'no';

interface Draft {
  person: string;    // '' = the key itself
  display: string;   // '' = automatic (most frequent spelling)
  technical: Technical;
}

const norm = (s: string) => s.trim().toLowerCase();

function draftFrom(alias: ChangeAuthorAlias | undefined): Draft {
  return {
    person: alias?.Author_Key ?? '',
    display: alias?.Display_Name ?? '',
    technical: alias?.Is_Technical == null ? 'auto' : alias.Is_Technical ? 'yes' : 'no',
  };
}

const sameDraft = (a: Draft, b: Draft) =>
  a.person === b.person && a.display.trim() === b.display.trim() && a.technical === b.technical;

/**
 * Next drafts after a reload: rows in `reset` (or all rows when `reset` is
 * 'all') take the stored state, every other row keeps its unsaved draft. A kept
 * draft that points to a person who is no longer a merge target follows that
 * person's new key (no chains); a target that resolves to the row itself or
 * disappeared falls back to the row's own person.
 */
function nextDrafts(
  res: ChangeAuthorsResponse,
  prev: Record<string, Draft>,
  reset: 'all' | string,
): Record<string, Draft> {
  const byKey = new Map(res.aliases.filter((a) => a.Kind === 'user').map((a) => [norm(a.Raw_Value), a]));
  const personOf = new Map(res.authors.map((a) => [a.Author_Key, a.Person_Key]));
  const next: Record<string, Draft> = {};
  for (const a of res.authors) {
    const kept = reset === 'all' || reset === a.Author_Key ? undefined : prev[a.Author_Key];
    if (!kept) {
      next[a.Author_Key] = draftFrom(byKey.get(a.Author_Key));
      continue;
    }
    let person = kept.person;
    if (person) {
      const resolved = personOf.get(person);
      person = resolved && resolved !== a.Author_Key ? resolved : '';
    }
    next[a.Author_Key] = person === kept.person ? kept : { ...kept, person };
  }
  return next;
}

/**
 * Settings section "Authors of the change metadata": merges spelling variants of
 * one person, sets display names and marks technical authors — for the
 * solution of this tab. The aliases live in the solution's annotations sidecar
 * and survive a rebuild; the header line "Last modified" uses them at once.
 */
export const ChangeAuthorsPanel: React.FC = () => {
  const { t } = useTranslation(['detail']);
  const solutionName = useActiveSolutionName();
  const [data, setData] = useState<ChangeAuthorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const aliasByKey = useMemo(() => {
    const m = new Map<string, ChangeAuthorAlias>();
    for (const a of data?.aliases ?? []) if (a.Kind === 'user') m.set(norm(a.Raw_Value), a);
    return m;
  }, [data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchChangeAuthors();
      setData(res);
      setDrafts((prev) => nextDrafts(res, prev, 'all'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Reload after a write to one row: only that row's draft takes the stored state. */
  const reloadRow = useCallback(async (authorKey: string) => {
    const res = await fetchChangeAuthors();
    setData(res);
    setDrafts((prev) => nextDrafts(res, prev, authorKey));
  }, []);

  useEffect(() => { load(); }, [load, solutionName]);

  const save = useCallback(async (author: ChangeAuthor) => {
    const d = drafts[author.Author_Key];
    if (!d) return;
    setBusyKey(author.Author_Key);
    setError(null);
    try {
      await saveChangeAuthorAlias({
        raw_value: author.Author_Key,
        author_key: d.person || null,
        display_name: d.display.trim() || null,
        is_technical: d.technical === 'auto' ? null : d.technical === 'yes',
      });
      clearObjectChangeMetaCache();
      await reloadRow(author.Author_Key);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [drafts, reloadRow]);

  const removeAlias = useCallback(async (rawValue: string) => {
    setBusyKey(rawValue);
    setError(null);
    try {
      await deleteChangeAuthorAlias(rawValue);
      clearObjectChangeMetaCache();
      await reloadRow(norm(rawValue));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [reloadRow]);

  const authors = data?.authors ?? [];
  // Merge targets: keys that are not merged into someone else themselves (no chains).
  const targets = authors.filter((a) => a.Person_Key === a.Author_Key);
  const orphans = (data?.aliases ?? []).filter(
    (a) => a.Kind === 'user' && !authors.some((x) => x.Author_Key === norm(a.Raw_Value)),
  );
  const editable = !!data?.sidecar_available;
  // One write at a time, so a later reload never overtakes an earlier one.
  const writing = busyKey !== null;

  return (
    <section className="api-settings-card change-authors-panel">
      <h2 className="api-settings-heading">{t('detail:settingsView.changeAuthors.heading')}</h2>
      <p className="api-settings-desc">
        {t('detail:settingsView.changeAuthors.desc')}
        {solutionName && (
          <> {t('detail:settingsView.changeAuthors.solution', { name: solutionName })}</>
        )}
      </p>

      {loading && <div className="settings-loading">{t('detail:settingsView.changeAuthors.loading')}</div>}
      {error && <div className="settings-error">{error}</div>}
      {!loading && data && !editable && (
        <div className="change-authors-note">{t('detail:settingsView.changeAuthors.noSidecar')}</div>
      )}
      {!loading && data && authors.length === 0 && (
        <div className="settings-empty">{t('detail:settingsView.changeAuthors.empty')}</div>
      )}

      {authors.length > 0 && (
        <div className="change-authors-scroll">
          <table className="change-authors-table">
            <thead>
              <tr>
                <th title={t('detail:settingsView.changeAuthors.colUserTitle') as string}>
                  {t('detail:settingsView.changeAuthors.colUser')}
                </th>
                <th className="num">{t('detail:settingsView.changeAuthors.colStamps')}</th>
                <th>{t('detail:settingsView.changeAuthors.colLast')}</th>
                <th>{t('detail:settingsView.changeAuthors.colPerson')}</th>
                <th>{t('detail:settingsView.changeAuthors.colDisplay')}</th>
                <th>{t('detail:settingsView.changeAuthors.colTechnical')}</th>
                <th aria-label={t('detail:settingsView.changeAuthors.colActions') as string} />
              </tr>
            </thead>
            <tbody>
              {authors.map((a) => {
                const d = drafts[a.Author_Key] ?? draftFrom(undefined);
                const stored = draftFrom(aliasByKey.get(a.Author_Key));
                const dirty = !sameDraft(d, stored);
                const busy = busyKey === a.Author_Key;
                const setDraft = (patch: Partial<Draft>) =>
                  setDrafts((prev) => ({ ...prev, [a.Author_Key]: { ...d, ...patch } }));
                const autoTechnical = a.Author_Kind != null;
                return (
                  <tr key={a.Author_Key} className={a.Is_Curated ? 'is-curated' : undefined}>
                    <td>
                      <div className="change-authors-names">{a.Raw_Names.join(' · ')}</div>
                      {a.Accounts.length > 0 && (
                        <div className="change-authors-sub" title={t('detail:settingsView.changeAuthors.accountsTitle') as string}>
                          {a.Accounts.join(', ')}
                        </div>
                      )}
                      {a.Author_Kind && (
                        <span className="change-authors-kind">
                          {t(`detail:objectHeader.change.technical.${a.Author_Kind === 'tool' ? 'tool' : 'runtime'}`)}
                        </span>
                      )}
                    </td>
                    <td className="num" title={t('detail:settingsView.changeAuthors.stampsTitle', {
                      single: a.Single_Stamps, files: a.Files,
                    }) as string}>
                      {a.Stamps.toLocaleString()}
                    </td>
                    <td className="change-authors-time">{formatStamp(a.Last_At)}</td>
                    <td>
                      <select
                        value={d.person}
                        disabled={!editable || busy}
                        onChange={(e) => setDraft({ person: e.target.value })}
                        aria-label={t('detail:settingsView.changeAuthors.colPerson') as string}
                      >
                        <option value="">{t('detail:settingsView.changeAuthors.ownPerson')}</option>
                        {targets.filter((x) => x.Author_Key !== a.Author_Key).map((x) => (
                          <option key={x.Author_Key} value={x.Author_Key}>
                            {x.Display_Name ?? x.Author_Key}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={d.display}
                        placeholder={a.Raw_Names[0] ?? a.Author_Key}
                        disabled={!editable || busy}
                        onChange={(e) => setDraft({ display: e.target.value })}
                        aria-label={t('detail:settingsView.changeAuthors.colDisplay') as string}
                      />
                    </td>
                    <td>
                      <select
                        className="change-authors-technical"
                        value={d.technical}
                        disabled={!editable || busy}
                        onChange={(e) => setDraft({ technical: e.target.value as Technical })}
                        aria-label={t('detail:settingsView.changeAuthors.colTechnical') as string}
                        // The short "auto" option keeps the column narrow; the
                        // tooltip names what the automatic detection decided.
                        title={t(autoTechnical
                          ? 'detail:settingsView.changeAuthors.technicalAutoYes'
                          : 'detail:settingsView.changeAuthors.technicalAutoNo') as string}
                      >
                        <option value="auto">{t('detail:settingsView.changeAuthors.technicalAuto')}</option>
                        <option value="yes">{t('detail:settingsView.changeAuthors.technicalYes')}</option>
                        <option value="no">{t('detail:settingsView.changeAuthors.technicalNo')}</option>
                      </select>
                    </td>
                    <td className="change-authors-actions">
                      <button
                        type="button"
                        className="api-settings-save"
                        disabled={!editable || writing || !dirty}
                        onClick={() => save(a)}
                      >
                        {t('detail:settingsView.changeAuthors.save')}
                      </button>
                      {a.Is_Curated && (
                        <button
                          type="button"
                          className="api-settings-clear"
                          disabled={!editable || writing}
                          onClick={() => removeAlias(aliasByKey.get(a.Author_Key)?.Raw_Value ?? a.Author_Key)}
                        >
                          {t('detail:settingsView.changeAuthors.reset')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {orphans.length > 0 && (
        <div className="change-authors-orphans">
          <h3>{t('detail:settingsView.changeAuthors.orphanHeading')}</h3>
          <ul>
            {orphans.map((o) => (
              <li key={o.Raw_Value}>
                <code>{o.Raw_Value}</code>
                {o.Author_Key && <> → <code>{o.Author_Key}</code></>}
                {o.Display_Name && <> · {o.Display_Name}</>}
                <button
                  type="button"
                  className="api-settings-clear"
                  disabled={!editable || writing}
                  onClick={() => removeAlias(o.Raw_Value)}
                >
                  {t('detail:settingsView.changeAuthors.orphanDelete')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
