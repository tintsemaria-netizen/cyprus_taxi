'use client';

import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT, Locale } from './config';
import { setLocaleCookie, useLocale, useT } from './I18nProvider';

// compact: options show only the short code (EN / ΕΛ / РУ) — for tight mobile headers.
export function LanguageSwitcher({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const locale = useLocale();
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
        {LOCALES.map((l) => <option key={l} value={l} lang={l}>{compact ? LOCALE_SHORT[l] : `${LOCALE_SHORT[l]} · ${LOCALE_NAMES[l]}`}</option>)}
      </select>
    </label>
  );
}
