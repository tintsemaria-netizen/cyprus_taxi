'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { StatusBadge } from '@/components/staff/StatusBadge';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import type { PassengerRow } from '@/server/admin-passengers';

export const dynamic = 'force-dynamic';

interface Ride { id: string; reference: string; status: string; pickupLabel: string; dropoffLabel: string; scheduledAt: string | null; createdAt: string; vClass: string }

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Passengers />}</StaffShell>;
}

function Passengers() {
  const { t, fmt } = useT();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ total: number; passengers: PassengerRow[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rides, setRides] = useState<Ride[] | null>(null);

  const load = useCallback(async (term: string) => {
    try { setData(await api(`/admin/passengers?q=${encodeURIComponent(term)}`)); } catch { setData({ total: 0, passengers: [] }); }
  }, []);
  useEffect(() => { const h = setTimeout(() => load(q), 300); return () => clearTimeout(h); }, [q, load]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setRides(null);
    try { setRides((await api<{ rides: Ride[] }>(`/admin/passengers/${id}`)).rides); } catch { setRides([]); }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('staff.pax.title')}</h1>
        {data && <span className="chip">{t('staff.pax.total', { n: data.total })}</span>}
      </div>
      <input className="field mt-3" placeholder={t('staff.pax.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card mt-4 divide-y divide-edge">
        {!data && <p className="p-4 text-sm text-muted">{t('staff.loading')}</p>}
        {data?.passengers.length === 0 && <p className="p-4 text-sm text-muted">{t('staff.pax.empty')}</p>}
        {data?.passengers.map((p) => (
          <div key={p.id}>
            <button className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-elevated" onClick={() => toggle(p.id)} aria-expanded={open === p.id}>
              <span className="min-w-0">
                <span className="block font-medium">{p.name || t('staff.pax.noName')}</span>
                <span className="block text-xs text-muted">{[p.phone, p.email].filter(Boolean).join(' · ') || '—'}</span>
                <span className="block text-xs text-muted">
                  {t('staff.pax.since', { date: fmt.date(p.createdAt) })}
                  {p.lastSeenAt && <> · {t('staff.pax.lastLogin', { date: fmt.dateTime(p.lastSeenAt) })}</>}
                </span>
              </span>
              <span className="flex flex-wrap gap-1 text-xs">
                <span className="chip">{t('staff.pax.rides', { n: p.rides })}</span>
                {p.completed > 0 && <span className="chip !text-accent">{t('staff.pax.completed', { n: p.completed })}</span>}
                {p.canceled > 0 && <span className="chip !text-danger">{t('staff.pax.canceled', { n: p.canceled })}</span>}
              </span>
            </button>
            {open === p.id && (
              <div className="border-t border-edge/60 bg-panel px-3 py-2">
                {rides === null ? <p className="text-sm text-muted">{t('staff.loading')}</p> : rides.length === 0 ? <p className="text-sm text-muted">{t('staff.pax.noRides')}</p> : (
                  <ul className="divide-y divide-edge/60">
                    {rides.map((r) => (
                      <li key={r.id}>
                        <a href={`/dispatch/bookings/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:text-accent">
                          <span className="min-w-0 text-sm">
                            <span className="font-mono text-xs text-accent">{r.reference}</span> · {fmt.dateTime(r.scheduledAt ?? r.createdAt)}
                            <span className="block truncate text-muted">{r.pickupLabel} → {r.dropoffLabel}</span>
                          </span>
                          <StatusBadge status={r.status} />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
        {data && data.passengers.length < data.total && <p className="p-3 text-center text-xs text-muted">{t('staff.pax.more', { n: data.passengers.length })}</p>}
      </div>
    </div>
  );
}
