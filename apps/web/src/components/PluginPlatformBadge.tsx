import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchPluginFunctionSpec, type PluginFunctionSpec } from '../api/pluginSpecApi';
import { parsePluginFunctionName } from '../lib/objectName';
import './PluginPlatformBadge.css';

interface PluginPlatformBadgeProps {
  /** Raw catalog name, e.g. `MBS:Files.FileSize::Files.FileSize`. */
  objectName: string;
}

/** Display labels of the verbatim MBS platform axes (proper nouns, no i18n). */
const PLATFORM_LABELS: Record<string, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  server: 'Server',
  ios_sdk: 'iOS SDK',
};

/**
 * Platform badge for PluginFunction detail views: the verbatim per-axis
 * support flags from the plug-in platform map (plugref), plus deprecation
 * and old-name hints. Renders nothing when no statement exists — an absent
 * map or unknown function is an install/coverage state, not an error.
 */
export const PluginPlatformBadge: React.FC<PluginPlatformBadgeProps> = ({ objectName }) => {
  const { t } = useTranslation(['detail']);
  const [spec, setSpec] = useState<PluginFunctionSpec | null>(null);

  const { name, component: prefix } = parsePluginFunctionName(objectName);

  useEffect(() => {
    let cancelled = false;
    setSpec(null);
    if (!prefix || !name) return;
    fetchPluginFunctionSpec(prefix, name).then(result => {
      if (!cancelled) setSpec(result);
    });
    return () => { cancelled = true; };
  }, [prefix, name]);

  if (!spec) return null;

  return (
    <div className="plugin-platform-badge" title={t('detail:pluginSpec.tooltip', { plugin: spec.plugin_name }) as string}>
      {spec.platforms.map(p => (
        <span
          key={p.platform}
          className={`plugin-platform-chip ${p.supported ? 'supported' : 'unsupported'}`}
          title={p.qualifier ? `${PLATFORM_LABELS[p.platform] || p.platform}: ${p.qualifier}` : undefined}
        >
          {p.supported ? '✓' : '✗'} {PLATFORM_LABELS[p.platform] || p.platform}
          {p.qualifier ? '*' : ''}
        </span>
      ))}
      {spec.since_version && (
        <span className="plugin-platform-meta">
          {t('detail:pluginSpec.since', { version: spec.since_version })}
        </span>
      )}
      {spec.status !== 'active' && (
        <span className="plugin-platform-status" title={spec.status_note || undefined}>
          {t(spec.status === 'removed' ? 'detail:pluginSpec.removed' : 'detail:pluginSpec.deprecated')}
          {spec.status === 'deprecated' && spec.replacement
            ? ` — ${t('detail:pluginSpec.replacementHint', { replacement: spec.replacement })}`
            : ''}
        </span>
      )}
      {spec.alias && (
        <span className="plugin-platform-meta" title={spec.alias}>
          {t('detail:pluginSpec.oldNameHint', { name: spec.function_name })}
        </span>
      )}
    </div>
  );
};
