'use client';

import { useEffect } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { recordVisit, goBack } from '@/lib/navTrail';

// The one back arrow (2026-11-17): exactly one step back. With `onBack` it steps back inside
// the screen (e.g. review → form, code → phone); otherwise one page back in the app's own trail,
// or to `fallback` when this page was opened directly. Pages that use it record themselves in
// the trail so the next page's arrow can come back here.
export function BackArrow({ onBack, fallback = '/', className = '' }: { onBack?: () => void; fallback?: string; className?: string }) {
  const { t } = useT();
  useEffect(() => {
    if (onBack) return;
    recordVisit();
    const onShow = () => recordVisit();
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [onBack]);
  return (
    <a
      href={fallback}
      onClick={(e) => { e.preventDefault(); if (onBack) onBack(); else goBack(fallback); }}
      aria-label={t('common.back')}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-elevated ${className}`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100"><path d="M15 5l-7 7 7 7" /></svg>
    </a>
  );
}
