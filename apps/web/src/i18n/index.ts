/**
 * i18next initialisation for the web frontend.
 *
 * Resolution order for the initial language:
 *   1. `localStorage["fmlab.lang"]` (user pick from the LanguageSelector)
 *   2. Server-supplied default from `/api/system/config` (set later via `applyServerLanguage`)
 *   3. Browser `navigator.language` reduced to a supported code
 *   4. `DEFAULT_LANGUAGE` ('en')
 *
 * English is always the fallback — every supported language is allowed to be
 * partial; missing keys fall back to the English master.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
  resolveLanguage,
} from '@packages/shared/languages';

import enCommon    from './locales/en/common.json';
import enNav       from './locales/en/nav.json';
import enDetail    from './locales/en/detail.json';
import enErrors    from './locales/en/errors.json';
import enTypes     from './locales/en/types.json';
import enDashboard from './locales/en/dashboard.json';
import enExplorer  from './locales/en/explorer.json';
import enAtlas     from './locales/en/atlas.json';

import deCommon    from './locales/de/common.json';
import deNav       from './locales/de/nav.json';
import deDetail    from './locales/de/detail.json';
import deErrors    from './locales/de/errors.json';
import deTypes     from './locales/de/types.json';
import deDashboard from './locales/de/dashboard.json';
import deExplorer  from './locales/de/explorer.json';
import deAtlas     from './locales/de/atlas.json';

import esCommon    from './locales/es/common.json';
import esNav       from './locales/es/nav.json';
import esDetail    from './locales/es/detail.json';
import esErrors    from './locales/es/errors.json';
import esTypes     from './locales/es/types.json';
import esDashboard from './locales/es/dashboard.json';

import frCommon    from './locales/fr/common.json';
import frNav       from './locales/fr/nav.json';
import frDetail    from './locales/fr/detail.json';
import frErrors    from './locales/fr/errors.json';
import frTypes     from './locales/fr/types.json';
import frDashboard from './locales/fr/dashboard.json';

import itCommon    from './locales/it/common.json';
import itNav       from './locales/it/nav.json';
import itDetail    from './locales/it/detail.json';
import itErrors    from './locales/it/errors.json';
import itTypes     from './locales/it/types.json';
import itDashboard from './locales/it/dashboard.json';

import nlCommon    from './locales/nl/common.json';
import nlNav       from './locales/nl/nav.json';
import nlDetail    from './locales/nl/detail.json';
import nlErrors    from './locales/nl/errors.json';
import nlTypes     from './locales/nl/types.json';
import nlDashboard from './locales/nl/dashboard.json';

import ptCommon    from './locales/pt/common.json';
import ptNav       from './locales/pt/nav.json';
import ptDetail    from './locales/pt/detail.json';
import ptErrors    from './locales/pt/errors.json';
import ptTypes     from './locales/pt/types.json';
import ptDashboard from './locales/pt/dashboard.json';

import svCommon    from './locales/sv/common.json';
import svNav       from './locales/sv/nav.json';
import svDetail    from './locales/sv/detail.json';
import svErrors    from './locales/sv/errors.json';
import svTypes     from './locales/sv/types.json';
import svDashboard from './locales/sv/dashboard.json';

import jaCommon    from './locales/ja/common.json';
import jaNav       from './locales/ja/nav.json';
import jaDetail    from './locales/ja/detail.json';
import jaErrors    from './locales/ja/errors.json';
import jaTypes     from './locales/ja/types.json';
import jaDashboard from './locales/ja/dashboard.json';

import koCommon    from './locales/ko/common.json';
import koNav       from './locales/ko/nav.json';
import koDetail    from './locales/ko/detail.json';
import koErrors    from './locales/ko/errors.json';
import koTypes     from './locales/ko/types.json';
import koDashboard from './locales/ko/dashboard.json';

import zhHansCommon    from './locales/zh-Hans/common.json';
import zhHansNav       from './locales/zh-Hans/nav.json';
import zhHansDetail    from './locales/zh-Hans/detail.json';
import zhHansErrors    from './locales/zh-Hans/errors.json';
import zhHansTypes     from './locales/zh-Hans/types.json';
import zhHansDashboard from './locales/zh-Hans/dashboard.json';

// Explorer namespace for the remaining languages (de/en imported above).
import esExplorer     from './locales/es/explorer.json';
import frExplorer     from './locales/fr/explorer.json';
import itExplorer     from './locales/it/explorer.json';
import nlExplorer     from './locales/nl/explorer.json';
import ptExplorer     from './locales/pt/explorer.json';
import svExplorer     from './locales/sv/explorer.json';
import jaExplorer     from './locales/ja/explorer.json';
import koExplorer     from './locales/ko/explorer.json';
import zhHansExplorer from './locales/zh-Hans/explorer.json';

// Atlas namespace for the remaining languages (de/en imported above).
import esAtlas     from './locales/es/atlas.json';
import frAtlas     from './locales/fr/atlas.json';
import itAtlas     from './locales/it/atlas.json';
import nlAtlas     from './locales/nl/atlas.json';
import ptAtlas     from './locales/pt/atlas.json';
import svAtlas     from './locales/sv/atlas.json';
import jaAtlas     from './locales/ja/atlas.json';
import koAtlas     from './locales/ko/atlas.json';
import zhHansAtlas from './locales/zh-Hans/atlas.json';

// Cluster namespace (/cluster-Ansicht) for all languages.
import enCluster     from './locales/en/cluster.json';
import deCluster     from './locales/de/cluster.json';
import esCluster     from './locales/es/cluster.json';
import frCluster     from './locales/fr/cluster.json';
import itCluster     from './locales/it/cluster.json';
import nlCluster     from './locales/nl/cluster.json';
import ptCluster     from './locales/pt/cluster.json';
import svCluster     from './locales/sv/cluster.json';
import jaCluster     from './locales/ja/cluster.json';
import koCluster     from './locales/ko/cluster.json';
import zhHansCluster from './locales/zh-Hans/cluster.json';

// fm-spec Schema-Viewer namespace (/fm-spec) for all languages.
import enFmSpec     from './locales/en/fmSpec.json';
import deFmSpec     from './locales/de/fmSpec.json';
import esFmSpec     from './locales/es/fmSpec.json';
import frFmSpec     from './locales/fr/fmSpec.json';
import itFmSpec     from './locales/it/fmSpec.json';
import nlFmSpec     from './locales/nl/fmSpec.json';
import ptFmSpec     from './locales/pt/fmSpec.json';
import svFmSpec     from './locales/sv/fmSpec.json';
import jaFmSpec     from './locales/ja/fmSpec.json';
import koFmSpec     from './locales/ko/fmSpec.json';
import zhHansFmSpec from './locales/zh-Hans/fmSpec.json';

export const LANGUAGE_STORAGE_KEY = 'fmlab.lang';

export const I18N_NAMESPACES = ['common', 'nav', 'detail', 'errors', 'types', 'dashboard', 'explorer', 'atlas', 'cluster', 'fmSpec'] as const;

const resources = {
  en: {
    common:    enCommon,
    nav:       enNav,
    detail:    enDetail,
    errors:    enErrors,
    types:     enTypes,
    dashboard: enDashboard,
    explorer:  enExplorer,
    atlas:     enAtlas,
    cluster:     enCluster,
    fmSpec:      enFmSpec,
  },
  de: {
    common:    deCommon,
    nav:       deNav,
    detail:    deDetail,
    errors:    deErrors,
    types:     deTypes,
    dashboard: deDashboard,
    explorer:  deExplorer,
    atlas:     deAtlas,
    cluster:     deCluster,
    fmSpec:      deFmSpec,
  },
  es: {
    common:    esCommon,
    nav:       esNav,
    detail:    esDetail,
    errors:    esErrors,
    types:     esTypes,
    dashboard: esDashboard,
    atlas:     esAtlas,
    cluster:     esCluster,
    fmSpec:      esFmSpec,
    explorer:  esExplorer,
  },
  fr: {
    common:    frCommon,
    nav:       frNav,
    detail:    frDetail,
    errors:    frErrors,
    types:     frTypes,
    dashboard: frDashboard,
    atlas:     frAtlas,
    cluster:     frCluster,
    fmSpec:      frFmSpec,
    explorer:  frExplorer,
  },
  it: {
    common:    itCommon,
    nav:       itNav,
    detail:    itDetail,
    errors:    itErrors,
    types:     itTypes,
    dashboard: itDashboard,
    atlas:     itAtlas,
    cluster:     itCluster,
    fmSpec:      itFmSpec,
    explorer:  itExplorer,
  },
  nl: {
    common:    nlCommon,
    nav:       nlNav,
    detail:    nlDetail,
    errors:    nlErrors,
    types:     nlTypes,
    dashboard: nlDashboard,
    atlas:     nlAtlas,
    cluster:     nlCluster,
    fmSpec:      nlFmSpec,
    explorer:  nlExplorer,
  },
  pt: {
    common:    ptCommon,
    nav:       ptNav,
    detail:    ptDetail,
    errors:    ptErrors,
    types:     ptTypes,
    dashboard: ptDashboard,
    atlas:     ptAtlas,
    cluster:     ptCluster,
    fmSpec:      ptFmSpec,
    explorer:  ptExplorer,
  },
  sv: {
    common:    svCommon,
    nav:       svNav,
    detail:    svDetail,
    errors:    svErrors,
    types:     svTypes,
    dashboard: svDashboard,
    atlas:     svAtlas,
    cluster:     svCluster,
    fmSpec:      svFmSpec,
    explorer:  svExplorer,
  },
  ja: {
    common:    jaCommon,
    nav:       jaNav,
    detail:    jaDetail,
    errors:    jaErrors,
    types:     jaTypes,
    dashboard: jaDashboard,
    atlas:     jaAtlas,
    cluster:     jaCluster,
    fmSpec:      jaFmSpec,
    explorer:  jaExplorer,
  },
  ko: {
    common:    koCommon,
    nav:       koNav,
    detail:    koDetail,
    errors:    koErrors,
    types:     koTypes,
    dashboard: koDashboard,
    atlas:     koAtlas,
    cluster:     koCluster,
    fmSpec:      koFmSpec,
    explorer:  koExplorer,
  },
  'zh-Hans': {
    common:    zhHansCommon,
    nav:       zhHansNav,
    detail:    zhHansDetail,
    errors:    zhHansErrors,
    types:     zhHansTypes,
    dashboard: zhHansDashboard,
    atlas:     zhHansAtlas,
    cluster:     zhHansCluster,
    fmSpec:      zhHansFmSpec,
    explorer:  zhHansExplorer,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGE_CODES as string[],
    nonExplicitSupportedLngs: true,
    ns: I18N_NAMESPACES as unknown as string[],
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order:  ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    returnNull: false,
  });

/**
 * Apply a server-supplied default language only when the user has not yet
 * picked one explicitly (no localStorage entry). Lets local installs ship
 * their own default (e.g. `de`) without overriding a manual selection.
 */
export function applyServerLanguage(serverDefault: string | null | undefined): void {
  if (!serverDefault) return;
  if (typeof window === 'undefined') return;
  const userPick = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (userPick) return;
  const resolved = resolveLanguage(serverDefault);
  if (resolved !== i18n.language) {
    void i18n.changeLanguage(resolved);
  }
}

export default i18n;
