// Supported UI languages (2026-10-01 audit, Stage 1.18). Cyprus: Greek, English, Russian.
export const LOCALES = ['en', 'el', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'lang';
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', el: 'Ελληνικά', ru: 'Русский' };
export const LOCALE_SHORT: Record<Locale, string> = { en: 'EN', el: 'ΕΛ', ru: 'РУ' };
// BCP-47 tags for Intl date/number formatting.
export const INTL_TAG: Record<Locale, string> = { en: 'en-GB', el: 'el-GR', ru: 'ru-RU' };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

// Explicit choice (cookie) wins; otherwise the best Accept-Language match; otherwise English.
export function resolveLocale(cookieValue: string | undefined | null, acceptLanguage: string | undefined | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  const prefs = (acceptLanguage || '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { lang: tag.split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((p) => p.lang)
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) if (isLocale(p.lang)) return p.lang;
  return DEFAULT_LOCALE;
}
