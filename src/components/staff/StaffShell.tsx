'use client';

import { BackArrow } from '@/components/BackArrow';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export interface Me {
  /** The business owner — superadmin: «Бухгалтерия», «Сотрудники», «Изменения» (2026-11-23). */
  isOwner?: boolean;
  unreadChanges?: number;
  id: string;
  role: 'ADMIN' | 'DISPATCHER' | 'DRIVER' | 'FLEET_OWNER';
  displayName: string;
  driverId: string | null;
  fleet?: { id: string; name: string } | null; // a fleet this user owns (FLEET_OWNER, or a driver who owns one)
  mfa?: { eligible: boolean; enabled: boolean; setupRequired: boolean };
}

/** «Не ваши изменения» with something new: a red item (2026-11-23, operator — no sound, just red). */
const ALERT = 'bg-danger font-semibold text-white';
/** The change log page tells the menu it has been read. */
export const CHANGES_SEEN = 'il-y:changes-seen';
interface ChangeLast { id: string; actor: string; method: string; area: string }

export function StaffShell({ roles, children }: { roles: Me['role'][]; children: (me: Me) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();
  const [me, setMe] = useState<Me | null>(null);
  // «Не ваши изменения» for the superadmin (2026-11-23, operator): checked every 10 s and when the app
  // comes back. A new change pops up a silent banner; the item stays red until each change is checked.
  const [unread, setUnread] = useState(0);
  const [popup, setPopup] = useState<ChangeLast | null>(null);
  const isOwner = !!me?.isOwner;
  useEffect(() => { setUnread(me?.unreadChanges ?? 0); }, [me?.unreadChanges]);
  useEffect(() => {
    if (!isOwner) return;
    let lastId: string | null | undefined; // undefined = first check: no pop-up for what was already there
    const check = () => {
      void api<{ unread: number; last: ChangeLast | null }>('/admin/changes/count').then((r) => {
        setUnread(r.unread);
        if (lastId !== undefined && r.last && r.last.id !== lastId && window.location.pathname !== '/admin/changes') setPopup(r.last);
        lastId = r.last?.id ?? null;
      }).catch(() => {});
    };
    check();
    const id = window.setInterval(check, 10_000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    const onSeen = (e: Event) => { setUnread((e as CustomEvent<number>).detail ?? 0); setPopup(null); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(CHANGES_SEEN, onSeen);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener(CHANGES_SEEN, onSeen); };
  }, [isOwner]);
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
          else if (m.role === 'FLEET_OWNER') router.replace('/fleet');
          else router.replace('/dispatch');
          return;
        }
        // Enforced 2FA: a privileged account without TOTP can only open the security page.
        if (m.mfa?.setupRequired && pathname !== '/staff/security') { router.replace('/staff/security'); return; }
        setMe(m);
        setState('ok');
      })
      .catch(() => router.replace(roles.length === 1 && roles[0] === 'DRIVER' ? '/driver/login' : '/staff/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace(me?.role === 'DRIVER' ? '/driver/login' : '/staff/login');
  }

  if (state !== 'ok' || !me) {
    return <div className="flex h-[100dvh] items-center justify-center text-muted">{t('staff.loading')}</div>;
  }

  const nav =
    me.role === 'DRIVER'
      ? [{ href: '/driver', label: t('common.myTrip') }, ...(me.fleet ? [{ href: '/fleet', label: t('staff.nav.myFleet') }] : [])]
      : me.role === 'FLEET_OWNER'
      ? [{ href: '/fleet', label: t('staff.nav.myFleet') }, { href: '/staff/security', label: t('staff.nav.security') }]
      : [
          { href: '/dispatch', label: t('staff.nav.dispatch') },
          ...(me.role === 'ADMIN'
            ? [
                // Superadmin first: the menu scrolls on narrow screens (2026-11-23).
                ...(me.isOwner ? [
                  { href: '/admin/changes', label: `${t('staff.nav.changes')}${unread ? ` (${unread})` : ''}`, alert: unread > 0 },
                  { href: '/admin/accounting', label: t('staff.nav.accounting') },
                  { href: '/admin/staff', label: t('staff.nav.staff') },
                ] : []),
                { href: '/admin/analytics', label: t('staff.nav.analytics') },
                { href: '/admin/reliability', label: t('staff.nav.reliability') },
                { href: '/admin/applications', label: t('staff.nav.applications') },
                { href: '/admin/passengers', label: t('staff.nav.passengers') },
                { href: '/admin/drivers', label: t('staff.nav.drivers') },
                { href: '/admin/fleets', label: t('staff.nav.fleets') },
                { href: '/admin/vehicles', label: t('staff.nav.vehicles') },
                { href: '/admin/fixed-prices', label: t('staff.nav.fixedPrices') },
                { href: '/admin/min-fares', label: t('staff.nav.minFares') },
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
          <nav className="hidden min-w-0 items-center gap-1 overflow-x-auto xl:flex">
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-sm ${'alert' in n && n.alert ? ALERT : pathname === n.href ? 'bg-elevated text-accent' : 'text-muted hover:text-ink'}`}
                data-testid={'alert' in n && n.alert ? 'nav-alert' : undefined}
              >
                {'alert' in n && n.alert && <span className="me-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-white align-middle" />}{n.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted 2xl:inline">{me.displayName} · {me.isOwner ? t('staff.role.OWNER') : t(`staff.role.${me.role}`)}</span>
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
            <a key={n.href} href={n.href} className={`whitespace-nowrap rounded-[10px] px-3 py-1.5 text-sm ${'alert' in n && n.alert ? ALERT : pathname === n.href ? 'bg-elevated text-accent' : 'text-muted'}`}
              data-testid={'alert' in n && n.alert ? 'nav-alert' : undefined}>
              {'alert' in n && n.alert && <span className="me-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-white align-middle" />}{n.label}
            </a>
          ))}
        </nav>
      )}
      {popup && (
        <div className="fixed inset-x-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-danger bg-elevated p-3 text-sm shadow-xl" style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }} data-testid="change-popup" role="status">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
          <a href="/admin/changes" className="min-w-0 flex-1">
            <span className="block text-xs text-muted">{t('staff.changes.popup')}</span>
            <span className="font-semibold">{popup.actor}</span> {t(`staff.changes.verb.${popup.method}` as 'staff.changes.verb.POST')} · {t(`staff.changes.area.${popup.area}` as 'staff.changes.area.misc')}
          </a>
          <button type="button" aria-label="✕" onClick={() => setPopup(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/5">✕</button>
        </div>
      )}
      <main className="flex-1">{children(me)}</main>
    </div>
  );
}
