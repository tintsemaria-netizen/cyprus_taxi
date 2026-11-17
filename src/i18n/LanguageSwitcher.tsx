'use client';

import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT, Locale } from './config';
import { setLocaleCookie, useLocale, useT } from './I18nProvider';

// compact: options show only the short code (EN / ΕΛ / РУ) — for tight mobile headers.
// only: limit the manual choice (driver profile: RU / EL / EN). The current language stays listed
// even when it is not in the list, so the selector never shows a wrong value.
export function LanguageSwitcher({ className = '', compact = false, only }: { className?: string; compact?: boolean; only?: readonly Locale[] }) {
  const locale = useLocale();
  const list = only ? LOCALES.filter((l) => only.includes(l) || l === locale) : LOCALES;
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
