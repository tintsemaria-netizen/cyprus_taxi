'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Logo } from '@/components/Brand';
import { api } from '@/lib/api-client';

export interface Me {
  id: string;
  role: 'ADMIN' | 'DISPATCHER' | 'DRIVER';
  displayName: string;
  driverId: string | null;
}

export function StaffShell({ roles, children }: { roles: Me['role'][]; children: (me: Me) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => {
        if (!roles.includes(m.role)) {
          setState('denied');
          if (m.role === 'DRIVER') router.replace('/driver');
          else router.replace('/dispatch');
          return;
        }
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
    return <div className="flex h-[100dvh] items-center justify-center text-muted">Loading…</div>;
  }

  const nav =
    me.role === 'DRIVER'
      ? [{ href: '/driver', label: 'My trip' }]
      : [
          { href: '/dispatch', label: 'Dispatch' },
          ...(me.role === 'ADMIN'
            ? [
                { href: '/admin/applications', label: 'Applications' },
                { href: '/admin/drivers', label: 'Drivers' },
                { href: '/admin/vehicles', label: 'Vehicles' },
                { href: '/admin/settings', label: 'Settings' },
              ]
            : []),
        ];

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-edge bg-page/95 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-6">
          <a href="/dispatch"><Logo className="h-6" /></a>
          <nav className="hidden items-center gap-1 sm:flex">
            {nav.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className={`rounded-[10px] px-3 py-1.5 text-sm ${pathname === n.href ? 'bg-elevated text-accent' : 'text-muted hover:text-ink'}`}
              >
                {n.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted sm:inline">{me.displayName} · {me.role}</span>
          <button onClick={logout} className="btn-ghost !min-h-0 !py-1.5 text-sm">Sign out</button>
        </div>
      </header>
      {/* mobile nav */}
      {nav.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-edge bg-page px-3 py-1.5 sm:hidden">
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
