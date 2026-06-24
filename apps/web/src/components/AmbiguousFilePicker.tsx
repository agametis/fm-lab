import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface AmbiguousFilePickerProps {
  /** The ambiguous object UUID (shared across the listed files). */
  uuid: string;
  /** Files in which this UUID exists (from the 409 AMBIGUOUS_UUID `matched_files`). */
  files: string[];
}

/**
 * Sicherheitsnetz für die Klon-Disambiguierung.
 *
 * Trifft eine noch nicht migrierte bare-UUID-Navigation auf ein Objekt, dessen
 * UUID in mehreren (geklonten/modularen) Dateien existiert, antwortet die REST-API
 * mit `409 AMBIGUOUS_UUID` + `matched_files`. Statt hart zu scheitern, bietet dieser
 * Picker die betroffenen Dateien zur Auswahl an und navigiert mit `?file=<gewählt>`
 * — die übrigen Query-Params (`ref`, `tab`) bleiben erhalten.
 */
export const AmbiguousFilePicker: React.FC<AmbiguousFilePickerProps> = ({ uuid, files }) => {
  const { t } = useTranslation(['nav', 'common']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const pick = (file: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('file', file);
    navigate(`/object/${uuid}?${params.toString()}`);
  };

  return (
    <div className="ambiguous-file-picker" role="alertdialog" aria-labelledby="ambiguous-file-title">
      <h2 id="ambiguous-file-title" className="ambiguous-file-picker__title">
        {t('nav:ambiguousFile.title', { defaultValue: 'Welche Datei?' })}
      </h2>
      <p className="ambiguous-file-picker__body">
        {t('nav:ambiguousFile.body', {
          count: files.length,
          defaultValue:
            'Diese UUID existiert in {{count}} Dateien (geklonte/modulare Lösung). Bitte die gewünschte Datei wählen.',
        })}
      </p>
      <ul className="ambiguous-file-picker__list">
        {files.map((file) => (
          <li key={file}>
            <button type="button" className="ambiguous-file-picker__item" onClick={() => pick(file)}>
              {file}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
