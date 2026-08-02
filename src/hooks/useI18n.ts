import { useEffect, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LANGUAGE_STORAGE_KEY,
  type SupportedLocale,
} from '@/i18n/config';

export function useI18n() {
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, DEFAULT_LOCALE);
    setCurrentLocale(DEFAULT_LOCALE);
  }, []);

  const changeLanguage = (_unusedLocale: string) => {
    void _unusedLocale;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, DEFAULT_LOCALE);
    setCurrentLocale(DEFAULT_LOCALE);
  };

  return {
    currentLocale,
    changeLanguage,
  };
}
