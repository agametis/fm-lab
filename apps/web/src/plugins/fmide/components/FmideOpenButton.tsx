import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFmideUri } from '../hooks/useFmideUri';
import type { ObjectSlotProps } from '../../types';

/**
 * "Open in FileMaker" button rendered in the object header.
 * Fetches the fmp:// URL via the REST API and only renders when the backend
 * reports the object type as supported.
 */
export const FmideOpenButton: React.FC<ObjectSlotProps> = ({ objectUuid }) => {
  const { t } = useTranslation();
  const { data } = useFmideUri(objectUuid);

  if (!data?.supported || !data.fmp_url) return null;

  const handleClick = () => {
    if (data.fmp_url) {
      window.location.href = data.fmp_url;
    }
  };

  const label = t('actions.openInFileMaker');
  return (
    <button
      onClick={handleClick}
      className="fmide-open-button"
      aria-label={label as string}
      title={data.thingamajig_uri || (label as string)}
    >
      <span className="fmide-unicorn" aria-hidden="true">&#x1F984;</span>
      <span>{label}</span>
    </button>
  );
};
