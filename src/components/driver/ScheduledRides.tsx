'use client';

import { type PaxRatingValue } from '@/components/driver/PaxRating';
import { ClientLine, RouteLines } from '@/components/driver/OrderBits';
import { fareRangeText } from '@/lib/price-type';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatFlight } from '@/lib/flight';
import { useT } from '@/i18n/I18nProvider';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import AutoMapView, { type MapMarker } from '@/components/AutoMapView';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

// Driver pre-booking board (scheduled rides). Server: src/server/dispatch/preassign.ts.
// Frame colours (2026-11-27, operator): a free pre-booking (nobody has taken it) — orange; one he took — violet.
const FREE_C = '#FFA94D';
const MINE_C = '#A78BFA';
const Tag = ({ mine, label }: { mine: boolean; label: string }) => (
  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: mine ? MINE_C : FREE_C }}>{label}</span>
);

interface Item {
  passengerName?: string; passengerRating?: { average: number; count: number } | null; // card: name ★ class (2026-11-27)
  bookingId: string; reference: string; pickupAt: string; pickupLabel: string; dropoffLabel: string; dropoffPostcode?: string | null;
  vClass: string; passengerCount: number; fareCents: number | null; priceType: string | null; minCents?: number | null;
  flightNumber: string | null; airport: boolean; conflict?: boolean; canReleaseFreely?: boolean;
  note?: string | null;
  share?: ShareBoard | null; // ride-share pair (Task 022)
  arrive?: { from: string; by: string } | null; // «быть на месте с … до …» (2026-11-22)
  span?: { from: string; to: string } | null; // «Попутчик» departure hour: «подача 13:00–13:15» (2026-11-25)
}
interface ShareBoard {
  guestPickupAt: string; guestPickupLabel: string; guestDropoffLabel: string;
  passengers: number; children: number; luggage: number; totalFareCents: number; extraMin: number;
  hostArrive?: { from: string; by: string } | null; guestArrive?: { from: string; by: string } | null;
}

// A pre-booked ride-share pair (Task 022): one order with two passengers; the driver earns both.
function SharePairBox({ s }: { s: ShareBoard }) {
  const { t, fmt } = useT();
  return (
    <div className="mt-2 space-y-1 rounded-[10px] border border-accent/40 bg-accent/5 px-2.5 py-2 text-xs">
      <div className="font-semibold text-accent">👥 {t('share.driver.boardPair', { n: s.passengers, bags: s.luggage })}</div>
      <div className="text-ink">{t('share.driver.boardSecond', { time: fmt.time(s.guestPickupAt), from: s.guestPickupLabel, to: s.guestDropoffLabel })}</div>
      <div className="font-semibold text-ink">{t('share.driver.boardTotal', { amount: fmt.money(s.totalFareCents) })}</div>
    </div>
  );
}
// No «быть на месте» on the driver's screens (operator, 2026-11-23): only the time between the stops.
interface Board { available: Item[]; mine: Item[]; blocked: string | null; rules?: { protectMin: number; convertMin: number; leadMin: number; lateReleaseMin: number } }

// Mirrors config.dispatch.preassign defaults (display only; the server enforces the real values).

export function ScheduledRides({ onCount }: { onCount?: (n: number, pair: boolean, mine: number) => void }) {
  const { t, tp, fmt, tError } = useT();
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Item | null>(null);
  // Two lists (2026-11-13): open pre-bookings to take, and the ones this driver has accepted.
  const [view, setView] = useState<'available' | 'mine'>('available');
  const [info, setInfo] = useState(false); // «ⓘ» pre-booking rules (2026-11-26)
  // Review first (2026-11-13): a card opens the ride's details; take / release from there.
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const b = await api<Board>('/driver/scheduled'); setBoard(b); setErr(null); const open = b.available.filter((i) => !i.conflict); onCount?.(open.length, open.some((i) => !!i.share), b.mine.length); }
    catch (e) { setErr(e ? tError(e) : t('driver.scheduled.loadFailed')); }
  }, [t, tError, onCount]);
  useEffect(() => { load(); const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [load]);
  useRefreshOnReturn(load); // resumed app: fresh data at once (2026-11-22)

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

  // A ride-share pair (2026-11-19): a short card — date/time, label, from → to, total — and the
  // whole card opens the details (no separate «Посмотреть» button).
  const pairRow = (i: Item, s: ShareBoard, mine: boolean) => (
    <button key={i.bookingId} type="button" data-testid="pair-card" onClick={() => setOpenId(i.bookingId)}
      className="block w-full rounded-[12px] border-2 bg-elevated p-3 text-start active:bg-white/[0.04]" style={{ borderColor: mine ? MINE_C : FREE_C }}>
      <Tag mine={mine} label={mine ? t('driver.scheduled.tagMine') : t('driver.scheduled.tagFree')} />
      <div className="text-lg font-semibold">{fmt.dateTime(i.pickupAt)}</div>
      <div className="mt-1 text-sm font-semibold text-accent">👥 {t('share.driver.boardCompact')}</div>
      <div className="mt-1.5 text-sm">{i.pickupLabel} → {i.dropoffLabel}</div>
      <div className="mt-1.5 text-base font-bold">{fmt.money(s.totalFareCents)}</div>
      {i.conflict && <p className="mt-1 text-xs text-warn">{t('driver.scheduled.conflict')}</p>}
    </button>
  );

  const row = (i: Item, action: React.ReactNode, mine = false) => i.share ? pairRow(i, i.share, mine) : (
    // The whole card opens the ride too, not only «Посмотреть» (operator 2026-11-26).
    <div key={i.bookingId} role="button" tabIndex={0} data-testid="prebook-card" onClick={() => setOpenId(i.bookingId)}
      onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(i.bookingId); }}
      className="cursor-pointer rounded-[12px] border-2 bg-elevated p-3 active:bg-white/[0.04]" style={{ borderColor: mine ? MINE_C : FREE_C }}>
      <Tag mine={mine} label={mine ? t('driver.scheduled.tagMine') : t('driver.scheduled.tagFree')} />
      {/* Same look as «Новый заказ» (2026-11-27, operator): when, the client (name ★ class), from / to in the frame. */}
      <div className="text-lg font-semibold">{fmt.dateTime(i.span ? i.span.from : i.pickupAt)}{i.span && <span className="block text-xs font-normal text-muted">{t('driver.scheduled.mayShift')}</span>}</div>
      <ClientLine name={i.passengerName ?? ''} rating={i.passengerRating} vClass={i.vClass} />
      <RouteLines pickup={{ label: i.pickupLabel }} dropoff={{ label: i.dropoffLabel, postcode: i.dropoffPostcode }} />
      {/* The price bigger, on the right (operator 2026-11-26). */}
      <div className="mt-2 flex items-center gap-3">
        {i.flightNumber && <span className="font-mono text-xs text-ink">{t('driver.scheduled.flight', { flight: formatFlight(i.flightNumber) })}</span>}
        {i.fareCents != null && <span className="ms-auto text-[17px] font-bold text-ink" data-testid="prebook-card-price">{fareRangeText(i.fareCents, i.priceType, (c) => fmt.money(c), i.minCents)}</span>}
      </div>
      {i.share && <SharePairBox s={i.share} />}
      {i.note && <p className="mt-2 rounded-[10px] border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-xs text-warn">💬 {i.note}</p>}
      <div className="mt-3" onClick={(e) => e.stopPropagation()}>{action}</div>
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
                  {n > 0 && <span className={`ms-1.5 inline-block min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] bg-danger text-white`}>{n}</span>}
                </button>
              );
            })}
          </div>
          {/* «ⓘ Инфо» under «Принятые»: all the pre-booking rules in one place (operator 2026-11-26). */}
          {board.rules && (
            <div className="-mt-1 mb-1 flex justify-end">
              <button type="button" onClick={() => setInfo((o) => !o)} aria-expanded={info} data-testid="prebook-info"
                className="rounded-full border border-edge px-2.5 py-0.5 text-xs font-medium text-muted hover:text-ink">ⓘ {t('driver.scheduled.infoBtn')}</button>
            </div>
          )}
          {info && board.rules && (
            <div className="mb-2 space-y-1.5 rounded-[12px] border border-edge bg-page px-3 py-2.5 text-xs leading-snug text-muted" data-testid="prebook-rules">
              <div>🕒 {t('driver.scheduled.rule1', { min: board.rules.protectMin })}</div>
              <div>🧭 {t('driver.scheduled.rule2', { min: board.rules.protectMin })}</div>
              <div>🚖 {t('driver.scheduled.rule3', { min: board.rules.convertMin })}</div>
              <div>📍 {t('driver.scheduled.ruleFar')}</div>
              <div>⏳ {t('driver.scheduled.rule4', { min: board.rules.leadMin })}</div>
              <div>↩️ {t('driver.scheduled.rule5', { min: board.rules.lateReleaseMin })}</div>
            </div>
          )}

          {view === 'mine' && (board.mine.length === 0 ? <p className="text-sm text-muted">{t('driver.scheduled.noneMine')}</p> : board.mine.map((i) => row(i,
            <button className="btn-ghost !min-h-[44px] w-full border border-edge" onClick={() => setOpenId(i.bookingId)}>{t('driver.free.view')}</button>, true)))}

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
  mine: boolean; passengerName: string; passengerRating?: PaxRatingValue; luggageCount: number;
  fareBreakdown: { label: string; cents: number }[] | null;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string; postcode?: string | null };
  trip: { distanceM: number; etaSec: number; path: [number, number][] | null; roadRouted: boolean };
  pair?: PairDetail | null; // ride-share pair (2026-11-19)
  blocked: string | null;
}

interface PairStop {
  n: number; kind: 'pickup' | 'dropoff'; who: 'host' | 'guest'; passenger: 1 | 2;
  label: string; lat: number; lng: number; at: string | null;
  adults: number; children: number; luggage: number; fareCents: number | null;
  toNext: { min: number; km: number } | null;
}
interface PairDetail {
  stops: PairStop[];
  totals: { passengers: number; children: number; luggage: number; km: number; min: number; extraMin: number; fareCents: number };
  path: [number, number][]; roadRouted: boolean;
}

// Ride-share pair in the pre-booking detail: every stop in order with its passenger, approximate
// address, time, people / suitcases, price, and time + km to the next stop; then the whole trip.
function PairStops({ p, s: sb }: { p: PairDetail; s?: ShareBoard | null }) {
  const { t, fmt } = useT();
  const who = (s: PairStop) => [
    t('share.who.adults', { n: s.adults }), ...(s.children ? [t('share.who.children', { n: s.children })] : []), t('share.who.luggage', { n: s.luggage }),
  ].join(' · ');
  return (
    <div className="mt-2 space-y-2" data-testid="pair-stops">
      <div className="text-xs font-semibold uppercase tracking-wide text-accent">👥 {t('share.driver.pair.stopsTitle')}</div>
      {p.stops.map((s) => (
        <div key={s.n} className="rounded-[12px] border border-edge bg-elevated p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.passenger === 2 ? 'bg-accent text-black' : 'bg-edge-strong text-ink'}`}>{s.n}</span>
            <span className="font-semibold">{s.kind === 'pickup' ? t('share.driver.pair.pickupWord') : t('share.driver.pair.dropoffWord')} · {t('share.driver.pair.passengerN', { n: s.passenger })}</span>
            {s.at && <span className="ms-auto shrink-0 text-xs text-muted">{t('share.driver.pair.atTime', { time: fmt.time(s.at) })}</span>}
          </div>
          <div className="mt-1 font-medium">{s.label}</div>
          {s.kind === 'pickup' && (
            <div className="mt-0.5 text-muted">{who(s)}{s.fareCents != null && <> · <span className="font-semibold text-ink">{fmt.money(s.fareCents)}</span></>}</div>
          )}
          {s.toNext && <div className="mt-1 text-xs text-accent">→ {t('share.driver.pair.toNext', { min: s.toNext.min, km: s.toNext.km.toLocaleString(undefined, { maximumFractionDigits: 1 }) })}</div>}
        </div>
      ))}
      <div className="rounded-[12px] border border-accent/50 bg-accent/5 p-3 text-sm">
        <div className="font-semibold">{t('share.driver.pair.tripTitle')}{!p.roadRouted && <span className="text-xs font-normal text-muted"> ≈</span>}</div>
        <div className="mt-0.5">{t('share.driver.pair.tripLine', { people: p.totals.passengers, bags: p.totals.luggage, km: p.totals.km.toLocaleString(undefined, { maximumFractionDigits: 1 }), min: p.totals.min })}</div>
        {p.totals.extraMin > 0 && <div className="text-xs text-muted">{t('share.driver.pair.extraLine', { n: p.totals.extraMin })}</div>}
        <div className="mt-1 text-lg font-bold">{fmt.money(p.totals.fareCents)}</div>
      </div>
      <p className="text-xs text-muted">{t('share.driver.pair.approxNote')}</p>
    </div>
  );
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

  const markers = useMemo<MapMarker[]>(() => !d ? [] : d.pair
    // A pair: every stop on the map, numbered in the order the trip runs.
    ? d.pair.stops.map((s) => ({ id: `s${s.n}`, kind: s.kind, lat: s.lat, lng: s.lng, label: `${s.n}. ${s.label}`, num: s.n }))
    : [
      { id: 'p', kind: 'pickup', lat: d.pickup.lat, lng: d.pickup.lng, label: d.pickup.label },
      { id: 'd', kind: 'dropoff', lat: d.dropoff.lat, lng: d.dropoff.lng, label: d.dropoff.label },
    ], [d]);
  const route = useMemo(() => d?.trip.path?.map(([la, ln]) => [ln, la] as [number, number]), [d]);
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} ${t('driver.units.kmShort')}` : `${m} ${t('driver.units.mShort')}`);

  return (
    <>
      <div className="fixed inset-0 z-0">
        <AutoMapView markers={markers} route={route} center={d?.pickup ?? { lat: 34.92, lng: 33.2 }} zoom={9} interactive
          fitPadding={{ top: 110, right: 50, bottom: Math.round(h * 0.6) + 90, left: 50 }} className="h-full w-full" />
      </div>
      <div className="pointer-events-none fixed inset-x-0 z-10 mx-auto max-w-lg px-3" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        <div className="card pointer-events-auto max-h-[60dvh] overflow-y-auto border-2 p-4" style={{ borderColor: d?.mine ? MINE_C : FREE_C }}>
          {d && <Tag mine={d.mine} label={d.mine ? t('driver.scheduled.tagMine') : t('driver.scheduled.tagFree')} />}
          {!d ? <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p> : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-bold">{fmt.dateTime(d.span ? d.span.from : d.pickupAt)}{d.span && <span className="block text-xs font-normal text-muted">{t('driver.scheduled.mayShift')}</span>}</span>
                {/* A pair has no client row: the class stays up here (2026-11-26). */}
                {d.pair && <span className="shrink-0 rounded-md border-2 border-white/25 px-2 py-0.5 text-[15px] font-bold uppercase tracking-wide text-ink/80">{t(`common.vClass.${d.vClass}` as 'common.vClass.COMFORT')}</span>}
              </div>
              {/* A pair has its own stop list and totals instead of one passenger's from/to and sum. */}
              {!d.pair && <>
              {/* Same look as «Новый заказ» (2026-11-27): the client, from / to in the frame, then trip and sum. */}
              <ClientLine name={d.passengerName} rating={d.passengerRating} vClass={d.vClass} />
              <RouteLines pickup={d.pickup} dropoff={d.dropoff} />
              <div className="mt-3 space-y-1.5 px-1 text-sm">
                <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.scheduled.trip')}</span><span className="font-medium">{km(d.trip.distanceM)} · {t('driver.offer.minShort', { min: Math.max(1, Math.round(d.trip.etaSec / 60)) })}</span>{!d.trip.roadRouted && <span className="text-xs text-muted">≈</span>}</div>
                <div className="flex items-baseline gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.sum')}</span><span className="text-lg font-bold">{d.fareCents != null ? fareRangeText(d.fareCents, d.priceType, (c) => fmt.money(c), d.minCents) : '—'}</span></div>
              </div>
              </>}
              {d.pair ? <PairStops p={d.pair} s={d.share} /> : d.share && <SharePairBox s={d.share} />}
              {d.note && <p className="mt-2 rounded-[10px] border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-xs text-warn">💬 {d.note}</p>}
              {d.flightNumber && <p className="mt-2 font-mono text-xs text-ink">{t('driver.scheduled.flight', { flight: formatFlight(d.flightNumber) })}</p>}
              {/* The «🕒 до … свободны / 🚖 станет активной» rules live on the pre-bookings list card only (operator 2026-11-26). */}
              {!d.mine && d.conflict && <p className="mt-2 text-xs text-warn">{t('driver.scheduled.conflict')}</p>}
            </>
          )}
          <div className="sticky -bottom-4 -mx-4 -mb-4 mt-4 grid grid-cols-2 gap-2 bg-panel px-4 pb-4 pt-2">
            {/* A pair: the whole trip's sum right at the button (TZ review 2026-11-23). */}
            {d?.pair && <div className="col-span-2 flex items-baseline justify-between rounded-[10px] border border-accent/40 bg-accent/10 px-3 py-1.5" data-testid="pair-total"><span className="text-sm text-muted">{t('driver.scheduled.pairTotal')}</span><span className="text-lg font-bold">{fmt.money(d.pair.totals.fareCents)}</span></div>}
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
