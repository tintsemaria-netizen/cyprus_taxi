import { describe, it, expect } from 'vitest';
import { resolveLocale, LOCALES } from '@/i18n/config';
import { translate, translatePlural } from '@/i18n/I18nProvider';
import { MESSAGES } from '@/i18n/messages';

describe('locale resolution', () => {
  it('explicit cookie wins, then the best Accept-Language match, then English', () => {
    expect(resolveLocale('ru', 'el-GR,el;q=0.9')).toBe('ru');
    expect(resolveLocale(undefined, 'el-GR,el;q=0.9,en;q=0.8')).toBe('el');
    expect(resolveLocale(undefined, 'de-DE,ru;q=0.7,en;q=0.5')).toBe('de');
    expect(resolveLocale(undefined, 'it-IT,ru;q=0.7,en;q=0.5')).toBe('ru');
    expect(resolveLocale(undefined, 'he-IL,he;q=0.9')).toBe('he');
    expect(resolveLocale(undefined, 'ar-SA')).toBe('ar');
    expect(resolveLocale(undefined, 'pl-PL')).toBe('pl');
    expect(resolveLocale(undefined, 'fr-FR')).toBe('fr');
    expect(resolveLocale('xx', 'it-IT')).toBe('en');
    expect(resolveLocale(null, null)).toBe('en');
  });
});

describe('translation', () => {
  it('falls back to English, then to the key', () => {
    expect(translate('el', 'common.book')).toBe('Κράτηση');
    expect(translate('ru', 'nope.missing')).toBe('nope.missing');
  });
  it('uses Russian plural categories (one / few / many)', () => {
    expect(translatePlural('ru', 'common.passengers', 1)).toBe('1 пассажир');
    expect(translatePlural('ru', 'common.passengers', 3)).toBe('3 пассажира');
    expect(translatePlural('ru', 'common.passengers', 5)).toBe('5 пассажиров');
    expect(translatePlural('ru', 'common.passengers', 21)).toBe('21 пассажир');
    expect(translatePlural('en', 'common.passengers', 2)).toBe('2 passengers');
    expect(translatePlural('el', 'common.passengers', 1)).toBe('1 επιβάτης');
    expect(translatePlural('pl', 'driver.earnings.trips', 3)).toBe('3 przejazdy');
    expect(translatePlural('pl', 'driver.earnings.trips', 5)).toBe('5 przejazdów');
    expect(translatePlural('de', 'driver.earnings.trips', 1)).toBe('1 Fahrt');
  });
  it('every catalog has the same keys as English (no silent English fallbacks)', () => {
    const keys = (o: unknown, p = ''): string[] => Object.entries(o as object).flatMap(([k, v]) =>
      typeof v === 'string' ? [p + k] : 'other' in (v as object) ? [p + k] : keys(v, `${p}${k}.`));
    const en = keys(MESSAGES.en).sort();
    for (const l of LOCALES) expect(keys(MESSAGES[l]).sort(), l).toEqual(en);
  });
  it('placeholders survive translation', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join();
    const walk = (a: unknown, b: unknown, p = ''): string[] => Object.entries(a as object).flatMap(([k, v]) => {
      const w = (b as Record<string, unknown>)[k];
      if (typeof v === 'string') return ph(v) === ph(String(w)) ? [] : [`${p}${k}`];
      if ('other' in (v as object)) return Object.values(w as object).every((f) => ph(String(f)) === ph((v as { other: string }).other)) ? [] : [`${p}${k}`];
      return walk(v, w, `${p}${k}.`);
    });
    for (const l of LOCALES) expect(walk(MESSAGES.en, MESSAGES[l]), l).toEqual([]);
  });
});
