import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFeaturesContext } from '../../../hooks/useFeatures';
import { buildGotoUrl } from '../hooks/useFmideUri';
import type { ObjectSlotProps } from '../../types';

/**
 * URIcorn quick-action in list rows. Only renders when the backend marks
 * the object type as supported (`ui.supported_object_types`).
 */
export const FmideQuickAction: React.FC<ObjectSlotProps> = ({ objectUuid, objectType }) => {
  const { t } = useTranslation();
  const { getUi } = useFeaturesContext();
  const supported = getUi('fmide')?.supported_object_types ?? [];

  if (!supported.includes(objectType)) return null;

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
