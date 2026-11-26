'use client';

import { BackArrow } from '@/components/BackArrow';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Brand';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { NotifyToggle } from '@/components/NotifyToggle';

export interface Me {
  /** The business owner — superadmin: «Бухгалтерия», «Сотрудники», «Изменения» (2026-11-23). */
  isOwner?: boolean;
  unreadChanges?: number;
  pendingApplications?: number;
  /** Driver documents (2026-11-24): rows to look at in «Водители» / «Машины»; uploads waiting for a check. */
  docAlerts?: DocAlerts | null;
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
/** An application page tells the menu to re-count waiting applications. */
export const APPS_CHANGED = 'il-y:apps-changed';
interface Tab { href: string; label: string; alert?: boolean }
export interface DocAlerts { drivers: number; vehicles: number; uploaded: number; uploadedSection: 'drivers' | 'vehicles' | null }
/** «Водители» / «Машины» tell the menu to re-count after a document was accepted. */
export const DOCS_CHANGED = 'il-y:docs-changed';
interface Group { key: string; label: string; tabs: Tab[]; alert?: boolean }
const isOn = (path: string, href: string) => path === href || path.startsWith(href + '/');
interface ChangeLast { id: string; actor: string; method: string; area: string }

const ZONE_TABS = ['/admin/fixed-prices', '/admin/min-fares', '/admin/no-go', '/admin/pickup-points', '/admin/stands'];

export function StaffShell({ roles, children }: { roles: Me['role'][]; children: (me: Me) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();
  const [me, setMe] = useState<Me | null>(null);
  // Red menu (2026-11-23, operator): «Заявки» while driver applications wait (every admin) and
  // «Не ваши изменения» until each change is checked (owner). Checked every 10 s and when the app comes
  // back; a new change also pops up a silent banner for the owner.
  const [unread, setUnread] = useState(0);
  const [pendingApps, setPendingApps] = useState(0);
  const [docA, setDocA] = useState<DocAlerts | null>(null);
  const [popup, setPopup] = useState<ChangeLast | null>(null);
  const isAdmin = me?.role === 'ADMIN';
  useEffect(() => { setUnread(me?.unreadChanges ?? 0); setPendingApps(me?.pendingApplications ?? 0); setDocA(me?.docAlerts ?? null); }, [me?.unreadChanges, me?.pendingApplications, me?.docAlerts]);
  useEffect(() => {
    if (!isAdmin) return;
    let lastId: string | null | undefined; // undefined = first check: no pop-up for what was already there
    const check = () => {
      void api<{ applications: number; changes: number; last: ChangeLast | null; docs?: DocAlerts | null }>('/admin/alerts').then((r) => {
        setUnread(r.changes);
        setPendingApps(r.applications);
        setDocA(r.docs ?? null);
        if (lastId !== undefined && r.last && r.last.id !== lastId && window.location.pathname !== '/admin/changes') setPopup(r.last);
        lastId = r.last?.id ?? null;
      }).catch(() => {});
    };
    check();
    const id = window.setInterval(check, 10_000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    const onSeen = (e: Event) => { setUnread((e as CustomEvent<number>).detail ?? 0); setPopup(null); };
    const onApps = () => check();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(CHANGES_SEEN, onSeen);
    window.addEventListener(APPS_CHANGED, onApps);
    window.addEventListener(DOCS_CHANGED, onApps);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener(CHANGES_SEEN, onSeen); window.removeEventListener(APPS_CHANGED, onApps); window.removeEventListener(DOCS_CHANGED, onApps); };
  }, [isAdmin]);
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

  // Narrow screens: the open section and tab are scrolled into view in their menu rows.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (state !== 'ok') return;
    document.querySelectorAll<HTMLElement>('nav [data-current]').forEach((el) => {
      const row = el.parentElement;
      if (row && row.scrollWidth > row.clientWidth) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
    });
  }, [state, pathname]);

  if (state !== 'ok' || !me) {
    return <div className="flex h-[100dvh] items-center justify-center text-muted">{t('staff.loading')}</div>;
  }

  // Menu groups (2026-11-23, operator): related pages are one section with tabs inside. Page addresses
  // are unchanged. A group with something waiting is red, and so is the tab inside it.
  const drvDocs = docA?.drivers ?? 0;
  const carDocs = docA?.vehicles ?? 0;
  const one = (href: string, label: string): Group => ({ key: href, label, tabs: [{ href, label }] });
  const groups: Group[] =
    me.role === 'DRIVER'
      ? [one('/driver', t('common.myTrip')), ...(me.fleet ? [one('/fleet', t('staff.nav.myFleet'))] : [])]
      : me.role === 'FLEET_OWNER'
      ? [one('/fleet', t('staff.nav.myFleet')), one('/staff/security', t('staff.nav.security'))]
      : me.role !== 'ADMIN'
      ? [one('/dispatch', t('staff.nav.dispatch')), one('/staff/security', t('staff.nav.security'))]
      : [
          one('/dispatch', t('staff.nav.dispatch')),
          { key: 'drivers', label: t('staff.nav.groupDrivers'), alert: pendingApps + drvDocs + carDocs > 0, tabs: [
            { href: '/admin/applications', label: `${t('staff.nav.applications')}${pendingApps ? ` (${pendingApps})` : ''}`, alert: pendingApps > 0 },
            // Documents (2026-11-24): driving licence → «Водители»; taxi licence, insurance, roadworthiness → «Машины».
            { href: '/admin/drivers', label: `${t('staff.nav.drivers')}${drvDocs ? ` (${drvDocs})` : ''}`, alert: drvDocs > 0 },
            { href: '/admin/vehicles', label: `${t('staff.nav.vehicles')}${carDocs ? ` (${carDocs})` : ''}`, alert: carDocs > 0 },
            { href: '/admin/fleets', label: t('staff.nav.fleets') },
          ] },
          one('/admin/passengers', t('staff.nav.passengers')),
          { key: 'prices', label: t('staff.nav.groupPrices'), tabs: [
            { href: '/admin/fixed-prices', label: t('staff.nav.fixedPrices') },
            { href: '/admin/min-fares', label: t('staff.nav.minFares') },
            { href: '/admin/no-go', label: t('staff.nav.noGo') },
            { href: '/admin/pickup-points', label: t('staff.nav.pickupPoints') },
            { href: '/admin/stands', label: t('staff.nav.stands') },
          ] },
          { key: 'reports', label: t('staff.nav.groupReports'), tabs: [
            { href: '/admin/analytics', label: t('staff.nav.analytics') },
            { href: '/admin/reliability', label: t('staff.nav.reliability') },
          ] },
          ...(me.isOwner ? [{ key: 'owner', label: t('staff.nav.groupOwner'), alert: unread > 0, tabs: [
            { href: '/admin/changes', label: `${t('staff.nav.changes')}${unread ? ` (${unread})` : ''}`, alert: unread > 0 },
            { href: '/admin/accounting', label: t('staff.nav.accounting') },
            { href: '/admin/staff', label: t('staff.nav.staff') },
          ] }] : []),
          { key: 'settings', label: t('staff.nav.groupSettings'), tabs: [
            { href: '/admin/settings', label: t('staff.nav.settings') },
            { href: '/staff/security', label: t('staff.nav.security') },
          ] },
        ];
  const current = groups.find((g) => g.tabs.some((x) => isOn(pathname, x.href)));
  const groupCount = (g: Group) => (g.key === 'drivers' ? pendingApps + drvDocs + carDocs : g.key === 'owner' ? unread : 0);
  const pill = (active: boolean, alert?: boolean) => (alert ? ALERT : active ? 'bg-elevated text-accent' : 'text-muted hover:text-ink');
  const dot = <span className="me-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-white align-middle" />;
  const groupLink = (g: Group, cls: string) => (
    <a key={g.key} href={g.tabs[0].href} className={`whitespace-nowrap rounded-[10px] text-sm ${cls} ${pill(current === g, g.alert)}`}
      data-testid={g.alert ? 'nav-alert' : undefined} data-group={g.key} data-current={current === g ? '' : undefined}>
      {g.alert && dot}{g.label}{g.alert && g.tabs.length > 1 && groupCount(g) ? ` (${groupCount(g)})` : ''}
    </a>
  );

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-edge bg-page px-4 py-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.625rem)' }}>
        <div className="flex min-w-0 items-center gap-4">
          {/* Driver sub-screens (pre-bookings, free orders, 2026-11-19): ‹ back to the map, left of the logo. */}
          {me.role === 'DRIVER' && driverBack && <BackArrow className="-ms-2 -me-3" onBack={() => window.dispatchEvent(new Event('il-y:driver-back'))} />}
          <a href="/dispatch" className="shrink-0"><Logo className="h-6" /></a>
          <nav className="hidden min-w-0 items-center gap-1 overflow-x-auto xl:flex">
            {groups.map((g) => groupLink(g, 'px-2.5 py-1.5'))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted 2xl:inline">{me.displayName} · {me.isOwner ? t('staff.role.OWNER') : t(`staff.role.${me.role}`)}</span>
          {/* Drivers (2026-11-17): language and sign-out live in their Profile, not in this bar. */}
          {/* Admin push (2026-11-24): new driver documents to check. Shown only while it is off / blocked. */}
          {me.role === 'ADMIN' && <NotifyToggle pushUrl="/staff/push" onlyProblems className="hidden sm:block" />}
          {me.role !== 'DRIVER' && <LanguageSwitcher compact />}
          {me.role !== 'DRIVER' && <button onClick={logout} className="btn-ghost !min-h-0 !py-1.5 text-sm">{t('common.signOut')}</button>}
          {/* Drivers: a round button with his initials (like the passenger's, 2026-11-26) opens the side menu. */}
          {me.role === 'DRIVER' && (
            <button type="button" data-testid="driver-menu-btn" aria-label={t('driver.navigation.menu')}
              onClick={() => window.dispatchEvent(new Event('il-y:driver-menu'))}
              className="-me-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-[#0d1608]">
              {(me.displayName || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'}
            </button>
          )}
        </div>
      </header>
      {/* mobile nav: the groups */}
      {groups.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-edge bg-page px-3 py-1.5 xl:hidden">
          {groups.map((g) => groupLink(g, 'px-3 py-1.5'))}
        </nav>
      )}
      {/* tabs inside the current group (phone and computer) */}
      {current && current.tabs.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-edge bg-surface/40 px-3 py-1.5 xl:px-4" data-testid="nav-tabs">
          {current.tabs.map((x) => {
            // The zone tabs share one map (2026-11-25): between them the switch is in-app, so the map stays.
            const A = ZONE_TABS.includes(x.href) && ZONE_TABS.some((h) => isOn(pathname, h)) ? Link : 'a';
            return (
            <A key={x.href} href={x.href} className={`whitespace-nowrap rounded-full px-3 py-1 text-[13px] ${x.alert ? ALERT : isOn(pathname, x.href) ? 'bg-accent font-semibold text-[#0b0f10]' : 'text-muted hover:text-ink'}`}
              data-testid={x.alert ? 'tab-alert' : undefined} data-current={isOn(pathname, x.href) ? '' : undefined}>
              {x.alert && dot}{x.label}
            </A>
            );
          })}
        </nav>
      )}
      {/* New driver documents (2026-11-24): a red bar on top of every admin page until they are checked. */}
      {me.role === 'ADMIN' && docA && docA.uploaded > 0 && (
        <a href={docA.uploadedSection === 'vehicles' ? '/admin/vehicles' : '/admin/drivers'} data-testid="docs-bar"
          className="flex items-center justify-center gap-2 bg-danger px-4 py-2 text-sm font-semibold text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden />
          {t('staff.docs.bar', { n: docA.uploaded })} — <span className="underline">{t('staff.docs.open')}</span>
        </a>
      )}
      {me.role === 'ADMIN' && <NotifyToggle pushUrl="/staff/push" onlyProblems className="border-b border-edge px-4 py-1.5 text-center sm:hidden" />}
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
