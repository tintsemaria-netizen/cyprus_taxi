'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { DEFAULT_LOCALE, INTL_TAG, LOCALE_COOKIE, Locale } from './config';
import { MESSAGES, Messages } from './messages';
import type { Path, PluralPath, PluralForms } from './types';

type Vars = Record<string, string | number>;
const TZ = 'Europe/Nicosia';
export type MsgKey = Path<Messages>;
export type PluralKey = PluralPath<Messages>;

const Ctx = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

function lookup(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

// Pure translator (usable outside React, e.g. in helpers given a locale).
export function translate(locale: Locale, key: string, vars?: Vars): string {
  const v = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES.en, key);
  return typeof v === 'string' ? fill(v, vars) : key;
}
export function translatePlural(locale: Locale, key: string, count: number, vars?: Vars): string {
  const forms = (lookup(MESSAGES[locale], key) ?? lookup(MESSAGES.en, key)) as PluralForms | undefined;
  if (!forms || typeof forms !== 'object') return key;
  const cat = new Intl.PluralRules(INTL_TAG[locale]).select(count) as keyof PluralForms;
  return fill(forms[cat] ?? forms.other, { count, ...vars });
}

export function useLocale(): Locale {
  return useContext(Ctx);
}

export function useT() {
  const locale = useLocale();
  const t = useCallback((key: MsgKey, vars?: Vars) => translate(locale, key, vars), [locale]);
  const tp = useCallback((key: PluralKey, count: number, vars?: Vars) => translatePlural(locale, key, count, vars), [locale]);
  const fmt = useMemo(() => ({
    // Always Cyprus time: pickups happen in Cyprus, whatever timezone the visitor's phone is set to.
    dateTime: (d: string | Date) => new Date(d).toLocaleString(INTL_TAG[locale], { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }),
    time: (d: string | Date) => new Date(d).toLocaleTimeString(INTL_TAG[locale], { hour: '2-digit', minute: '2-digit', timeZone: TZ }),
    date: (d: string | Date) => new Date(d).toLocaleDateString(INTL_TAG[locale], { dateStyle: 'medium', timeZone: TZ }),
    money: (cents: number, currency = 'EUR') => new Intl.NumberFormat(INTL_TAG[locale], { style: 'currency', currency }).format(cents / 100),
  }), [locale]);
  // Localized message for a failed API call: a translated error code when we have one, otherwise
  // the server's (English) message, otherwise a generic network message.
  const tError = useCallback((e: unknown) => {
    if (e instanceof ApiRequestError) {
      const v = lookup(MESSAGES[locale], `errors.${e.body.code}`);
      return typeof v === 'string' ? v : e.body.message || translate(locale, 'common.somethingWrong');
    }
    return translate(locale, 'common.networkError');
  }, [locale]);
  return { t, tp, fmt, tError, locale };
}

// Persist the choice (1 year) and reload so server-rendered parts pick it up too.
export function setLocaleCookie(l: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
}
