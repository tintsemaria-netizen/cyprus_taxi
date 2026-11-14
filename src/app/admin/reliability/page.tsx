'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';
import { useT, MsgKey } from '@/i18n/I18nProvider';

export const dynamic = 'force-dynamic';

// Admin: driver reliability.
interface Row {
  driverId: string; name: string; eligibility: string; onlineHours: number;
  offers: { total: number; accepted: number; rejected: number; missed: number; acceptancePct: number | null; missedPct: number | null };
  trips: { completed: number; preCancels: number; gpsReleases: number };
  prebook: { taken: number; converted: number; lateReleases: number; releases: number; lapsed: number };
  rating: { average: number | null; count: number; low: number };
  state: { onDuty: boolean; vehicle: string | null; gpsAgeSec: number | null };
  flags: string[];
}
interface Event { at: string; kind: string; detail: string; bookingRef: string | null }

type T = (k: MsgKey, v?: Record<string, string | number>) => string;
const lbl = (t: T, k: string, fallback: string) => { const key = k as MsgKey; const v = t(key); return v === key ? fallback : v; };
const age = (t: T, s: number | null) => s == null ? t('staff.rel.noGps') : s < 120 ? t('staff.rel.gpsSec', { n: s }) : s < 7200 ? t('staff.rel.gpsMin', { n: Math.round(s / 60) }) : t('staff.rel.gpsDays', { n: Math.round(s / 86400) || '<1' });

function Reliability() {
  const { t, fmt } = useT();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { const r = await api<{ drivers: Row[] }>(`/admin/reliability?days=${days}`); setRows(r.drivers); }
    catch (e) { setErr(e instanceof ApiRequestError ? e.body.message : t('staff.rel.loadFailed')); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  async function openDriver(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setEvents(null);
    try { setEvents((await api<{ events: Event[] }>(`/admin/reliability/${id}?days=${days}`)).events); } catch { setEvents([]); }
  }

  const flagged = rows?.filter((r) => r.flags.length).length ?? 0;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('staff.rel.title')}</h1>
          {rows && <p className="text-sm text-muted">{t('staff.rel.summary', { n: rows.length, f: flagged, d: days })}</p>}
        </div>
        <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1" role="tablist" aria-label={t('staff.rel.window')}>
          {[7, 30, 90].map((d) => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => { setDays(d); setOpen(null); }} className={`rounded-[9px] px-3 py-1.5 text-sm font-medium ${days === d ? 'bg-accent text-[#0d1608]' : 'text-muted hover:text-ink'}`}>{t('staff.rel.days', { n: d })}</button>
          ))}
        </div>
      </div>
      {err && <p role="alert" className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {!rows ? <p className="text-muted">{t('staff.loading')}</p> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.driverId} className={`card p-4 ${r.flags.length ? 'border-warn/50' : ''}`}>
              <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => openDriver(r.driverId)} aria-expanded={open === r.driverId}>
                <span className="min-w-0">
                  <span className="font-semibold">{r.name}</span>
                  <span className="ml-2 text-xs text-muted">{r.eligibility} · {r.state.onDuty ? t('staff.rel.onDutyNow') : t('staff.rel.offDuty')} · {r.state.vehicle ?? t('staff.rel.noVehicle')} · {age(t, r.state.gpsAgeSec)} · {t('staff.rel.hOnline', { n: r.onlineHours })}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {r.flags.length === 0 ? <span className="chip !text-accent">{t('staff.rel.noFlags')}</span> : r.flags.map((f) => <span key={f} className="chip !border-warn/50 !text-warn">{lbl(t, `staff.rel.flag.${f}`, f)}</span>)}
                </span>
              </button>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label={t('staff.rel.offers')} value={`${r.offers.total}`} sub={r.offers.total ? t('staff.rel.offersSub', { a: r.offers.acceptancePct ?? 0, m: r.offers.missedPct ?? 0 }) : t('staff.rel.none')} />
                <Stat label={t('staff.rel.trips')} value={t('staff.rel.tripsDone', { n: r.trips.completed })} sub={t('staff.rel.tripsSub', { c: r.trips.preCancels, g: r.trips.gpsReleases })} />
                <Stat label={t('staff.rel.prebooked')} value={`${r.prebook.taken}`} sub={t('staff.rel.prebookSub', { c: r.prebook.converted, l: r.prebook.lateReleases, x: r.prebook.lapsed })} />
                <Stat label={t('staff.rel.rating')} value={r.rating.average != null ? `★ ${r.rating.average.toFixed(1)}` : '—'} sub={t('staff.rel.ratingSub', { n: r.rating.count, l: r.rating.low })} />
              </div>
              {open === r.driverId && (
                <div className="mt-3 border-t border-edge pt-3">
                  {events === null ? <p className="text-sm text-muted">{t('staff.loading')}</p> : events.length === 0 ? <p className="text-sm text-muted">{t('staff.rel.noEvents')}</p> : (
                    <ul className="space-y-1.5 text-sm">
                      {events.map((e, i) => (
                        <li key={i} className="flex flex-wrap gap-x-2">
                          <span className="text-muted">{fmt.dateTime(e.at)}</span>
                          <span className="font-medium">{lbl(t, `staff.rel.kind.${e.kind}`, e.kind)}</span>
                          {e.bookingRef && <span className="font-mono text-xs text-muted">{e.bookingRef}</span>}
                          {e.detail && <span className="text-muted">— {e.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <section className="card p-4 text-xs text-muted">
        <h2 className="mb-2 text-sm font-semibold text-ink">{t('staff.rel.howTitle')}</h2>
        <ul className="list-disc space-y-1 pl-4">
          {(['how1', 'how2', 'how3', 'how4', 'how5', 'how6'] as const).map((k) => <li key={k}>{t(`staff.rel.${k}`)}</li>)}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[12px] border border-edge bg-elevated p-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold">{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  );
}

export default function Page() {
  return <StaffShell roles={['ADMIN']}>{() => <Reliability />}</StaffShell>;
}
