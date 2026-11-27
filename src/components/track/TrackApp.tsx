'use client';

import { useKeyboardViewport } from '@/components/useKeyboardViewport';
import { useDeadReckoning } from '@/components/useDeadReckoning';
import { DR } from '@/lib/nav';
import { FixedTop } from '@/components/FixedTop';
import { PassengerTopBar } from '@/components/PassengerTopBar';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { Logo } from '@/components/Brand';
import { ChatPanel } from '@/components/ChatPanel';
import { useSilentPush } from '@/components/NotifyPrompt';
import { RateTripModal } from '@/components/booking/RateTripModal';
import { GoogleReviewCard } from '@/components/GoogleReviewCard';
import { api, ApiRequestError } from '@/lib/api-client';
import { offRouteM, trimRoute } from '@/components/routeGlide';
import { CarStreetChip } from '@/components/useStreetName';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { formatFlight } from '@/lib/flight';
import { useT } from '@/i18n/I18nProvider';
import type { MsgKey } from '@/i18n/I18nProvider';
import { useSheetDrag } from '@/components/useSheetDrag';
import { PlacesInput, type Selected } from '@/components/booking/PlacesInput';
import { fareRangeText } from '@/lib/price-type';
import { DoneReceipt } from '@/components/track/DoneReceipt';
import { ShareProposalCard, SharedBadge, type ShareProposalView, type SharedView } from '@/components/share/SharePassenger';

interface TrackView {
  flightNumber?: string | null;
  arrive?: { from: string; by: string } | null;
  span?: { from: string; to: string } | null;
  confirmedDriver?: null | { name: string; make: string; model: string; color: string; plate: string; rating: { average: number; count: number } | null };
  reference: string;
  myRating?: number | null;
  status: string;
  revision: number;
  scheduledAt: string | null;
  pickup: { lat: number; lng: number; label: string };
  dropoff: { lat: number; lng: number; label: string };
  stop?: { lat: number; lng: number; label: string; arrivedAt?: string | null; waitStartedAt?: string | null; departedAt?: string | null; waitCents?: number | null; rateCentsPerMin?: number } | null;
  passengerName: string;
  vClass: string;
  passengerCount: number;
  fareWording: string;
  vehicle: null | { driverName: string; make: string; model: string; color: string; plate: string; vClass: string; phone: string | null; rating: { average: number; count: number } | null; photos?: { driver: string | null; car: string | null } };
  location: null | { lat: number; lng: number; freshness: string; poorAccuracy: boolean; sampledAt: string };
  pickupEta: string | null;
  pickupEtaMin: number | null;
  /** The driver is finishing another ride nearby first (next order, 2026-11-25). */
  finishingNearby?: boolean;
  /** Where the driver drops his current passenger off — a bare point, nothing else (2026-11-25). */
  finishingAt?: { lat: number; lng: number } | null;
  pickupEtaApprox: boolean;
  fareCents: number | null;
  lateCancel?: { kind: 'noShow' | 'prebook'; feeCents: number; at: string; afterMin: number; beforeMin: number }[];
  priceType?: string | null;
  fareMinCents?: number | null;
  startCode: string | null;
  waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null;
  receipt: null | { totalCents: number | null; completedAt: string | null; estimateCents: number | null; waitingCents: number; finalCents: number | null; currency: string; priceType: string; paymentMethod: string; paymentStatus: string };
  canCancel: boolean;
  canRetry: boolean;
  timeline: { type: string; at: string; status: string | null }[];
  // Ride-share «Попутчик» (Task 022)
  shareProposal?: ShareProposalView | null;
  shareOptIn?: boolean;
  shared?: SharedView | null;
}

const STATUS_KEYS = new Set(['REQUESTED', 'SEARCHING', 'NO_DRIVER', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']);

// Render a translated template whose {slot} placeholder is a React node (e.g. a styled span).
function rich(template: string, node: React.ReactNode): React.ReactNode {
  const [before, after = ''] = template.split('\u0000');
  return <>{before}{node}{after}</>;
}
export default function TrackApp() {
  const kbBox = useKeyboardViewport(); // keep the header below the status bar while typing (iOS)
  const { t, tp, fmt, tError } = useT();
  const [view, setView] = useState<TrackView | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'noauth' | 'error'>('loading');
  const [reconnecting, setReconnecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [safety, setSafety] = useState(false);
  const [rateOpen, setRateOpen] = useState(false); // finished ride: the rating window over the receipt (2026-11-26)
  // Chat: a button next to the code (operator 2026-11-26); kept mounted so new messages show a badge on it.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [routeLine, setRouteLine] = useState<[number, number][]>([]);
  const routeLineRef = useRef<[number, number][]>([]);
  routeLineRef.current = routeLine; // [lng,lat] driver→pickup / →destination
  const [disconnected, setDisconnected] = useState(false); // hide stale live data
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);
  const ready = useRef(false); // start polling only after initial exchange/load
  // Keep the (unexchanged) token in memory ONLY so a transient exchange failure can
  // be retried; it is never written to logs/URL/storage.
  const tokenRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (inFlight.current) return; // never overlap requests
    inFlight.current = true;
    try {
      const v = await api<TrackView>('/tracking/booking');
      setView(v);
      setPhase('ready');
      setReconnecting(false);
      setDisconnected(false);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        // Authorization revoked/expired — clear all protected state.
        setView(null);
        setPhase('noauth');
      } else {
        // Transient network/server failure: mark reconnecting and HIDE apparently-live
        // vehicle data (never keep an old fresh marker/ETA). Show a retry if we have
        // nothing to display yet.
        setReconnecting(true);
        setDisconnected(true);
        setPhase((p) => (p === 'loading' ? 'error' : p));
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Attempt (or re-attempt) token exchange + initial load. Distinguishes a rejected
  // token (discard, show noauth) from a transient failure (stay retryable).
  const bootstrap = useCallback(async () => {
    const token = tokenRef.current;
    if (token) {
      try {
        await api('/tracking/exchange', { method: 'POST', body: { token } });
        tokenRef.current = null; // consumed
      } catch (e) {
        if (e instanceof ApiRequestError && (e.status === 401 || e.status === 404 || e.status === 422)) {
          tokenRef.current = null;
          setView(null);
          setPhase('noauth'); // invalid/expired link — never reveal an old cookie's booking
          return;
        }
        setPhase('error'); // transient — keep the token for retry
        return;
      }
    }
    await load();
    ready.current = true;
  }, [load]);

  useEffect(() => {
    const m = window.location.hash.match(/token=([^&]+)/);
    try { sessionStorage.setItem('il-y-resume-checked', '1'); } catch { /* ignore */ } // see BookingApp resume
    if (m) {
      tokenRef.current = decodeURIComponent(m[1]);
      history.replaceState(null, '', window.location.pathname); // strip token from the address bar
    }
    bootstrap();
  }, [bootstrap]);

  // Instant status (2026-11-17): a light server stream says «something changed» (driver on the way,
  // arrived, started, chat…) within ~1 s, and the view reloads at once. The 5 s poll below stays for
  // the car position (economical) and as a fallback when the stream is unavailable.
  const streamStatus = view?.status;
  const streamOpen = phase === 'ready' && !!streamStatus && streamStatus !== 'COMPLETED' && streamStatus !== 'CANCELED';
  useEffect(() => {
    if (!streamOpen || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/v1/tracking/stream');
    // A poll may be in flight at that moment (load() skips overlaps) → try again shortly after.
    es.onmessage = () => { void load(); setTimeout(() => { void load(); }, 700); };
    return () => es.close();
  }, [streamOpen, load]);

  useEffect(() => {
    function tick() {
      if (ready.current && document.visibilityState === 'visible') load();
    }
    pollRef.current = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  // Route on the passenger's map (2026-11-13): while there is no moving driver yet (searching,
  // board, no driver) or the driver is at the pickup, show the ride the passenger chose
  // (pickup→destination). Once a driver is on the way: driver→pickup (ASSIGNED/EN_ROUTE), then
  // driver→destination (IN_PROGRESS). Recomputed when the driver moves meaningfully (coarse key)
  // or the leg changes; bounded by the 5s poll cadence.
  const drvLoc = disconnected ? null : view?.location ?? null;
  const rleg = view?.status === 'IN_PROGRESS' ? 'dropoff' : view?.status === 'EN_ROUTE' || view?.status === 'ASSIGNED' ? 'pickup' : null;
  // …and the finished ride (2026-11-26): the whole route, pickup → destination, framed on the map.
  const planned = !!view && ['REQUESTED', 'SEARCHING', 'NO_DRIVER', 'ARRIVED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'].includes(view.status);
  // Economical (2026-11-18): the driver's route is fetched once per leg and again only when the car
  // left it (> 50 m) or after 2 min — not every ~10 m as before. The passed part is cut off locally.
  const routeFetch = useRef<{ leg: string; at: number; n: number }>({ leg: '', at: 0, n: 0 });
  // The destination is part of the key (2026-11-27): a changed drop-off redraws the line at once.
  const legKey = drvLoc && rleg ? (rleg === 'dropoff' ? `dropoff:${view!.dropoff.lat},${view!.dropoff.lng}` : rleg) : planned ? `plan:${view!.pickup.lat},${view!.pickup.lng}>${view!.dropoff.lat},${view!.dropoff.lng}` : '';
  if (legKey !== routeFetch.current.leg) routeFetch.current = { leg: legKey, at: 0, n: routeFetch.current.n + 1 };
  else if (drvLoc && rleg && routeFetch.current.at && Date.now() - routeFetch.current.at > 15_000
    && (Date.now() - routeFetch.current.at > 120_000 || (routeLineRef.current.length > 1 && offRouteM(routeLineRef.current, drvLoc) > 50))) routeFetch.current = { leg: legKey, at: 0, n: routeFetch.current.n + 1 };
  const routeKey = legKey ? `${legKey}#${routeFetch.current.n}` : '';
  useEffect(() => {
    if (!view || !routeKey) { setRouteLine([]); return; }
    const from = drvLoc && rleg ? drvLoc : view.pickup;
    const to = drvLoc && rleg ? (rleg === 'dropoff' ? view.dropoff : view.pickup) : view.dropoff;
    let alive = true;
    routeFetch.current.at = Date.now(); // also after a failed fetch: retry in 15 s+, not never / in a loop
    (async () => {
      try {
        const r = await api<{ available?: boolean; path?: [number, number][] }>('/routes/estimate', {
          method: 'POST', body: { from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng } }, timeoutMs: 9000,
        });
        if (alive && r.available !== false && r.path) setRouteLine(r.path.map(([la, ln]) => [ln, la] as [number, number]));
        else if (alive) setRouteLine([]);
      } catch { /* keep last geometry */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // Optional trip-start code (2026-11-16): off by default, the passenger switches it on/off here.
  const [codeBusy, setCodeBusy] = useState(false);
  async function toggleStartCode(enabled: boolean) {
    setCodeBusy(true); setActionError(null);
    try { await api('/tracking/start-code', { method: 'POST', body: { enabled } }); await load(); }
    catch (e) { setActionError(e instanceof ApiRequestError ? tError(e) : t('track.startCodeFailed')); }
    finally { setCodeBusy(false); }
  }

  function repeatSameRide() {
    if (!view) return;
    try {
      sessionStorage.setItem('il-y-repeat', JSON.stringify({
        p: view.pickup, d: view.dropoff, c: view.vClass,
        s: view.stop ? { lat: view.stop.lat, lng: view.stop.lng, label: view.stop.label } : null,
      }));
    } catch { /* storage blocked: falls back to an empty form */ }
    window.location.href = '/';
  }

  async function cancel() {
    if (!view) return;
    setCancelling(true); setActionError(null);
    try {
      await api('/tracking/cancel', { method: 'POST', body: { expectedRevision: view.revision } });
      setConfirmCancel(false);
      // Straight back to ordering with the same route (2026-11-18): the booking screen opens with the
      // same pickup, stop, destination and class already filled in, at the price step — no retyping.
      repeatSameRide();
      return;
    } catch (e) {
      setConfirmCancel(false);
      setActionError(e instanceof ApiRequestError ? tError(e) : t('track.cancelFailed'));
    } finally {
      setCancelling(false);
    }
  }

  // Read-only "share my trip" link for family/friends: position, driver and car only.
  async function share() {
    setShareMsg(null);
    try {
      const r = await api<{ url: string }>('/tracking/share', { method: 'POST' });
      const text = t('track.shareText');
      if (typeof navigator !== 'undefined' && navigator.share) {
        try { await navigator.share({ title: t('track.shareTitle'), text, url: r.url }); return; } catch { /* dismissed — fall back to copy */ }
      }
      await navigator.clipboard.writeText(r.url);
      setShareMsg(t('track.shareCopied'));
    } catch (e) {
      setShareMsg(e instanceof ApiRequestError ? tError(e) : t('track.shareFailed'));
    }
  }

  // «Показать водителю, где я» and the passenger's own person marker are off for now (2026-11-17):
  // the question moves to the full sign-up later (ShareLocationToggle / server code kept).
  const prePickup = view?.status === 'ASSIGNED' || view?.status === 'EN_ROUTE' || view?.status === 'ARRIVED';
  const [ratedNow, setRatedNow] = useState<number | null>(null); // 5-star rating left on this screen
  // Info sheet open/collapsed (2026-11-15): handle tap or swipe. Collapses by itself when the trip
  // starts so the passenger sees the car driving the route up close.
  useSilentPush('/tracking/push');
  const [sheetOpen, setSheetOpen] = useState(true);
  const sheetSwipeY = useRef<number | null>(null);
  const sheetSwiped = useRef(false);
  const sheetBodyRef = useRef<HTMLDivElement | null>(null);
  // While searching the panel stays open — no folded variant (2026-11-17).
  const searchingNow = view?.status === 'SEARCHING';
  const panelOpen = sheetOpen || searchingNow;
  const setPanelOpen = useCallback((v: boolean | ((o: boolean) => boolean)) => { if (!searchingNow) setSheetOpen(v); }, [searchingNow]);
  const sheetDrag = useSheetDrag({ open: panelOpen, setOpen: setPanelOpen, scrollRef: sheetBodyRef });
  // The map runs under the sheet: frame points in the part ABOVE it (2026-11-16), so the pulsing
  // pickup pin sits in the middle of what the passenger actually sees while we search.
  const [sheetEl, setSheetEl] = useState<HTMLDivElement | null>(null);
  const [sheetH, setSheetH] = useState(0);
  const sheetRef = useCallback((el: HTMLDivElement | null) => { sheetDrag.panelRef(el); setSheetEl(el); }, [sheetDrag.panelRef]);
  useEffect(() => {
    if (!sheetEl) return;
    const ro = new ResizeObserver(() => setSheetH(Math.round(sheetEl.getBoundingClientRect().height)));
    ro.observe(sheetEl);
    return () => ro.disconnect();
  }, [sheetEl]);
  // Keep at least ~140 px of map visible: MapLibre silently skips a fit whose padding does not fit
  // (a tall sheet on a pre-booking left the map zoomed in on the pickup — 2026-11-19).
  const mapPad = useMemo(() => {
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    return { top: 72, right: 40, bottom: Math.max(24, Math.min(sheetH + 24, h - 72 - 140)), left: 40 };
  }, [sheetH]);
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const st = view?.status ?? null;
    if (st && st !== prevStatus.current) {
      // Searching shows the full panel again (2026-11-17), with the chosen route framed above it.
      // A car on its way (2026-11-17): fold to the driver card so the map shows the car's route to
      // the pickup in our lime line, framed and followed as it updates.
      if (st === 'IN_PROGRESS' || ((st === 'ASSIGNED' || st === 'EN_ROUTE') && prevStatus.current !== 'ASSIGNED' && prevStatus.current !== 'EN_ROUTE')) setSheetOpen(false);
      if (st === 'COMPLETED' || st === 'CANCELED' || st === 'ARRIVED') setSheetOpen(true);
      prevStatus.current = st;
    }
  }, [view?.status]);
  // During the trip the map follows the car closely (north-up); a gesture frees it for 4 s.

  async function retry() {
    if (!view) return;
    setRetrying(true);
    try {
      await api('/tracking/research', { method: 'POST', body: { expectedRevision: view.revision } });
      await load();
    } catch (e) {
      setActionError(e instanceof ApiRequestError ? tError(e) : t('track.researchFailed'));
    } finally {
      setRetrying(false);
    }
  }

  // The car keeps going along the route when its GPS goes quiet — the A6 tunnels (2026-11-20).
  // Display only, marked «примерно»; the server and the ETA still use the last real position.
  const drPath = useMemo(() => (routeLine.length > 1 ? routeLine.map(([ln, la]) => [la, ln] as [number, number]) : null), [routeLine]);
  const drFix = !disconnected && view?.location && ['ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS'].includes(view.status) ? view.location : null;
  const dr = useDeadReckoning({ fix: drFix ? { lat: drFix.lat, lng: drFix.lng } : null, fixKey: drFix?.sampledAt ?? null, path: drPath, startMs: DR.passengerStartMs });

  if (phase === 'loading') {
    return <Centered><div className="animate-pulse text-muted">{t('track.loadingRide')}</div></Centered>;
  }
  if (phase === 'noauth') {
    return (
      <Centered>
        <div className="card max-w-sm p-6 text-center">
          <Logo className="mb-4 justify-center" />
          <h1 className="text-lg font-semibold">{t('track.noRideTitle')}</h1>
          <p className="mt-2 text-sm text-muted">{t('track.noRideBody')}</p>
          <a href="/" className="btn-primary mt-4 w-full">{t('track.bookRide')}</a>
        </div>
      </Centered>
    );
  }
  if (phase === 'error') {
    return (
      <Centered>
        <div className="card max-w-sm p-6 text-center">
          <Logo className="mb-4 justify-center" />
          <h1 className="text-lg font-semibold">{t('track.unreachableTitle')}</h1>
          <p className="mt-2 text-sm text-muted">{t('track.unreachableBody')}</p>
          <button className="btn-primary mt-4 w-full" onClick={() => { setPhase('loading'); bootstrap(); }}>{t('common.retry')}</button>
          <a href="/" className="mt-3 block text-sm text-muted hover:text-ink">{t('track.bookNewRide')}</a>
        </div>
      </Centered>
    );
  }
  if (!view) {
    return <Centered><div className="text-muted">{t('track.reconnecting')}</div></Centered>;
  }

  const terminal = view.status === 'COMPLETED' || view.status === 'CANCELED';
  // While disconnected we suppress the live vehicle position/ETA entirely — a stale
  // marker must never look current.
  const realLocation = disconnected ? null : view.location;
  const liveLocation = realLocation && dr.pos ? { ...realLocation, lat: dr.pos.lat, lng: dr.pos.lng } : realLocation;
  // Closing in on the drop-off (2026-11-17): within ~600 m the map zooms in gradually (16 → 17.5).
  // The whole route ahead stays in view (2026-11-18), on the way to the pickup and during the trip:
  // the line shrinks behind the car and the camera re-frames smoothly as it gets shorter.
  const liveTrip = !!liveLocation && (view.status === 'ASSIGNED' || view.status === 'EN_ROUTE' || view.status === 'IN_PROGRESS');
  const shownRoute = liveTrip && routeLine.length ? trimRoute(routeLine, liveLocation) : routeLine;
  const markers: MapMarker[] = [];
  // Before pickup, anchor on the pickup; during the trip, anchor on the destination.
  if (view.stop && !view.stop.departedAt) markers.push({ id: 's', lat: view.stop.lat, lng: view.stop.lng, kind: 'stop', label: view.stop.label });
  // During the trip and after it (2026-11-15) the map stays on the destination, not the pickup.
  // While searching (2026-11-17) both ends of the chosen route show, with the route line between.
  const onTrip = view.status === 'IN_PROGRESS' || view.status === 'COMPLETED';
  // A pre-booking (2026-11-19) shows the whole route from afar too: both ends, framed together.
  if (onTrip || view.status === 'SEARCHING' || view.status === 'REQUESTED') markers.push({ id: 'd', lat: view.dropoff.lat, lng: view.dropoff.lng, kind: 'dropoff', label: view.dropoff.label });
  if (!onTrip || view.status === 'COMPLETED') markers.push({ id: 'p', lat: view.pickup.lat, lng: view.pickup.lng, kind: 'pickup', label: view.pickup.label, pulse: view.status === 'SEARCHING' });
  // The finishing driver's drop-off: just a point on the map, no label (operator 2026-11-25).
  if (view.finishingAt && !onTrip) markers.push({ id: 'fin', lat: view.finishingAt.lat, lng: view.finishingAt.lng, kind: 'stop', label: '', noFit: false });
  if (liveLocation) markers.push({ id: 'v', lat: liveLocation.lat, lng: liveLocation.lng, kind: 'vehicle', label: t('track.yourDriver'), stale: liveLocation.freshness === 'stale' || dr.estimated });

  // Under a minute (2026-11-27, operator: «0 мин (примерно)» looked odd) → «меньше минуты», no «примерно».
  const etaUnder = view.pickupEtaMin != null && view.pickupEtaMin < 1;
  const etaMinText = view.pickupEtaMin != null ? (etaUnder ? t('track.etaUnderMin') : tp('common.minutes', view.pickupEtaMin)) : null;
  const etaText = !disconnected && etaMinText ? (view.pickupEtaApprox && !etaUnder ? t('track.etaApprox', { min: etaMinText }) : etaMinText) : null;
  const statusLabel = STATUS_KEYS.has(view.status) ? t(`common.status.${view.status}` as MsgKey) : view.status;
  const headline =
    (view.status === 'EN_ROUTE' || view.status === 'ASSIGNED') && view.vehicle && view.finishingNearby
      ? (etaText ? t('track.finishingEta', { name: view.vehicle.driverName, eta: etaText }) : t('track.finishing', { name: view.vehicle.driverName }))
      : (view.status === 'EN_ROUTE' || view.status === 'ASSIGNED') && view.vehicle
      ? (etaText ? t('track.meetDriverEta', { name: view.vehicle.driverName, eta: etaText }) : t('track.meetDriver', { name: view.vehicle.driverName }))
      // An old order no driver was found for (2026-11-20): «Поездка не состоялась», no retry.
      : view.status === 'NO_DRIVER' && !view.canRetry ? t('rides.detail.notHappened') : statusLabel;
  const vehicleDesc = view.vehicle ? `${view.vehicle.color} ${view.vehicle.make} ${view.vehicle.model}` : '';
  const SLOT = '\u0000';
  // «Готово» and × on the finished ride (2026-11-26): not rated yet → the rating window; rated → the start page.
  const finishDone = () => { if (ratedNow ?? view.myRating) window.location.href = '/'; else setRateOpen(true); };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-page" style={kbBox}>
      <FixedTop top={kbBox?.top}><PassengerTopBar sticky={false} back={false} account={false} /></FixedTop>{/* no «‹» and no account button on the ride screen (operator 2026-11-26) */}

      <div className="relative flex-1">
        <div className="absolute inset-0">
          <AutoMapView markers={markers} route={shownRoute.length ? shownRoute : undefined} center={view.pickup} zoom={12} interactive className="h-full w-full"
            fitPadding={mapPad} fitRoute={view.status === 'COMPLETED' || view.status === 'REQUESTED' || view.status === 'SEARCHING' || liveTrip || view.status === 'ASSIGNED' || view.status === 'EN_ROUTE' || view.status === 'IN_PROGRESS'} keepInView={liveTrip}
            idleReturnMs={4000} />
        </div>
        {/* The street the car is on (2026-11-17): the map labels only main roads at this zoom. */}
        <CarStreetChip pos={liveLocation} enabled={view.status === 'EN_ROUTE' || view.status === 'IN_PROGRESS'} top="top-14" />

        {/* status pill */}
        <div className="absolute start-4 top-4 z-10 max-w-[70%]">
          {/* No pill while searching (2026-11-15): the sheet already says it, bigger. */}
          {/* No pill while searching or after a cancellation (2026-11-16): the sheet says it. */}
          {/* …nor when no driver is free (2026-11-17): the sheet says it. */}
          {/* No pill on the finished ride either (2026-11-18): the sheet title says it. */}
          {view.status !== 'SEARCHING' && view.status !== 'CANCELED' && view.status !== 'NO_DRIVER' && view.status !== 'COMPLETED' && <span className="chip !bg-page/90 !text-accent">
            {view.status === 'EN_ROUTE' ? `● ${t('track.pillEnRoute')}` : `● ${statusLabel.toUpperCase()}`}
          </span>}
          {reconnecting && <span className="chip ms-2 !bg-page/90 !text-warn">{t('track.reconnecting')}</span>}
        </div>

        {/* Ride-share proposal: a light notification on top of the map (Task 022). */}
        {view.shareProposal && !terminal && <ShareProposalCard key={view.shareProposal.groupId} p={view.shareProposal} onAnswered={load} route={{ from: view.pickup.label, to: view.dropoff.label }} />}

        {/* Chat over the map (2026-11-26, as on the driver's screen), opened by «💬 Чат» next to the code. */}
        {view.vehicle && !terminal && (
          <div className={chatOpen ? 'fixed inset-0 z-[60] flex flex-col justify-end bg-black/50' : 'hidden'} onClick={(e) => { if (e.target === e.currentTarget) setChatOpen(false); }} data-testid="track-chat">
            <div className="rounded-t-[18px] bg-page p-2" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
              <ChatPanel listUrl="/tracking/messages" postUrl="/tracking/messages" pushUrl="/tracking/push" me="PASSENGER" peerLabel="driver" large
                expandedOverride={chatOpen} onUnread={setChatUnread} callHref={view.vehicle.phone ? `tel:${view.vehicle.phone}` : null} onClose={() => setChatOpen(false)} />
            </div>
          </div>
        )}

        {/* bottom sheet */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end sm:block">
          <div className="pointer-events-auto relative w-full sm:absolute sm:bottom-4 sm:start-4 sm:w-[400px]">
            {/* ☰ above the sheet (2026-11-15): «Поделиться» and «Безопасность» live in this menu. */}
            {!terminal && (
              <div className="absolute bottom-full end-3 z-20 mb-2">
                {/* A tap anywhere else closes the menu (operator 2026-11-26) — the menu is a sheet over a dark layer (always on screen, also
                    when the panel is pulled up); a tap on the layer closes it, on iPhone too (Safari sends no click for a tap on the map or plain page parts to document listeners). */}
                {menuOpen && (
                  <div className="fixed inset-0 z-[60] flex cursor-pointer flex-col justify-end bg-black/45" onClick={(e) => { if (e.target === e.currentTarget) setMenuOpen(false); }} data-testid="track-menu-backdrop">
                  <div className="mx-auto w-full max-w-md cursor-auto overflow-hidden rounded-t-[18px] border border-edge bg-page shadow-2xl sm:mb-4 sm:rounded-[18px]" role="menu" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                    <button type="button" role="menuitem" className="flex w-full items-center gap-3 px-4 py-3.5 text-start text-[15px] hover:bg-white/5" onClick={() => { setMenuOpen(false); share(); }}>{t('track.shareTrip')}</button>
                    <button type="button" role="menuitem" className="flex w-full items-center gap-3 border-t border-edge px-4 py-3.5 text-start text-[15px] hover:bg-white/5" onClick={() => { setMenuOpen(false); setSafety(true); }}>{t('track.safety')}</button>
                    {/* «Отменить заказ» lives in this menu (2026-11-19), not as a button on the sheet. */}
                    {view.canCancel && (
                      <button type="button" role="menuitem" className="flex w-full items-center gap-3 border-t border-edge px-4 py-3.5 text-start text-[15px] text-danger hover:bg-danger/10 disabled:opacity-50" disabled={cancelling}
                        onClick={() => { setMenuOpen(false); setConfirmCancel(true); }}>{cancelling ? t('track.cancelling') : t('track.cancelBooking')}</button>
                    )}
                  </div>
                  </div>
                )}
                {/* «💬» chat with the driver right above ☰ — always on screen, the panel up or down (operator 2026-11-27). */}
                {view.vehicle && (
                  <button type="button" onClick={() => setChatOpen(true)} data-testid="track-chat-open" aria-label={t('track.chat.titleDriver')}
                    className="relative mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-page/95 text-[22px] shadow-lg">
                    💬
                    {chatUnread > 0 && <span className="absolute -end-1 -top-1 min-w-[20px] rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-5 text-white">{chatUnread}</span>}
                  </button>
                )}
                <button type="button" aria-label={t('track.menu')} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} data-testid="track-menu"
                  className="relative z-20 flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-page/95 shadow-lg">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-ink" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
                </button>
              </div>
            )}
            {shareMsg && <p role="status" className="absolute bottom-full start-3 mb-3 rounded-full bg-page/95 px-3 py-1.5 text-xs text-muted shadow">{shareMsg}</p>}
            <div ref={sheetRef} data-testid="track-sheet" className="card relative flex max-h-[78dvh] flex-col overflow-hidden sm:max-h-[calc(100dvh-7rem)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)', ...sheetDrag.style }}>
              {/* Finished ride (2026-11-15): × in the top-right corner returns to the start (new booking). */}
              {view.status === 'CANCELED' && (
                <a href="/" aria-label={t('track.closeToStart')} title={t('track.closeToStart')}
                  className="absolute end-1.5 top-1.5 z-20 flex h-12 w-12 items-center justify-center rounded-full text-[36px] leading-none text-muted hover:bg-page/60 hover:text-ink">×</a>
              )}
              {/* Finished ride: × works like «Готово» — the rating window first (operator 2026-11-26), then the start page. */}
              {view.status === 'COMPLETED' && (
                <button type="button" onClick={finishDone} aria-label={t('track.closeToStart')} title={t('track.closeToStart')} data-testid="done-x"
                  className="absolute end-1.5 top-1.5 z-20 flex h-12 w-12 items-center justify-center rounded-full text-[36px] leading-none text-muted hover:bg-page/60 hover:text-ink">×</button>
              )}
              <button type="button" aria-expanded={panelOpen} aria-label={panelOpen ? t('booking.sheet.collapse') : t('booking.sheet.expand')}
                onClick={() => { if (!sheetSwiped.current) setPanelOpen((o) => !o); sheetSwiped.current = false; }}
                onPointerDown={(e) => { sheetSwipeY.current = e.clientY; }}
                onPointerUp={(e) => { if (sheetSwipeY.current == null) return; const dy = e.clientY - sheetSwipeY.current; sheetSwipeY.current = null; if (Math.abs(dy) > 25) { sheetSwiped.current = true; setPanelOpen(dy < 0); } }}
                className={`flex w-full shrink-0 touch-none justify-center pb-0.5 pt-2 ${searchingNow ? 'pointer-events-none invisible' : ''}`}><span className="h-1.5 w-12 rounded-full bg-edge-strong" /></button>
              {/* Pinned: what the passenger needs at pickup (status, driver/plate, start code). */}
              <div className={`shrink-0 p-4 pb-3 pt-1 sm:p-5 sm:pb-3 sm:pt-1 ${panelOpen ? 'border-b border-edge' : ''}`}>
                {view.status === 'SEARCHING'
                  ? <>
                      <h1 className="text-lg font-medium leading-snug text-ink" role="status" aria-live="polite">{t('track.searchingNote')}</h1>
                    </>
                  : <h1 className="text-xl font-bold" role="status" aria-live="polite">{headline}</h1>}
                {/* A pre-booking doesn't block further orders (2026-11-13). */}
                {view.status === 'REQUESTED' && view.confirmedDriver && (
                  <div className="mt-3 rounded-[12px] border border-accent/40 bg-accent/5 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-accent">✓ {t('track.prebook.confirmedTitle')}</div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{view.confirmedDriver.name}</div>
                        <div className="truncate text-sm text-muted">
                          {view.confirmedDriver.rating && <span className="whitespace-nowrap text-accent">★ {view.confirmedDriver.rating.average.toFixed(1)} · </span>}
                          {view.confirmedDriver.color} {view.confirmedDriver.make} {view.confirmedDriver.model}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-[8px] border border-edge bg-page px-2.5 py-1.5 font-mono text-base font-bold tracking-wide max-[359px]:px-1.5 max-[359px]:text-sm">{view.confirmedDriver.plate}</span>
                    </div>
                  </div>
                )}
                {view.shared && !terminal && <SharedBadge s={view.shared} to={view.dropoff.label} />}
                {view.span && !terminal && view.status === 'REQUESTED' && <p className="mt-2 text-xs font-semibold text-accent" data-testid="track-span">🕒 {t('booking.slots.pickupSpan', { from: fmt.time(view.span.from) })} <span className="block text-xs font-normal text-muted">{t('booking.slots.mayShift')}</span></p>}
                {view.arrive && !terminal && <p className="mt-2 text-xs font-semibold text-accent" data-testid="track-arrive">🏁 {t('rides.prebookings.arrive', { from: fmt.time(view.arrive.from), to: fmt.time(view.arrive.by) })}</p>}
                {view.flightNumber && !terminal && <p className="mt-2 font-mono text-xs text-muted">✈ {t('track.prebook.flightRow', { flight: formatFlight(view.flightNumber) })}</p>}
                {view.status === 'NO_DRIVER' && view.canRetry && (
                  <p className="mt-1 text-sm text-muted">{t('track.noDriverNote')}</p>
                )}

                {view.vehicle ? (
                  <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-edge bg-elevated p-3">
                    {/* The driver's selfie and the car from the front (2026-11-24): easier to find the car. Not enlarged (operator). */}
                    {view.vehicle.photos?.driver
                      ? <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-edge max-[359px]:hidden" data-testid="track-driver-photo">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/v1/tracking/photo?kind=driver&v=${view.vehicle.photos.driver}`} alt={t('track.photo.driver')} className="h-full w-full object-cover" />
                        </span>
                      : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/20 text-lg max-[359px]:hidden" aria-hidden>🧑‍✈️</div>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{view.vehicle.driverName}</div>
                      <div className="truncate text-sm text-muted">
                        {view.vehicle.rating && <span className="whitespace-nowrap text-accent" aria-label={tp('track.ratingAria', view.vehicle.rating.count, { avg: view.vehicle.rating.average })}>★ {view.vehicle.rating.average.toFixed(1)} · </span>}
                        {vehicleDesc}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-[8px] border border-edge bg-page px-2.5 py-1.5 font-mono text-base font-bold tracking-wide max-[359px]:px-1.5 max-[359px]:text-sm" aria-label={t('track.plateAria', { plate: view.vehicle.plate })}>{view.vehicle.plate}</span>
                    {view.vehicle.photos?.car && (
                      <span className="h-11 w-14 shrink-0 overflow-hidden rounded-[8px] border border-edge" data-testid="track-car-photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/v1/tracking/photo?kind=car&v=${view.vehicle.photos.car}`} alt={t('track.photo.car')} className="h-full w-full object-cover" />
                      </span>
                    )}
                  </div>
                ) : null /* searching: the pulsing pin on the map says it — no «Закрепляем…» box (2026-11-15) */}

              </div>
              <div ref={sheetBodyRef} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-2 sm:p-5 sm:pt-2 ${panelOpen ? '' : 'hidden'}`}>
                {actionError && <p role="alert" className="mb-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{actionError}</p>}

                {/* Confirmation code (operator 2026-11-26): between the driver and the addresses, in ONE row —
                    «Код подтверждения», the switch, then the digits when it is on. */}
                {/* Confirmation code row (the chat button moved above ☰, 2026-11-27). */}
                {!terminal && prePickup && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {prePickup && (
                  <label className="flex min-h-[32px] cursor-pointer items-center gap-2.5" data-testid="start-code-row">
                    <span className="text-[13px] font-semibold">{t('track.startCodeToggle')}</span>
                    <input type="checkbox" role="switch" className="peer sr-only" checked={!!view.startCode} disabled={codeBusy}
                      onChange={(e) => toggleStartCode(e.target.checked)} data-testid="start-code-switch" />
                    <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${view.startCode ? 'bg-accent' : 'bg-edge'} ${codeBusy ? 'opacity-60' : ''}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${view.startCode ? 'start-[18px]' : 'start-0.5'}`} />
                    </span>
                    {view.startCode && (
                      <span className="font-mono text-xl font-bold tracking-[0.25em] text-accent" aria-label={t('track.startCodeAria', { code: view.startCode.split('').join(' ') })}>{view.startCode}</span>
                    )}
                  </label>
                  )}
                  </div>
                )}

                {/* Route (2026-11-15): the same dotted box as when ordering, with room between points;
                    a stop can be added/removed in the middle until the car reaches it. */}
                <TrackRoute onCancel={view.status === 'SEARCHING' && view.canCancel ? () => setConfirmCancel(true) : null} price={terminal ? null : view.shared ? fareRangeText(view.shared.fareCents, 'SHARED_FIXED', (c) => fmt.money(c)) : view.fareCents != null ? fareRangeText(view.fareCents, view.priceType, (c) => fmt.money(c), view.fareMinCents) : null} view={view} editable={!terminal && !view.stop?.arrivedAt && !(view.status === 'NO_DRIVER' && !view.canRetry) && !(view.scheduledAt && view.status !== 'REQUESTED')} canAddStop={!view.shareOptIn && !view.shared} canChangeDropoff={['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(view.status) && !view.shareOptIn && !view.shared} onChanged={load} />
                {liveLocation && dr.estimated && <p className="mt-2 text-xs text-warn" data-testid="gps-approx">📡 {t('track.gpsApprox')}</p>}
                {disconnected && <p className="mt-2 text-xs text-warn">{t('track.livePaused')}</p>}
                {(view.status === 'EN_ROUTE' || view.status === 'ASSIGNED') && !liveLocation && !disconnected && <p className="mt-2 text-xs text-muted">{t('track.etaUnavailable')}</p>}

                {/* actions */}
                {!terminal && (
                  <div className="mt-4 space-y-2">
                    {/* «Позвонить водителю» removed and the chat moved to ☰ (operator 2026-11-26): the call is in the chat header. */}
                    {view.canRetry && (
                      <button className="btn-primary w-full" onClick={retry} disabled={retrying}>
                        {retrying ? t('track.searching') : t('track.searchAgain')}
                      </button>
                    )}
                  </div>
                )}

                {terminal && (
                  <div className="mt-4">
                    {/* Finished ride (operator 2026-11-26), two steps: 1) the whole route on the map + our receipt
                        (amount, share, details); 2) «Готово» → a small rating window on top. */}
                    {view.status === 'COMPLETED' && view.receipt && (
                      <DoneReceipt r={view.receipt} reference={view.reference} from={view.pickup.label} to={view.dropoff.label} stop={view.stop?.label} />
                    )}
                    {view.status === 'COMPLETED' && (ratedNow ?? view.myRating) ? (
                      <div className="mt-3 flex items-center justify-between rounded-[12px] border border-edge bg-elevated px-3 py-2 text-sm">
                        <span className="text-muted">{t('rides.receipt.yourRating')}</span>
                        <span className="text-lg text-accent">{'★'.repeat((ratedNow ?? view.myRating)!)}<span className="text-muted/40">{'★'.repeat(5 - (ratedNow ?? view.myRating)!)}</span></span>
                      </div>
                    ) : null}
                    {view.status === 'COMPLETED' && (
                      <button type="button" className="btn-primary mt-4 w-full" data-testid="done-close"
                        onClick={finishDone}>{t('track.done.close')}</button>
                    )}
                    {view.status === 'COMPLETED' && rateOpen && !(ratedNow ?? view.myRating) && (
                      <RateTripModal postUrl="/tracking/rating" onClose={() => { window.location.href = '/'; }} onDone={(st) => { setRatedNow(st); setRateOpen(false); }} />
                    )}
                    {/* Google review prompt: its own window over everything, right after rating — for every rating,
                        never only for 5★ (Google rules). */}
                    {view.status === 'COMPLETED' && ratedNow ? <GoogleReviewCard modal /> : null}
                    {view.status === 'CANCELED' ? (
                      // Re-order the very same ride (route + stop + class); × above starts a fresh booking.
                      <button type="button" className="btn-primary mt-3 w-full" data-testid="repeat-ride" onClick={repeatSameRide}>{t('track.repeatRide')}</button>
                    ) : null /* No «Заказать ещё поездку» on the finished screen (2026-11-18); × goes to a new booking. */}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {confirmCancel && (() => { const due = (view.lateCancel ?? []).filter((f) => Date.now() >= new Date(f.at).getTime()); const lateFee = due.length ? due.reduce((x, y) => (y.feeCents > x.feeCents ? y : x)) : null; return (
        <ConfirmSheet
          title={t('track.cancelTitle')}
          // A late-cancel fee text only once it applies, and only with card payment (operator 2026-11-26).
          body={lateFee
            // The amount stands out: big, bold, red (operator 2026-11-26).
            ? rich(lateFee.kind === 'prebook'
              ? t('track.cancelBodyPrebookLate', { min: lateFee.beforeMin, fee: '\u0000' })
              : t('track.cancelBodyLate', { name: view.vehicle?.driverName ?? '', min: lateFee.afterMin, fee: '\u0000' }),
              <span className="whitespace-nowrap text-lg font-bold text-danger" data-testid="late-fee">{fmt.money(lateFee.feeCents)}</span>)
            : view.vehicle
            ? (etaText && view.status !== 'ARRIVED' ? t('track.cancelBodyDriverEta', { name: view.vehicle.driverName, eta: etaText }) : t('track.cancelBodyDriver', { name: view.vehicle.driverName }))
            : view.confirmedDriver ? t('track.cancelBodyDriver', { name: view.confirmedDriver.name })
            : t('track.cancelBodySearching')}
          confirmLabel={t('track.cancelConfirm')}
          danger
          busy={cancelling}
          onConfirm={cancel}
          onCancel={() => setConfirmCancel(false)}
        />
      ); })()}
      {safety && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-4 sm:items-center sm:pb-0" onClick={() => setSafety(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="safety-title" className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 id="safety-title" className="text-lg font-bold">{t('track.safetyTitle')}</h2>
            <a href="tel:112" className="mt-4 block w-full rounded-[12px] border border-danger bg-danger/15 px-4 py-3 text-center font-semibold text-danger">{t('track.callEmergency')}</a>
            <div className="mt-4 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
              <div className="text-muted">{t('track.tellThem')}</div>
              <div className="mt-1">{rich(t('track.tripRef', { ref: SLOT }), <span className="font-mono">{view.reference}</span>)}{view.vehicle ? <> · {rich(t('track.carPlate', { car: vehicleDesc, plate: SLOT }), <span className="font-mono font-bold">{view.vehicle.plate}</span>)}</> : null}</div>
              <div className="mt-1 text-muted">{t('track.pickupLine', { label: view.pickup.label })}</div>
            </div>
            <button className="btn-ghost mt-3 w-full" onClick={() => { setSafety(false); share(); }}>{t('track.shareWithSomeone')}</button>
            <button className="mt-2 block w-full text-center text-sm text-muted hover:text-ink" onClick={() => setSafety(false)}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] flex-col bg-page">
      <FixedTop><PassengerTopBar sticky={false} /></FixedTop>
      <div className="flex flex-1 items-center justify-center px-4">{children}</div>
    </div>
  );
}

// Route box on the ride screen (2026-11-15): dots joined by a line like the booking form, roomy
// rows, and the stop in the middle — add one if plans changed, or remove it — while the car has
// not reached it. The estimate is re-quoted on the server; the driver is notified.
type RoutePoint = { lat: number; lng: number; label: string };
function TrackRoute({ view, editable, canAddStop = true, canChangeDropoff = false, onChanged, price, onCancel }: { price?: string | null; onCancel?: (() => void) | null; view: { pickup: RoutePoint; dropoff: RoutePoint; stop?: (RoutePoint & { arrivedAt?: string | null }) | null }; editable: boolean; canAddStop?: boolean; canChangeDropoff?: boolean; onChanged: () => void }) {
  const { t, tError } = useT();
  const [changingDrop, setChangingDrop] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<Selected | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ROW = 52; // a little lower than before (operator 2026-11-26)
  const rows: { key: string; label: string; dot: 'p' | 's' | 'd' }[] = [
    { key: 'p', label: view.pickup.label, dot: 'p' },
    ...(view.stop ? [{ key: 's', label: view.stop.label, dot: 's' as const }] : []),
    { key: 'd', label: view.dropoff.label, dot: 'd' },
  ];
  // «Добавить остановку» is a button under the box now, not a row inside it (operator 2026-11-26: «занимает много места»).
  const canAdd = !view.stop && editable && canAddStop;
  async function save(stop: Selected | null) {
    setBusy(true); setErr(null);
    try {
      if (stop) await api('/tracking/stop', { method: 'POST', body: { lat: stop.lat, lng: stop.lng, label: stop.label } });
      else await api('/tracking/stop', { method: 'DELETE' });
      setPicking(false); setSel(null); setText('');
      onChanged();
    } catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : t('common.somethingWrong')); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-2">
      <div className="relative rounded-[14px] border border-edge-strong bg-elevated px-3">
        <span aria-hidden className="absolute start-[19px] w-[2px]" style={{ top: ROW / 2, height: (rows.length - 1) * (ROW + 1), background: 'rgba(200,255,70,0.45)' }} />
        {rows.map((r, i) => (
          <Fragment key={r.key}>
          {i > 0 && (
            // The divider between two addresses; «＋ Добавить остановку» sits ON it (operator 2026-11-26), so the box stays the same size.
            <div className="relative h-0 border-t border-white/[0.08]">
              {canAdd && i === rows.length - 1 && (
                <button type="button" onClick={() => { setPicking(true); setErr(null); }} data-testid="track-add-stop"
                  className="absolute start-7 top-0 z-10 -translate-y-1/2 bg-elevated px-1.5 text-[11px] font-medium leading-4 text-muted hover:text-ink">＋ {t('booking.form.addStop')}</button>
              )}
            </div>
          )}
          <div className="relative flex items-center gap-3" style={{ minHeight: ROW }}>
            <span className="relative z-10 flex w-4 shrink-0 justify-center" aria-hidden>
              {r.dot === 'p' ? <span className="block h-3.5 w-3.5 rounded-full border-[3px] border-accent bg-elevated" />
                : r.dot === 's' ? <span className="block h-3 w-3 rounded-[3px] bg-[#FFC83D]" />
                : <span className="block h-3.5 w-3.5 rounded-full bg-accent" />}
            </span>
            <span className="min-w-0 flex-1 py-2 text-[15px] font-medium leading-snug text-ink">{r.label}</span>
            {/* «Изменить» the drop-off during the ride (operator 2026-11-27): new price first, then the driver is told. */}
            {r.dot === 'd' && canChangeDropoff && (
              <button type="button" onClick={() => setChangingDrop(true)} data-testid="track-change-dropoff"
                className="shrink-0 rounded-full border border-edge-strong px-3 py-1 text-xs font-medium text-muted hover:text-ink">{t('track.dropoffChange')}</button>
            )}
            {r.dot === 's' && editable && (
              <button type="button" disabled={busy} onClick={() => void save(null)} aria-label={t('booking.form.removeStop')} className="flex h-9 w-8 shrink-0 items-center justify-center text-xl text-muted hover:text-danger">×</button>
            )}
          </div>
          </Fragment>
        ))}
      </div>
      {(price || onCancel) && (
        <div className="mt-2 flex items-center gap-3">
          {price && <p className="min-w-0 flex-1 text-sm text-muted" data-testid="track-price">{rich(t('track.fareLine', { fare: '\u0000' }), <span className="whitespace-nowrap text-[17px] font-bold text-ink">{price}</span>)}</p>}
          {/* While a driver is being searched: «Отменить» right of the price, small, red (operator 2026-11-26). */}
          {onCancel && <button type="button" onClick={onCancel} data-testid="track-cancel-inline"
            className="ms-auto shrink-0 rounded-full border border-danger/50 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10">{t('track.cancelShort')}</button>}
        </div>
      )}
      {err && !picking && <p className="mt-1 text-xs text-danger">{err}</p>}
      {changingDrop && <ChangeDropoffSheet onClose={() => setChangingDrop(false)} onDone={() => { setChangingDrop(false); onChanged(); }} />}
      {picking && (
        <div className="fixed inset-0 z-[70] [&>*]:max-h-[calc(100dvh-1.5rem)] [&>*]:overflow-y-auto flex items-end justify-center bg-black/55 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={t('booking.form.addStop')}
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setPicking(false); }}>
          <div className="card w-full max-w-md p-4" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{t('booking.form.addStop')}</h2>
              <button type="button" onClick={() => setPicking(false)} aria-label={t('track.closeToStart')} className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-muted">×</button>
            </div>
            <div className="mt-3">
              <PlacesInput kind="Stop" value={sel} text={text} onText={setText} onSelect={setSel} autoFocus />
            </div>
            <p className="mt-2 text-xs text-muted">{t('track.stopRepriceNote')}</p>
            {err && <p className="mt-1 text-xs text-danger">{err}</p>}
            <button type="button" className="btn-primary mt-3 w-full" disabled={!sel || busy} onClick={() => sel && void save(sel)}>{busy ? t('common.loading') : t('track.stopAdd')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// New drop-off during the ride (2026-11-27): pick the address → the server re-quotes the whole route →
// the passenger sees the new price (and the old one) → «Подтвердить» applies it and tells the driver.
type DropPreview = { quoteId: string; fareCents: number; priceType: string; oldFareCents: number | null; oldPriceType: string | null; fareMinCents: number | null };
function ChangeDropoffSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, tError, fmt } = useT();
  const [sel, setSel] = useState<Selected | null>(null);
  const [text, setText] = useState('');
  const [prev, setPrev] = useState<DropPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (s: Selected | null) => {
    setSel(s); setPrev(null); setErr(null);
    if (!s) return;
    setBusy(true);
    try { setPrev(await api<DropPreview>('/tracking/dropoff', { method: 'POST', body: { lat: s.lat, lng: s.lng, label: s.label } })); }
    catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : t('common.somethingWrong')); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!sel || !prev) return;
    setBusy(true); setErr(null);
    try { await api('/tracking/dropoff', { method: 'POST', body: { lat: sel.lat, lng: sel.lng, label: sel.label, quoteId: prev.quoteId } }); onDone(); }
    catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : t('common.somethingWrong')); setPrev(null); }
    finally { setBusy(false); }
  };
  const money = (c: number, type: string | null, min?: number | null) => fareRangeText(c, type, (x) => fmt.money(x), min);
  return (
    <div className="fixed inset-0 z-[70] [&>*]:max-h-[calc(100dvh-1.5rem)] [&>*]:overflow-y-auto flex items-end justify-center bg-black/55 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={t('track.dropoffTitle')}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="card w-full max-w-md p-4" style={{ marginBottom: 'env(safe-area-inset-bottom)' }} data-testid="change-dropoff">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t('track.dropoffTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-muted">×</button>
        </div>
        <div className="mt-3">
          <PlacesInput kind="To" value={sel} text={text} onText={setText} onSelect={(s) => void pick(s)} autoFocus />
        </div>
        {busy && !prev && <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>}
        {prev && (
          <div className="mt-3 rounded-[12px] border border-edge-strong bg-elevated p-3" data-testid="dropoff-price">
            <div className="text-[17px] font-bold text-ink">{t('track.dropoffNewPrice', { fare: money(prev.fareCents, prev.priceType, prev.fareMinCents) })}</div>
            {prev.oldFareCents != null && <div className="mt-0.5 text-sm text-muted">{t('track.dropoffWas', { fare: money(prev.oldFareCents, prev.oldPriceType, prev.fareMinCents) })}</div>}
            <p className="mt-2 text-xs text-muted">{t('track.dropoffNote')}</p>
          </div>
        )}
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <button type="button" className="btn-primary mt-3 min-h-[52px] w-full" disabled={!prev || busy} onClick={() => void confirm()} data-testid="dropoff-confirm">
          {busy && prev ? t('common.loading') : t('track.dropoffConfirm')}
        </button>
      </div>
    </div>
  );
}
