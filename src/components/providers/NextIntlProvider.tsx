'use client';

import { NextIntlClientProvider } from 'next-intl';
import type { AbstractIntlMessages } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LANGUAGE_STORAGE_KEY,
  loadMessagesWithFallback,
} from '@/i18n/config';

export function NextIntlProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<AbstractIntlMessages | null>(null);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, DEFAULT_LOCALE);

    loadMessagesWithFallback(DEFAULT_LOCALE).then((loadedMessages) => {
      setMessages(loadedMessages);
    }).catch((error) => {
      console.error('Failed to load English messages', error);
    });
  }, []);

  if (!messages) {
    return null;
  }

  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
