'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatFlight } from '@/lib/flight';
import { useT } from '@/i18n/I18nProvider';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import AutoMapView, { type MapMarker } from '@/components/AutoMapView';

// Driver pre-booking board (scheduled rides). Server: src/server/dispatch/preassign.ts.
interface Item {
  bookingId: string; reference: string; pickupAt: string; pickupLabel: string; dropoffLabel: string;
  vClass: string; passengerCount: number; fareCents: number | null; priceType: string | null;
  flightNumber: string | null; airport: boolean; conflict?: boolean; canReleaseFreely?: boolean;
  note?: string | null;
}
interface Board { available: Item[]; mine: Item[]; blocked: string | null }

// Mirrors config.dispatch.preassign defaults (display only; the server enforces the real values).
const PROTECT_MIN = 75;
const CONVERT_MIN = 30;

export function ScheduledRides({ onCount }: { onCount?: (n: number) => void }) {
  const { t, tp, fmt, tError } = useT();
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Item | null>(null);
  // Two lists (2026-11-13): open pre-bookings to take, and the ones this driver has accepted.
  const [view, setView] = useState<'available' | 'mine'>('available');
  // Review first (2026-11-13): a card opens the ride's details; take / release from there.
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const b = await api<Board>('/driver/scheduled'); setBoard(b); setErr(null); onCount?.(b.available.filter((i) => !i.conflict).length); }
    catch (e) { setErr(e ? tError(e) : t('driver.scheduled.loadFailed')); }
  }, [t, tError, onCount]);
  useEffect(() => { load(); const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [load]);

  async function take(i: Item) {
    setBusy(i.bookingId); setMsg(null); setErr(null);
    try { await api(`/driver/scheduled/${i.bookingId}/claim`, { method: 'POST' }); setMsg(t('driver.scheduled.taken')); setOpenId(null); setView('mine'); await load(); }
    catch (e) { setErr(tError(e)); await load(); }
    finally { setBusy(null); }
  }
  async function release(i: Item) {
    setBusy(i.bookingId); setErr(null);
    try { await api(`/driver/scheduled/${i.bookingId}/release`, { method: 'POST' }); setAsk(null); setOpenId(null); await load(); }
    catch (e) { setErr(tError(e)); setAsk(null); }
    finally { setBusy(null); }
  }

  const row = (i: Item, action: React.ReactNode) => (
    <div key={i.bookingId} className="rounded-[12px] border border-edge bg-elevated p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{fmt.dateTime(i.pickupAt)}</span>
        <span className="flex shrink-0 gap-1">
          {i.airport && <span className="chip !text-accent">✈ {t('driver.scheduled.airport')}</span>}
          <span className="chip">{t(`common.vClass.${i.vClass}` as 'common.vClass.COMFORT')}</span>
        </span>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2"><span className="text-accent">●</span><span className="min-w-0">{i.pickupLabel}</span></div>
        <div className="flex gap-2"><span className="text-muted">○</span><span className="min-w-0">{i.dropoffLabel}</span></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{tp('common.passengers', i.passengerCount)}</span>
        {i.flightNumber && <span className="font-mono text-ink">{t('driver.scheduled.flight', { flight: formatFlight(i.flightNumber) })}</span>}
        {i.fareCents != null && <span>{t('driver.scheduled.fareEstimate', { amount: fmt.money(i.fareCents) })}</span>}
      </div>
      {i.note && <p className="mt-2 rounded-[10px] border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-xs text-warn">💬 {i.note}</p>}
      {/* This ride's own time rules (2026-11-13: moved here from the page header). */}
      <div className="mt-2 space-y-0.5 rounded-[10px] border border-edge bg-page px-2.5 py-2 text-xs text-muted">
        <div>🕒 {t('driver.scheduled.freeUntil', { time: fmt.time(new Date(new Date(i.pickupAt).getTime() - PROTECT_MIN * 60_000)), min: PROTECT_MIN })}</div>
        <div>🚖 {t('driver.scheduled.activeAt', { time: fmt.time(new Date(new Date(i.pickupAt).getTime() - CONVERT_MIN * 60_000)), min: CONVERT_MIN })}</div>
      </div>
      <div className="mt-3">{action}</div>
    </div>
  );

  if (openId && board) {
    const item = [...board.mine, ...board.available].find((x) => x.bookingId === openId);
    return (
      <>
        <ScheduledDetail id={openId} busy={busy === openId}
          onBack={(gone) => { setOpenId(null); if (gone) { setErr(t('errors.ORDER_GONE')); void load(); } }}
          onTake={() => item && take(item)} onRelease={() => item && setAsk(item)} />
        {ask && (
          <ConfirmSheet title={t('driver.scheduled.releaseTitle')} body={ask.canReleaseFreely === false ? t('driver.scheduled.releaseLateBody') : t('driver.scheduled.releaseBody')}
            confirmLabel={t('driver.scheduled.release')} cancelLabel={t('driver.scheduled.keep')} danger busy={busy === ask.bookingId}
            onConfirm={() => release(ask)} onCancel={() => setAsk(null)} />
        )}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {msg && <p role="status" className="rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{msg}</p>}
      {err && <p role="alert" className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {!board ? <p className="text-sm text-muted">{t('common.loading')}</p> : (
        <>
          <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1" role="tablist">
            {(['available', 'mine'] as const).map((v) => {
              const n = v === 'available' ? board.available.filter((i) => !i.conflict).length : board.mine.length;
              return (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`relative flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${view === v ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>
                  {v === 'available' ? t('driver.scheduled.available') : t('driver.scheduled.mine')}
                  {n > 0 && <span className={`ml-1.5 inline-block min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] ${v === 'available' ? 'bg-danger text-white' : 'bg-page text-ink'}`}>{n}</span>}
                </button>
              );
            })}
          </div>

          {view === 'mine' && (board.mine.length === 0 ? <p className="text-sm text-muted">{t('driver.scheduled.noneMine')}</p> : board.mine.map((i) => row(i,
            <button className="btn-ghost !min-h-[44px] w-full border border-edge" onClick={() => setOpenId(i.bookingId)}>{t('driver.free.view')}</button>)))}

          {view === 'available' && (board.blocked ? (
            <p className="rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{board.blocked === 'NO_VEHICLE' ? t('driver.scheduled.blockedNoVehicle') : t('driver.scheduled.blockedNotEligible')}</p>
          ) : board.available.length === 0 ? <p className="text-sm text-muted">{t('driver.scheduled.noneAvailable')}</p> : board.available.map((i) => row(i,
            <>
              {i.conflict && <p className="mb-2 text-xs text-warn">{t('driver.scheduled.conflict')}</p>}
              <button className="btn-primary !min-h-[44px] w-full" onClick={() => setOpenId(i.bookingId)}>{t('driver.free.view')}</button>
            </>)))}
        </>
      )}
      {ask && (
        <ConfirmSheet title={t('driver.scheduled.releaseTitle')} body={ask.canReleaseFreely === false ? t('driver.scheduled.releaseLateBody') : t('driver.scheduled.releaseBody')}
          confirmLabel={t('driver.scheduled.release')} cancelLabel={t('driver.scheduled.keep')} danger busy={busy === ask.bookingId}
          onConfirm={() => release(ask)} onCancel={() => setAsk(null)} />
      )}
    </div>
  );
}

interface Detail extends Item {
  mine: boolean; passengerName: string; luggageCount: number;
  fareBreakdown: { label: string; cents: number }[] | null;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  trip: { distanceM: number; etaSec: number; path: [number, number][] | null; roadRouted: boolean };
  blocked: string | null;
}

// Pre-booking review screen: map with the ride's route, then pickup time, from/to, client name,
// trip length, fare (+breakdown), the passenger's note and this ride's time rules. Back, and Take
// (open ride) or Release (accepted ride).
function ScheduledDetail({ id, busy, onBack, onTake, onRelease }: { id: string; busy: boolean; onBack: (gone: boolean) => void; onTake: () => void; onRelease: () => void }) {
  const { t, fmt } = useT();
  const [d, setD] = useState<Detail | null>(null);
  const [h, setH] = useState(800);
  useEffect(() => {
    setH(window.innerHeight);
    let alive = true;
    api<{ ride: Detail }>(`/driver/scheduled/${id}`).then((r) => { if (alive) setD(r.ride); }).catch(() => { if (alive) onBack(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const markers = useMemo<MapMarker[]>(() => d ? [
    { id: 'p', kind: 'pickup', lat: d.pickup.lat, lng: d.pickup.lng, label: d.pickup.label },
    { id: 'd', kind: 'dropoff', lat: d.dropoff.lat, lng: d.dropoff.lng, label: d.dropoff.label },
  ] : [], [d]);
  const route = useMemo(() => d?.trip.path?.map(([la, ln]) => [ln, la] as [number, number]), [d]);
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} ${t('driver.units.kmShort')}` : `${m} ${t('driver.units.mShort')}`);

  return (
    <>
      <div className="fixed inset-0 z-0">
        <AutoMapView markers={markers} route={route} center={d?.pickup ?? { lat: 34.92, lng: 33.2 }} zoom={9} interactive
          fitPadding={{ top: 110, right: 50, bottom: Math.round(h * 0.6) + 90, left: 50 }} className="h-full w-full" />
      </div>
      <div className="pointer-events-none fixed inset-x-0 z-10 mx-auto max-w-lg px-3" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        <div className="card pointer-events-auto max-h-[60dvh] overflow-y-auto border-2 border-accent p-4">
          {!d ? <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p> : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-bold">{fmt.dateTime(d.pickupAt)}</span>
                <span className="flex shrink-0 gap-1">
                  {d.airport && <span className="chip !text-accent">✈ {t('driver.scheduled.airport')}</span>}
                  <span className="chip">{t(`common.vClass.${d.vClass}` as 'common.vClass.COMFORT')}</span>
                </span>
              </div>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex gap-2"><span className="text-accent">●</span><span className="min-w-0 font-medium">{d.pickup.label}</span></div>
                <div className="flex gap-2"><span className="text-muted">○</span><span className="min-w-0 font-medium">{d.dropoff.label}</span></div>
              </div>
              <div className="mt-3 space-y-1.5 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.client')}</span><span className="font-medium">{d.passengerName}</span></div>
                <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.scheduled.trip')}</span><span className="font-medium">{km(d.trip.distanceM)} · {t('driver.offer.minShort', { min: Math.max(1, Math.round(d.trip.etaSec / 60)) })}</span>{!d.trip.roadRouted && <span className="text-xs text-muted">≈</span>}</div>
                <div className="flex items-baseline gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.sum')}</span><span className="text-lg font-bold">{d.fareCents != null ? fmt.money(d.fareCents) : '—'}</span><span className="text-xs text-muted">{d.priceType === 'UPFRONT_DYNAMIC' ? t('driver.offer.upfront') : t('driver.offer.meterEstimate')}</span></div>
              </div>
              {d.note && <p className="mt-2 rounded-[10px] border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-xs text-warn">💬 {d.note}</p>}
              {d.flightNumber && <p className="mt-2 font-mono text-xs text-ink">{t('driver.scheduled.flight', { flight: formatFlight(d.flightNumber) })}</p>}
              <div className="mt-2 space-y-0.5 rounded-[10px] border border-edge bg-page px-2.5 py-2 text-xs text-muted">
                <div>🕒 {t('driver.scheduled.freeUntil', { time: fmt.time(new Date(new Date(d.pickupAt).getTime() - PROTECT_MIN * 60_000)), min: PROTECT_MIN })}</div>
                <div>🚖 {t('driver.scheduled.activeAt', { time: fmt.time(new Date(new Date(d.pickupAt).getTime() - CONVERT_MIN * 60_000)), min: CONVERT_MIN })}</div>
              </div>
              <details className="mt-2 text-xs text-muted">
                <summary className="cursor-pointer">{t('driver.offer.more')}</summary>
                <div className="mt-1 space-y-0.5">
                  {d.fareBreakdown?.length ? d.fareBreakdown.map((l, i) => (
                    <div key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.label}</span><span className="shrink-0">{fmt.money(l.cents)}</span></div>
                  )) : <div>{t('driver.offer.noEstimate')}</div>}
                  <div>{t('driver.offer.phoneHidden')}</div>
                </div>
              </details>
              {!d.mine && d.conflict && <p className="mt-2 text-xs text-warn">{t('driver.scheduled.conflict')}</p>}
            </>
          )}
          <div className="sticky -bottom-4 -mx-4 -mb-4 mt-4 grid grid-cols-2 gap-2 bg-panel px-4 pb-4 pt-2">
            <button className="btn-ghost min-h-[44px]" onClick={() => onBack(false)}>{t('driver.free.back')}</button>
            {d?.mine
              ? <button className="btn-ghost min-h-[44px] border border-danger/40 !text-danger" disabled={busy} onClick={onRelease}>{t('driver.scheduled.release')}</button>
              : <button className="btn-primary min-h-[44px]" disabled={!d || busy || d.conflict || !!d.blocked} onClick={onTake}>{busy ? t('driver.scheduled.taking') : t('driver.scheduled.take')}</button>}
          </div>
        </div>
      </div>
    </>
  );
}
