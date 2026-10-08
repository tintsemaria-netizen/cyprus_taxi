'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { api, ApiRequestError } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

// Admin: driver reliability (internal console — English only).
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

const FLAG_LABEL: Record<string, string> = {
  LOW_ACCEPTANCE: 'Low acceptance', MISSED_OFFERS: 'Misses offers', LATE_RELEASES: 'Late pre-book releases',
  LOW_RATING: 'Low rating', PRE_PICKUP_CANCELS: 'Pre-pickup cancels',
  ONLINE_NO_VEHICLE: 'Online without a vehicle', ONLINE_STALE_GPS: 'Online, GPS stale',
};
const age = (s: number | null) => s == null ? 'no GPS' : s < 120 ? `GPS ${s}s ago` : s < 7200 ? `GPS ${Math.round(s / 60)} min ago` : `GPS ${Math.round(s / 86400) || '<1'} d ago`;
const KIND_LABEL: Record<string, string> = {
  PREBOOK_LATE_RELEASE: 'Late pre-book release', PREBOOK_RELEASE: 'Pre-book release', PREBOOK_LAPSED: 'Pre-book lapsed',
  PRE_PICKUP_CANCEL: 'Cancelled before pickup', GPS_RELEASE: 'Released: GPS lost', LOW_RATING: 'Low rating',
};
const when = (s: string) => new Date(s).toLocaleString('en-GB', { timeZone: 'Europe/Nicosia', dateStyle: 'medium', timeStyle: 'short' });

function Reliability() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { const r = await api<{ drivers: Row[] }>(`/admin/reliability?days=${days}`); setRows(r.drivers); }
    catch (e) { setErr(e instanceof ApiRequestError ? e.body.message : 'Could not load reliability data.'); }
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
          <h1 className="text-xl font-bold">Driver reliability</h1>
          {rows && <p className="text-sm text-muted">{rows.length} active drivers · {flagged} flagged for review · last {days} days</p>}
        </div>
        <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1" role="tablist" aria-label="Window">
          {[7, 30, 90].map((d) => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => { setDays(d); setOpen(null); }} className={`rounded-[9px] px-3 py-1.5 text-sm font-medium ${days === d ? 'bg-accent text-[#0d1608]' : 'text-muted hover:text-ink'}`}>{d} days</button>
          ))}
        </div>
      </div>
      {err && <p role="alert" className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {!rows ? <p className="text-muted">Loading…</p> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.driverId} className={`card p-4 ${r.flags.length ? 'border-warn/50' : ''}`}>
              <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => openDriver(r.driverId)} aria-expanded={open === r.driverId}>
                <span className="min-w-0">
                  <span className="font-semibold">{r.name}</span>
                  <span className="ml-2 text-xs text-muted">{r.eligibility} · {r.state.onDuty ? 'on duty now' : 'off duty'} · {r.state.vehicle ?? 'no vehicle'} · {age(r.state.gpsAgeSec)} · {r.onlineHours} h online</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {r.flags.length === 0 ? <span className="chip !text-accent">No flags</span> : r.flags.map((f) => <span key={f} className="chip !border-warn/50 !text-warn">{FLAG_LABEL[f] ?? f}</span>)}
                </span>
              </button>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label="Offers" value={`${r.offers.total}`} sub={r.offers.total ? `${r.offers.acceptancePct}% accepted · ${r.offers.missedPct}% missed` : 'none'} />
                <Stat label="Trips" value={`${r.trips.completed} done`} sub={`${r.trips.preCancels} cancelled pre-pickup · ${r.trips.gpsReleases} GPS lost`} />
                <Stat label="Pre-booked" value={`${r.prebook.taken}`} sub={`${r.prebook.converted} done · ${r.prebook.lateReleases} late releases · ${r.prebook.lapsed} lapsed`} />
                <Stat label="Rating" value={r.rating.average != null ? `★ ${r.rating.average.toFixed(1)}` : '—'} sub={`${r.rating.count} ratings · ${r.rating.low} low (1–2★)`} />
              </div>
              {open === r.driverId && (
                <div className="mt-3 border-t border-edge pt-3">
                  {events === null ? <p className="text-sm text-muted">Loading…</p> : events.length === 0 ? <p className="text-sm text-muted">No reliability events in this window.</p> : (
                    <ul className="space-y-1.5 text-sm">
                      {events.map((e, i) => (
                        <li key={i} className="flex flex-wrap gap-x-2">
                          <span className="text-muted">{when(e.at)}</span>
                          <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
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
        <h2 className="mb-2 text-sm font-semibold text-ink">How these numbers are defined</h2>
        <ul className="list-disc space-y-1 pl-4">
          <li><b>Offers</b>: offers the driver answered or let expire in the window. Offers withdrawn by the system (passenger cancelled, staff assigned) are excluded. <b>Missed</b> = expired without an answer.</li>
          <li><b>Cancelled pre-pickup</b>: the driver released an assigned ride before pickup (the ride was re-matched). <b>GPS lost</b>: the system released the ride after 90 s without location before pickup.</li>
          <li><b>Pre-booked</b>: commitments taken in the window. <b>Late release</b> = released less than 60 min before pickup. <b>Lapsed</b> = the driver was offline or busy at conversion time.</li>
          <li><b>Rating</b>: passenger ratings received in the window.</li>
          <li><b>Live state</b> (right now, not windowed): a driver on duty without a vehicle, or whose GPS is older than 5 min, can never be matched — fix the binding or ask them to reopen the app.</li>
          <li>Flags (acceptance &lt; 50% or missed &gt; 30% with ≥ 10 offers; ≥ 2 late releases; rating &lt; 4.0 with ≥ 5 ratings; ≥ 3 pre-pickup cancels) are prompts for a human conversation, not automatic sanctions.</li>
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
