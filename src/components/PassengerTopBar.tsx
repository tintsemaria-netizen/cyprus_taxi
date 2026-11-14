'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Brand';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { useT } from '@/i18n/I18nProvider';
import { api } from '@/lib/api-client';
import { AccountMenu, type PassengerInfo } from '@/components/booking/AccountMenu';
import { recordVisit, goBack as trailBack } from '@/lib/navTrail';

// Shared top bar for every passenger page except the home booking screen (2026-11-14):
// a back arrow, the logo (→ home), the language switcher and the account avatar (initial),
// or a "Log in" link when signed out. Always present, so the user can never get stuck.
export function PassengerTopBar({ back = '/', sticky = true }: { back?: string | false; sticky?: boolean }) {
  const { t } = useT();
  const [passenger, setPassenger] = useState<PassengerInfo | null | undefined>(undefined);
  useEffect(() => {
    api<PassengerInfo>('/passenger/me').then(setPassenger).catch(() => setPassenger(null));
    recordVisit();
    const onShow = () => recordVisit();
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  function goBack(e: React.MouseEvent) {
    // Exactly one step back inside the app (see src/lib/navTrail.ts).
    e.preventDefault();
    trailBack(typeof back === 'string' ? back : '/');
  }

  return (
    <header className={`${sticky ? 'sticky top-0' : ''} z-30 flex items-center justify-between gap-2 border-b border-edge bg-page/90 px-3 py-2 backdrop-blur sm:px-6`}>
      <div className="flex min-w-0 items-center gap-1">
        {back !== false && (
          <a
            href={back}
            onClick={goBack}
            aria-label={t('common.back')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl text-ink hover:bg-elevated"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </a>
        )}
        <a href="/" aria-label="IL-Y" className="shrink-0"><Logo className="h-9" /></a>
      </div>
      <div className="flex items-center gap-2">
        <LanguageSwitcher compact />
        {passenger ? (
          <AccountMenu passenger={passenger} onLoggedOut={() => { setPassenger(null); window.location.href = '/'; }} />
        ) : passenger === null ? (
          <a href="/login" className="btn-ghost !min-h-0 !py-1.5 text-base">{t('booking.nav.login')}</a>
        ) : (
          <span className="h-9 w-9" aria-hidden="true" />
        )}
      </div>
    </header>
  );
}
