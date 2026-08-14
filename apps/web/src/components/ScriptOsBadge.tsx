import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeTestsStore, getObjectOsBinding } from '../lib/testsStore';
import './PluginPlatformBadge.css';

interface ScriptOsBadgeProps {
  objectUuid: string;
}

/** OS names are proper nouns — never localized. */
const OS_LABELS: Record<string, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  ios: 'iOS',
};

/**
 * OS-binding badge for Script detail views (v7): the operating systems this
 * script is bound to, read from cached platform-os-binding test runs (same
 * cache mechanic as the tests tab badge — the chip appears once the OS test
 * ran in any scope that names this script). Neutral inventory, never a
 * defect signal; renders nothing without a cached finding.
 */
export const ScriptOsBadge: React.FC<ScriptOsBadgeProps> = ({ objectUuid }) => {
  const { t } = useTranslation(['detail']);
  const binding = useSyncExternalStore(
    subscribeTestsStore,
    () => getObjectOsBinding(objectUuid),
  );

  if (!binding) return null;

  return (
    <div className="plugin-platform-badge" title={t('detail:osBinding.tooltip') as string}>
      <span className="plugin-platform-meta">{t('detail:osBinding.label')}</span>
      {binding.split(',').map(os => (
        <span key={os} className="plugin-platform-chip supported">
          {OS_LABELS[os] || os}
        </span>
      ))}
    </div>
  );
};
