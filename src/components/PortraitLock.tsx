'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@/i18n/I18nProvider';

// Passenger and driver apps are portrait-only. The manifests declare "orientation": "portrait"
// (honoured by installed apps on Android). Where the browser lets us, we also ask for a portrait
// lock; everywhere else (iPhone Safari, browser tabs) a phone turned sideways shows a cover asking
// to rotate back. Staff pages (dispatch/admin) are excluded — they are used on wide screens.
const STAFF = /^\/(dispatch|admin|staff)(\/|$)/;

export function PortraitLock() {
  const pathname = usePathname() || '/';
  const { t } = useT();
  const staff = STAFF.test(pathname);

  useEffect(() => {
    if (staff) return;
    const o = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
    // Only succeeds in installed/full-screen contexts on supporting browsers; failures are expected.
    o?.lock?.('portrait').catch(() => {});
  }, [staff]);

  if (staff) return null;
  return (
    <div className="portrait-lock fixed inset-0 z-[9999] flex-col items-center justify-center gap-3 bg-page px-6 text-center" role="alert">
      <svg viewBox="0 0 24 24" className="h-12 w-12 text-accent" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
        <rect x="7" y="2.5" width="10" height="19" rx="2" />
        <path d="M11 18.5h2" strokeLinecap="round" />
        <path d="M3 9a8 8 0 0 1 3-5.5M3 9V5.5M3 9h3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-base font-semibold text-ink">{t('common.rotate.title')}</p>
      <p className="max-w-xs text-sm text-muted">{t('common.rotate.body')}</p>
    </div>
  );
}
