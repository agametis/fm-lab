import React from 'react';
import { useTranslation } from 'react-i18next';

interface LoadingSpinnerProps {
  message?: string;
}

/**
 * Loading Spinner Component
 * Simple loading indicator for async operations
 */
export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message }) => {
  const { t } = useTranslation();
  const text = message ?? (t('loading') as string);
  return (
    <div style={{
      padding: '20px',
      textAlign: 'center',
      color: '#666',
      fontSize: '14px'
    }}>
      <div style={{
        display: 'inline-block',
        width: '20px',
        height: '20px',
        border: '3px solid #f3f3f3',
        borderTop: '3px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        marginRight: '10px',
        verticalAlign: 'middle'
      }} />
      <span>{text}</span>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
