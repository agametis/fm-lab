import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { FMObject } from '../types';
import { useObjectChangeMeta, type ObjectChangeMeta } from '../hooks/useObjectChangeMeta';
import { buildObjectPath } from '../lib/navigation';
import { formatStamp, formatStampAge, formatStampDate } from '../lib/changeStamp';

interface ObjectChangeLineProps {
  object: FMObject;
}

/**
 * Third header row "Last modified" for every object type:
 * - own stamp:      🕓 Last modified 2026-01-19 11:21 · Jane Doe (developer) · 63 changes
 * - container stamp (script steps, layout objects, calculations, …):
 *                   🕓 Container last modified 2026-08-18 15:40 · Script "Send" · Jane Doe
 * plus badges for technical authors and mass events. Hidden when the object
 * has no stamp (variables, synthetic types) or the catalog has no change metadata.
 * The author opens the dashboard "Recent changes" filtered to that person, the
 * mass-event badge opens it on the event's time window.
 */
export const ObjectChangeLine: React.FC<ObjectChangeLineProps> = ({ object }) => {
  const { t, i18n } = useTranslation(['detail', 'types']);
  const meta = useObjectChangeMeta(object.Object_UUID, object.File_Name, object.Object_Type);
  if (!meta || !meta.modified_at) return null;

  const at = formatStamp(meta.modified_at);
  const age = formatStampAge(meta.modified_at, i18n.language);
  const author = meta.author_display || meta.modified_by || t('detail:objectHeader.change.unknownAuthor');
  const isContainer = meta.meta_source === 'container';

  return (
    <div className="detail-change-line" data-testid="object-change-line">
      <span className="detail-change-icon" aria-hidden="true">🕓</span>
      <span className="detail-change-label">
        {isContainer
          ? t('detail:objectHeader.change.containerModified')
          : t('detail:objectHeader.change.modified')}
      </span>
      <time
        className="detail-change-time"
        dateTime={meta.modified_at.replace(' ', 'T')}
        title={t('detail:objectHeader.change.timeTooltip', { age: age ?? '' }) as string}
      >
        {at}
      </time>
      {isContainer && (
        <>
          <span className="detail-change-sep" aria-hidden="true">·</span>
          <span className="detail-change-container">
            {t(`types:objectTypes.${meta.stamp_type}`, { defaultValue: meta.stamp_type })}{' '}
            <Link to={buildObjectPath(meta.stamp_uuid, object.Object_UUID, meta.stamp_file)}>
              {t('detail:objectHeader.change.quotedName', {
                name: meta.stamp_name || t('detail:objectHeader.noName'),
              })}
            </Link>
          </span>
        </>
      )}
      <span className="detail-change-sep" aria-hidden="true">·</span>
      <Link
        className="detail-change-author"
        to={changesPath({
          person: meta.person_key ?? meta.author_key,
          days: 'all',
          ...listScope(meta),
        })}
        title={t('detail:objectHeader.change.authorTooltip') as string}
      >
        {author}
      </Link>
      {meta.modified_account && (
        <span className="detail-change-account" title={t('detail:objectHeader.change.accountTooltip') as string}>
          ({meta.modified_account})
        </span>
      )}
      {!isContainer && meta.modifications != null && (
        <>
          <span className="detail-change-sep" aria-hidden="true">·</span>
          <span className="detail-change-count" title={t('detail:objectHeader.change.countTooltip') as string}>
            {t('detail:objectHeader.change.modifications', { count: Number(meta.modifications) })}
          </span>
        </>
      )}
      {meta.author_is_technical && <TechnicalBadge meta={meta} />}
      {meta.bulk_event_id != null && <BulkBadge meta={meta} />}
    </div>
  );
};

const TechnicalBadge: React.FC<{ meta: ObjectChangeMeta }> = ({ meta }) => {
  const { t } = useTranslation(['detail']);
  const kind = meta.author_kind === 'tool' || meta.author_kind === 'runtime' ? meta.author_kind : 'other';
  return (
    <span
      className="detail-change-badge"
      title={t(`detail:objectHeader.change.technical.${kind}Tooltip`) as string}
    >
      {t(`detail:objectHeader.change.technical.${kind}`)}
    </span>
  );
};

const BulkBadge: React.FC<{ meta: ObjectChangeMeta }> = ({ meta }) => {
  const { t } = useTranslation(['detail']);
  const kind = meta.bulk_kind === 'tool' || meta.bulk_kind === 'paste_import' ? meta.bulk_kind : 'mass_action';
  const tooltip = [
    t(`detail:objectHeader.change.bulk.kind.${kind}`),
    meta.bulk_scope === 'solution'
      ? t('detail:objectHeader.change.bulk.scopeSolution', { count: Number(meta.bulk_files ?? 0) })
      : t('detail:objectHeader.change.bulk.scopeFile'),
    t('detail:objectHeader.change.bulk.objects', { count: Number(meta.bulk_objects ?? 0) }),
    `${formatStamp(meta.bulk_start) ?? ''} – ${formatStamp(meta.bulk_end) ?? ''}`,
    t('detail:objectHeader.change.bulk.hint'),
  ].join('\n');
  return (
    <Link
      className="detail-change-badge detail-change-badge--bulk"
      to={changesPath({ from: meta.bulk_start, to: meta.bulk_end, bulk: 'include', ...listScope(meta) })}
      title={tooltip}
    >
      <span aria-hidden="true">⚑ </span>
      {t('detail:objectHeader.change.bulk.badge', { date: formatStampDate(meta.bulk_start) ?? '' })}
    </Link>
  );
};

/**
 * Filters the change list hides by default but this stamp needs to show up:
 * technical authors, and Account/Authorization (runtime changes).
 */
function listScope(meta: ObjectChangeMeta): Record<string, string> {
  const scope: Record<string, string> = {};
  if (meta.author_is_technical) scope.technical = 'include';
  if (meta.stamp_type === 'Account' || meta.stamp_type === 'Authorization') scope.type = meta.stamp_type;
  return scope;
}

function changesPath(params: Record<string, string | null | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) usp.set(key, value);
  return `/dashboard/changes?${usp.toString()}`;
}
