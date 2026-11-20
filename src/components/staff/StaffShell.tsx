'use client';

import { BackArrow } from '@/components/BackArrow';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export interface Me {
  id: string;
  role: 'ADMIN' | 'DISPATCHER' | 'DRIVER';
  displayName: string;
  driverId: string | null;
  mfa?: { eligible: boolean; enabled: boolean; setupRequired: boolean };
}

export function StaffShell({ roles, children }: { roles: Me['role'][]; children: (me: Me) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');
  // (hooks before any early return) The driver page tells us when it shows a sub-screen that needs a back arrow.
  const [driverBack, setDriverBack] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setDriverBack(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener('il-y:driver-back-visible', on);
    return () => window.removeEventListener('il-y:driver-back-visible', on);
  }, []);


  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => {
        if (!roles.includes(m.role)) {
          setState('denied');
          if (m.role === 'DRIVER') router.replace('/driver');
          else router.replace('/dispatch');
          return;
        }
        // Enforced 2FA: a privileged account without TOTP can only open the security page.
        if (m.mfa?.setupRequired && pathname !== '/staff/security') { router.replace('/staff/security'); return; }
        setMe(m);
        setState('ok');
      })
      .catch(() => router.replace('/staff/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/staff/login');
  }

  if (state !== 'ok' || !me) {
    return <div className="flex h-[100dvh] items-center justify-center text-muted">{t('staff.loading')}</div>;
  }

  const nav =
    me.role === 'DRIVER'
      ? [{ href: '/driver', label: t('common.myTrip') }]
      : [
          { href: '/dispatch', label: t('staff.nav.dispatch') },
          ...(me.role === 'ADMIN'
            ? [
                { href: '/admin/analytics', label: t('staff.nav.analytics') },
                { href: '/admin/reliability', label: t('staff.nav.reliability') },
                { href: '/admin/applications', label: t('staff.nav.applications') },
                { href: '/admin/passengers', label: t('staff.nav.passengers') },
                { href: '/admin/drivers', label: t('staff.nav.drivers') },
                { href: '/admin/vehicles', label: t('staff.nav.vehicles') },
                { href: '/admin/fixed-prices', label: t('staff.nav.fixedPrices') },
                { href: '/admin/settings', label: t('staff.nav.settings') },
              ]
            : []),
          { href: '/staff/security', label: t('staff.nav.security') },
        ];

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-edge bg-page px-4 py-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)' }}>
        <div className="flex min-w-0 items-center gap-4">
          {/* Driver sub-screens (pre-bookings, free orders, 2026-11-19): ‹ back to the map, left of the logo. */}
          {me.role === 'DRIVER' && driverBack && <BackArrow className="-ms-2 -me-3" onBack={() => window.dispatchEvent(new Event('il-y:driver-back'))} />}
          <a href="/dispatch" className="shrink-0"><Logo className="h-6" /></a>
          <nav className="hidden items-center gap-1 xl:flex">
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-sm ${pathname === n.href ? 'bg-elevated text-accent' : 'text-muted hover:text-ink'}`}
              >
                {n.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted 2xl:inline">{me.displayName} · {t(`staff.role.${me.role}`)}</span>
          {/* Drivers (2026-11-17): language and sign-out live in their Profile, not in this bar. */}
          {me.role !== 'DRIVER' && <LanguageSwitcher compact />}
          {me.role !== 'DRIVER' && <button onClick={logout} className="btn-ghost !min-h-0 !py-1.5 text-sm">{t('common.signOut')}</button>}
          {/* Drivers (2026-11-18): ☰ in the top-right corner opens the side menu (profile, trips, earnings). */}
          {me.role === 'DRIVER' && (
            <button type="button" data-testid="driver-menu-btn" aria-label={t('driver.navigation.menu')}
              onClick={() => window.dispatchEvent(new Event('il-y:driver-menu'))}
              className="-me-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-white/5">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          )}
        </div>
      </header>
      {/* mobile nav */}
      {nav.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-edge bg-page px-3 py-1.5 xl:hidden">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className={`whitespace-nowrap rounded-[10px] px-3 py-1.5 text-sm ${pathname === n.href ? 'bg-elevated text-accent' : 'text-muted'}`}>
              {n.label}
            </a>
          ))}
        </nav>
      )}
      <main className="flex-1">{children(me)}</main>
    </div>
  );
}
