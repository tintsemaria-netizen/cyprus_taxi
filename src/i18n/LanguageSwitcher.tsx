'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT, Locale, isLocale } from './config';
import { setLocaleCookie, useLocale, useT } from './I18nProvider';

// compact: options show only the short code (EN / ΕΛ / РУ) — for tight mobile headers.
// only: limit the manual choice to a few languages (RU / EL / EN, 2026-11-17). Also listed: the current
// language (so the selector never shows a wrong value) and the phone's/browser's own language when
// we support it (e.g. a German phone also gets «DE · Deutsch»).
export function LanguageSwitcher({ className = '', compact = false, only }: { className?: string; compact?: boolean; only?: readonly Locale[] }) {
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
  return (
    <label className={`inline-flex items-center ${className}`}>
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={locale}
        onChange={(e) => { setLocaleCookie(e.target.value as Locale); router.refresh(); }}
        className="min-h-[36px] rounded-[10px] border border-edge-strong bg-elevated px-2 py-1 text-sm text-ink"
        aria-label={t('common.language')}
      >
        {list.map((l) => <option key={l} value={l} lang={l}>{compact ? LOCALE_SHORT[l] : `${LOCALE_SHORT[l]} · ${LOCALE_NAMES[l]}`}</option>)}
      </select>
    </label>
  );
}
