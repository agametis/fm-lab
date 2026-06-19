import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFeaturesContext } from '../../../hooks/useFeatures';
import { useFmideStatus } from '../hooks/useFmideStatus';
import { buildGotoUrl } from '../hooks/useFmideUri';
import type { ObjectSlotProps } from '../../types';

/**
 * URIcorn quick-action in list rows. Only renders when the backend marks the
 * object type as supported (`ui.supported_object_types`) AND the object's file
 * actually contains the fmIDE target script (per-file status).
 */
export const FmideQuickAction: React.FC<ObjectSlotProps> = ({ objectUuid, objectType, fileName }) => {
  const { t } = useTranslation();
  const { getUi, getConfig } = useFeaturesContext();
  const statuses = useFmideStatus();
  const supported = getUi('fmide')?.supported_object_types ?? [];

  if (!supported.includes(objectType)) return null;

  // When the "only show when installed" option is on (default), hide the action
  // unless the per-file status confirms the fmIDE script is present in this file.
  const onlyIfInstalled = String(getConfig('fmide')?.only_if_installed ?? 'true') !== 'false';
  if (onlyIfInstalled && (!statuses || !statuses[fileName]?.script_present)) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.location.href = buildGotoUrl(objectUuid);
  };

  const label = t('actions.openInFileMaker');
  return (
    <button
      className="fmide-quick-action"
      onClick={handleClick}
      aria-label={label as string}
      title={label as string}
    >
      <span aria-hidden="true">&#x1F984;</span>
    </button>
  );
};
