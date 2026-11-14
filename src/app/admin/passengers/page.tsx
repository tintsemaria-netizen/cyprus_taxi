'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { StatusBadge } from '@/components/staff/StatusBadge';
import { api } from '@/lib/api-client';
import { useT } from '@/i18n/I18nProvider';
import { useDialog } from '@/components/useDialog';
import type { PassengerRow } from '@/server/admin-passengers';

export const dynamic = 'force-dynamic';

interface Profile { id: string; name: string | null; email: string | null; phone: string | null; phoneVerifiedAt: string | null; hasPassword: boolean; createdAt: string; updatedAt: string; activeSessions: number; lastLoginAt: string | null; savedPlaces: { kind: string; label: string }[] }
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tempPw, setTempPw] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dialog, ask] = useDialog();

  const load = useCallback(async (term: string) => {
    try { setData(await api(`/admin/passengers?q=${encodeURIComponent(term)}`)); } catch { setData({ total: 0, passengers: [] }); }
  }, []);
  useEffect(() => { const h = setTimeout(() => load(q), 300); return () => clearTimeout(h); }, [q, load]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setRides(null); setProfile(null); setTempPw(null);
    try { const r = await api<{ profile: Profile; rides: Ride[] }>(`/admin/passengers/${id}`); setProfile(r.profile); setRides(r.rides); } catch { setRides([]); }
  }

  async function resetPw(id: string) {
    const ok = await ask({ title: t('staff.pax.resetTitle'), body: t('staff.pax.resetBody'), confirmLabel: t('staff.pax.resetPw'), danger: true });
    if (!ok) return;
    const r = await api<{ temporaryPassword: string }>(`/admin/passengers/${id}/reset-password`, { method: 'POST' });
    setTempPw(r.temporaryPassword); setCopied(false);
    setProfile((p) => (p ? { ...p, hasPassword: true, activeSessions: 0 } : p));
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      {dialog}
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
                {profile && (
                  <div className="mb-3 space-y-1 rounded-[12px] border border-edge p-3 text-sm">
                    <Row k={t('staff.pax.id')} v={<span className="font-mono text-xs">{profile.id}</span>} />
                    <Row k={t('staff.pax.name')} v={profile.name || '—'} />
                    <Row k={t('staff.pax.login')} v={profile.email || '—'} />
                    <Row k={t('staff.pax.phone')} v={profile.phone ? `${profile.phone} · ${profile.phoneVerifiedAt ? t('staff.pax.verified') : t('staff.pax.notVerified')}` : '—'} />
                    <Row k={t('staff.pax.password')} v={profile.hasPassword ? t('staff.pax.pwSet') : t('staff.pax.pwNone')} />
                    <Row k={t('staff.pax.sessions')} v={String(profile.activeSessions)} />
                    {profile.lastLoginAt && <Row k={t('staff.pax.lastLoginLabel')} v={fmt.dateTime(profile.lastLoginAt)} />}
                    <Row k={t('staff.pax.updated')} v={fmt.dateTime(profile.updatedAt)} />
                    {profile.savedPlaces.length > 0 && <Row k={t('staff.pax.places')} v={profile.savedPlaces.map((s) => `${s.kind}: ${s.label}`).join('; ')} />}
                    {tempPw ? (
                      <div className="mt-2 rounded-[10px] border border-accent/40 bg-accent/10 p-2">
                        <p className="break-all">{t('staff.pax.newPw', { pw: tempPw })}</p>
                        <button className="btn-ghost mt-2 !py-1 text-xs" onClick={() => { void navigator.clipboard?.writeText(tempPw); setCopied(true); }}>{copied ? t('staff.pax.copied') : t('staff.pax.copy')}</button>
                      </div>
                    ) : (
                      <button className="btn-ghost mt-2 !py-1.5 text-sm" onClick={() => void resetPw(profile.id)}>{t('staff.pax.resetPw')}</button>
                    )}
                  </div>
                )}
                {rides && rides.length > 0 && <p className="mb-1 text-xs uppercase tracking-wide text-muted">{t('staff.pax.ridesTitle')}</p>}
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

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-3"><span className="w-40 shrink-0 text-muted">{k}</span><span className="min-w-0 break-words">{v}</span></div>;
}
