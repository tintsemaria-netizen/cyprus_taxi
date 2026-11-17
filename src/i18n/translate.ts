// Pure translator without React (server code: e-mails, push texts). Same rules as the client
// translate(): the locale's string, else English, else the key itself.
import { INTL_TAG, Locale, isLocale, DEFAULT_LOCALE } from './config';
import { MESSAGES } from './messages';
import type { PluralForms } from './types';

type Vars = Record<string, string | number>;

function lookup(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

export function asLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}
export function tr(locale: Locale, key: string, vars?: Vars): string {
  const v = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES.en, key);
  return typeof v === 'string' ? fill(v, vars) : key;
}
export function trPlural(locale: Locale, key: string, count: number, vars?: Vars): string {
  const forms = (lookup(MESSAGES[locale], key) ?? lookup(MESSAGES.en, key)) as PluralForms | undefined;
  if (!forms || typeof forms !== 'object') return key;
  const cat = new Intl.PluralRules(INTL_TAG[locale]).select(count) as keyof PluralForms;
  return fill(forms[cat] ?? forms.other, { count, ...vars });
}
