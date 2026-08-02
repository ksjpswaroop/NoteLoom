import {getRequestConfig} from 'next-intl/server';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  loadMessagesWithFallback,
} from './config';

export const locales = SUPPORTED_LOCALES;
export const defaultLocale = DEFAULT_LOCALE;

export default getRequestConfig(async () => {
  return {
    locale: DEFAULT_LOCALE,
    messages: await loadMessagesWithFallback(DEFAULT_LOCALE)
  };
});
