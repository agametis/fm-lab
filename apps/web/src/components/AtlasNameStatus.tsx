import { useTranslation } from 'react-i18next';
import type { CommunityStats } from '../hooks/useCommunityStats';

/**
 * Community-Namen-Status für die Atlas-Statusleiste (rechts vom „Zurück"-Button).
 * Zwei kompakte Angaben: die mitglieder-gewichtete Abdeckung der semantischen
 * Namen (`NN%` bzw. `--`) und die Anzahl `semantisch / benutzer-definiert`.
 *
 * Präsentational — die Daten (inkl. Failover-Flag) hält der View über
 * `useCommunityStats()`. Ohne geladene Stats (oder ohne Clustering) rendert nichts.
 */
export function AtlasNameStatus({ stats }: { stats: CommunityStats | null }) {
  const { t } = useTranslation('atlas');
  if (!stats || !stats.clusters_available) return null;

  const coverage =
    stats.coverage_pct === null
      ? (t('status.semanticNamesNone') as string)
      : (t('status.semanticNames', { value: `${Math.round(stats.coverage_pct * 100)}%` }) as string);

  return (
    <span className="atlas-namestatus">
      <span>{coverage}</span>
      <span className="atlas-namestatus-sep">·</span>
      <span>{t('status.count', { semantic: stats.semantic_count, user: stats.user_defined_count })}</span>
    </span>
  );
}
