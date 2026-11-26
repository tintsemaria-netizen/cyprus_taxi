'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT, Locale, isLocale } from './config';
import { setLocaleCookie, useLocale, useT } from './I18nProvider';

// compact: options show only the short code (EN / ΕΛ / РУ) — for tight mobile headers.
// only: limit the manual choice to a few languages (RU / EL / EN, 2026-11-17). Also listed: the current
// language (so the selector never shows a wrong value) and the phone's/browser's own language when
// we support it (e.g. a German phone also gets «DE · Deutsch»).
// round (2026-11-26, account menu): a round button with the short code (РУ / ΕΛ / EN); tapping opens the phone's own picker.
export function LanguageSwitcher({ className = '', compact = false, only, round = false }: { className?: string; compact?: boolean; only?: readonly Locale[]; round?: boolean }) {
  const locale = useLocale();
  const [device, setDevice] = useState<Locale | null>(null);
  useEffect(() => {
    const langs = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
    const hit = langs.map((l) => (l || '').toLowerCase().split('-')[0]).find((l) => isLocale(l));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hit && isLocale(hit)) setDevice(hit);
  }, []);
  const list = only ? LOCALES.filter((l) => only.includes(l) || l === locale || l === device) : LOCALES;
  const { t } = useT();
  const router = useRouter();
  const onChange = (v: string) => { setLocaleCookie(v as Locale); router.refresh(); };
  if (round) {
    return (
      <label className={`relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-edge-strong bg-page text-xs font-bold text-ink ${className}`} data-testid="lang-round">
        <span aria-hidden>{LOCALE_SHORT[locale]}</span>
        <select value={locale} onChange={(e) => onChange(e.target.value)} aria-label={t('common.language')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {list.map((l) => <option key={l} value={l} lang={l}>{`${LOCALE_SHORT[l]} · ${LOCALE_NAMES[l]}`}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className={`inline-flex items-center ${className}`}>
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[36px] rounded-[10px] border border-edge-strong bg-elevated px-2 py-1 text-sm text-ink"
        aria-label={t('common.language')}
      >
        {list.map((l) => <option key={l} value={l} lang={l}>{compact ? LOCALE_SHORT[l] : `${LOCALE_SHORT[l]} · ${LOCALE_NAMES[l]}`}</option>)}
      </select>
    </label>
  );
}
