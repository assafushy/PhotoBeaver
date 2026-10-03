import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

/**
 * Initializes i18next with the bundled English strings (SPEC 10).
 *
 * @returns The configured i18next instance.
 */
export function initI18n(): typeof i18next {
  void i18next.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return i18next;
}
