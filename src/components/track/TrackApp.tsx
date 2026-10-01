'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { Logo } from '@/components/Brand';
import { ChatPanel } from '@/components/ChatPanel';
import { NotifyToggle } from '@/components/NotifyToggle';
import { api, ApiRequestError } from '@/lib/api-client';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { useT } from '@/i18n/I18nProvider';
import type { MsgKey } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

interface TrackView {
  reference: string;
  status: string;
  revision: number;
  scheduledAt: string | null;
  pickup: { lat: number; lng: number; label: string };
  dropoff: { lat: number; lng: number; label: string };
  passengerName: string;
  vClass: string;
  passengerCount: number;
  fareWording: string;
  vehicle: null | { driverName: string; make: string; model: string; color: string; plate: string; vClass: string; phone: string | null; rating: { average: number; count: number } | null };
  location: null | { lat: number; lng: number; freshness: string; poorAccuracy: boolean; sampledAt: string };
  pickupEta: string | null;
  pickupEtaMin: number | null;
  pickupEtaApprox: boolean;
  fareCents: number | null;
  startCode: string | null;
  waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null;
  receipt: null | { estimateCents: number | null; waitingCents: number; finalCents: number | null; currency: string; priceType: string; paymentMethod: string; paymentStatus: string };
  canCancel: boolean;
  canRetry: boolean;
  timeline: { type: string; at: string; status: string | null }[];
}

const TIMELINE_KEYS = new Set([
  'CREATED', 'SCHEDULED_PROMOTED', 'RESEARCH', 'SEARCH_REPAIRED', 'REMATCH', 'OFFERED', 'OFFER_ACCEPTED', 'ASSIGNED', 'REASSIGNED',
  'UNASSIGNED', 'ARRIVED', 'TRIP_STARTED', 'COMPLETED', 'NO_DRIVER', 'CANCELED', 'TERMINATED', 'STATUS_SEARCHING', 'STATUS_NO_DRIVER',
  'STATUS_ASSIGNED', 'STATUS_EN_ROUTE', 'STATUS_ARRIVED', 'STATUS_IN_PROGRESS', 'STATUS_COMPLETED', 'STATUS_CANCELED',
]);
const STATUS_KEYS = new Set(['REQUESTED', 'SEARCHING', 'NO_DRIVER', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']);

// Render a translated template whose {slot} placeholder is a React node (e.g. a styled span).
function rich(template: string, node: React.ReactNode): React.ReactNode {
  const [before, after = ''] = template.split('\u0000');
  return <>{before}{node}{after}</>;
}
export default function TrackApp() {
  const { t, tp, fmt, tError } = useT();
  const [view, setView] = useState<TrackView | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'noauth' | 'error'>('loading');
  const [reconnecting, setReconnecting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [safety, setSafety] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [routeLine, setRouteLine] = useState<[number, number][]>([]); // [lng,lat] driver→pickup / →destination
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
    if (m) {
      tokenRef.current = decodeURIComponent(m[1]);
      history.replaceState(null, '', window.location.pathname); // strip token from the address bar
    }
    bootstrap();
  }, [bootstrap]);

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

  // Draw the live driving route the passenger's driver is following: driver→pickup while
  // EN_ROUTE, driver→destination once the trip is IN_PROGRESS. Recomputed when the driver
  // moves meaningfully (coarse key) or the leg changes; bounded by the 5s poll cadence.
  const drvLoc = disconnected ? null : view?.location ?? null;
  const rleg = view?.status === 'IN_PROGRESS' ? 'dropoff' : view?.status === 'EN_ROUTE' || view?.status === 'ASSIGNED' ? 'pickup' : null;
  const routeKey = drvLoc && rleg ? `${rleg}:${drvLoc.lat.toFixed(4)},${drvLoc.lng.toFixed(4)}` : '';
  useEffect(() => {
    if (!view || !drvLoc || !rleg) { setRouteLine([]); return; }
    const to = rleg === 'dropoff' ? view.dropoff : view.pickup;
    let alive = true;
    (async () => {
      try {
        const r = await api<{ available?: boolean; path?: [number, number][] }>('/routes/estimate', {
          method: 'POST', body: { from: { lat: drvLoc.lat, lng: drvLoc.lng }, to: { lat: to.lat, lng: to.lng } }, timeoutMs: 9000,
        });
        if (alive && r.available !== false && r.path) setRouteLine(r.path.map(([la, ln]) => [ln, la] as [number, number]));
        else if (alive) setRouteLine([]);
      } catch { /* keep last geometry */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  async function cancel() {
    if (!view) return;
    setCancelling(true); setActionError(null);
    try {
      await api('/tracking/cancel', { method: 'POST', body: { expectedRevision: view.revision } });
      setConfirmCancel(false);
      await load();
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

  // Tick the pickup-waiting timer once per second while the driver is waiting.
  const arrived = view?.status === 'ARRIVED';
  useEffect(() => {
    if (!arrived) return;
    setNowMs(Date.now());
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [arrived]);

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
  const liveLocation = disconnected ? null : view.location;
  const markers: MapMarker[] = [];
  // Before pickup, anchor on the pickup; during the trip, anchor on the destination.
  if (view.status === 'IN_PROGRESS') markers.push({ id: 'd', lat: view.dropoff.lat, lng: view.dropoff.lng, kind: 'dropoff', label: view.dropoff.label });
  else markers.push({ id: 'p', lat: view.pickup.lat, lng: view.pickup.lng, kind: 'pickup', label: view.pickup.label });
  if (liveLocation) markers.push({ id: 'v', lat: liveLocation.lat, lng: liveLocation.lng, kind: 'vehicle', label: t('track.yourDriver'), stale: liveLocation.freshness === 'stale' });

  const etaMinText = view.pickupEtaMin != null ? tp('common.minutes', view.pickupEtaMin) : null;
  const etaText = !disconnected && etaMinText ? (view.pickupEtaApprox ? t('track.etaApprox', { min: etaMinText }) : etaMinText) : null;
  const statusLabel = STATUS_KEYS.has(view.status) ? t(`common.status.${view.status}` as MsgKey) : view.status;
  const headline =
    (view.status === 'EN_ROUTE' || view.status === 'ASSIGNED') && view.vehicle
      ? (etaText ? t('track.meetDriverEta', { name: view.vehicle.driverName, eta: etaText }) : t('track.meetDriver', { name: view.vehicle.driverName }))
      : statusLabel;
  const vehicleDesc = view.vehicle ? `${view.vehicle.color} ${view.vehicle.make} ${view.vehicle.model}` : '';
  const SLOT = '\u0000';

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      <header className="z-20 flex items-center justify-between border-b border-edge bg-page/90 px-4 py-3 backdrop-blur">
        <Logo />
        <div className="flex items-center gap-3">
          <LanguageSwitcher compact />
          <a href="/" className="text-sm text-muted hover:text-ink">{t('common.book')}</a>
        </div>
      </header>

      <div className="relative flex-1">
        <div className="absolute inset-0">
          <AutoMapView markers={markers} route={routeLine.length ? routeLine : undefined} center={view.pickup} zoom={12} interactive className="h-full w-full" />
        </div>

        {/* status pill */}
        <div className="absolute left-4 top-4 z-10 max-w-[70%]">
          <span className="chip !bg-page/90 !text-accent">
            {view.status === 'EN_ROUTE' ? `● ${t('track.pillEnRoute')}` : `● ${statusLabel.toUpperCase()}`}
          </span>
          {reconnecting && <span className="chip ml-2 !bg-page/90 !text-warn">{t('track.reconnecting')}</span>}
        </div>

        {/* bottom sheet */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end sm:block">
          <div className="pointer-events-auto w-full sm:absolute sm:bottom-4 sm:left-4 sm:w-[400px]">
            <div className="card flex max-h-[78dvh] flex-col overflow-hidden sm:max-h-[calc(100dvh-7rem)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              {/* Pinned: what the passenger needs at pickup (status, driver/plate, start code). */}
              <div className="shrink-0 border-b border-edge p-4 pb-3 sm:p-5 sm:pb-3">
                <h1 className="text-xl font-bold" role="status" aria-live="polite">{headline}</h1>
                {view.status === 'REQUESTED' && (
                  <p className="mt-1 text-sm text-muted">{t('track.scheduledNote')}</p>
                )}
                {view.status === 'SEARCHING' && (
                  <p className="mt-1 text-sm text-muted">{t('track.searchingNote')}</p>
                )}
                {view.status === 'NO_DRIVER' && (
                  <p className="mt-1 text-sm text-muted">{t('track.noDriverNote')}</p>
                )}

                {view.vehicle ? (
                  <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-edge bg-elevated p-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/20 text-lg" aria-hidden>🧑‍✈️</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{view.vehicle.driverName}</div>
                      <div className="truncate text-sm text-muted">
                        {view.vehicle.rating && <span className="whitespace-nowrap text-accent" aria-label={tp('track.ratingAria', view.vehicle.rating.count, { avg: view.vehicle.rating.average })}>★ {view.vehicle.rating.average.toFixed(1)} · </span>}
                        {vehicleDesc}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-[8px] border border-edge bg-page px-2.5 py-1.5 font-mono text-base font-bold tracking-wide" aria-label={t('track.plateAria', { plate: view.vehicle.plate })}>{view.vehicle.plate}</span>
                  </div>
                ) : view.status === 'SEARCHING' ? (
                  <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm text-muted">
                    <span className="inline-block h-3 w-3 animate-ping rounded-full bg-accent" />
                    {t('track.reserving')}
                  </div>
                ) : null}

                {/* start code — shown to the driver at pickup */}
                {view.startCode && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] border border-accent/50 bg-accent/10 px-3 py-2">
                    <div className="text-xs text-muted">{t('track.startCodeHint')}</div>
                    <div className="font-mono text-2xl font-bold tracking-[0.3em] text-accent" aria-label={t('track.startCodeAria', { code: view.startCode.split('').join(' ') })}>{view.startCode}</div>
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-3 sm:p-5 sm:pt-3">
                {actionError && <p role="alert" className="mb-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{actionError}</p>}

                {/* pickup waiting timer (after arrival) */}
                {view.status === 'ARRIVED' && view.waiting && (() => {
                  const elapsed = Math.max(0, Math.floor((nowMs - new Date(view.waiting.arrivedAt).getTime()) / 1000));
                  const freeLeft = Math.max(0, view.waiting.graceSeconds - elapsed);
                  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
                  return (
                    <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                      {freeLeft > 0
                        ? <span>{rich(t('track.waitingFree', { time: SLOT }), <span className="font-mono text-accent">{mmss(freeLeft)}</span>)}</span>
                        : <span className="text-warn">{view.waiting.paidRateCentsPerMin > 0 ? t('track.waitingElapsedPaid', { rate: fmt.money(view.waiting.paidRateCentsPerMin) }) : t('track.waitingElapsed')}</span>}
                    </div>
                  );
                })()}

                {/* stops */}
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">{t('track.pickup')}</span><span className="ml-auto truncate font-medium">{view.pickup.label}</span></div>
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">{t('track.destination')}</span><span className="ml-auto truncate font-medium">{view.dropoff.label}</span></div>
                </div>

                {liveLocation && (
                  <p className="mt-2 text-xs text-muted">
                    {t(liveLocation.poorAccuracy ? 'track.locationLineLowAcc' : 'track.locationLine', {
                      freshness: ['fresh', 'stale', 'disconnected'].includes(liveLocation.freshness) ? t(`track.freshness.${liveLocation.freshness}` as MsgKey) : liveLocation.freshness,
                      time: fmt.time(liveLocation.sampledAt),
                    })}
                  </p>
                )}
                {disconnected && <p className="mt-2 text-xs text-warn">{t('track.livePaused')}</p>}
                {(view.status === 'EN_ROUTE' || view.status === 'ASSIGNED') && !liveLocation && !disconnected && <p className="mt-2 text-xs text-muted">{t('track.etaUnavailable')}</p>}

                {/* actions */}
                {!terminal && (
                  <div className="mt-4 space-y-2">
                    <NotifyToggle pushUrl="/tracking/push" className="pb-1" />
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="btn-ghost !min-h-[44px] text-sm" onClick={share}>{t('track.shareTrip')}</button>
                      <button type="button" className="btn-ghost !min-h-[44px] text-sm" onClick={() => setSafety(true)}>{t('track.safety')}</button>
                    </div>
                    {shareMsg && <p role="status" className="text-xs text-muted">{shareMsg}</p>}
                    {view.vehicle?.phone && (
                      <a href={`tel:${view.vehicle.phone}`} className="btn-primary w-full">{t('track.callDriver')}</a>
                    )}
                    {view.vehicle && (
                      <ChatPanel listUrl="/tracking/messages" postUrl="/tracking/messages" pushUrl="/tracking/push" me="PASSENGER" peerLabel="driver" />
                    )}
                    <button className="w-full text-sm text-muted hover:text-ink" onClick={() => setShowDetails((s) => !s)}>
                      {showDetails ? t('track.hideDetails') : t('track.showDetails')}
                    </button>
                    {showDetails && (
                      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-xs text-muted">
                        <div>{rich(t('track.reference', { ref: SLOT }), <span className="font-mono text-ink">{view.reference}</span>)}</div>
                        <div className="mt-1">{t('track.classLine', { vClass: view.vClass === 'COMFORT' || view.vClass === 'XL' ? t(`common.vClass.${view.vClass}`) : view.vClass, passengers: tp('common.passengers', view.passengerCount) })}</div>
                        <div className="mt-1">{t('track.fareLine', { fare: view.fareCents != null ? t('track.fareMetered', { amount: fmt.money(view.fareCents) }) : view.fareWording })}</div>
                        <ul className="mt-2 space-y-1">
                          {view.timeline.map((ev, i) => (
                            <li key={i}>{t('track.timelineEntry', {
                              event: TIMELINE_KEYS.has(ev.type) ? t(`track.timeline.${ev.type}` as MsgKey) : ev.type.replace(/_/g, ' ').toLowerCase(),
                              time: fmt.time(ev.at),
                            })}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {view.canRetry && (
                      <button className="btn-primary w-full" onClick={retry} disabled={retrying}>
                        {retrying ? t('track.searching') : t('track.searchAgain')}
                      </button>
                    )}
                    {view.canCancel && (
                      <button className="w-full rounded-[12px] border border-danger/40 px-4 py-2.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50" onClick={() => setConfirmCancel(true)} disabled={cancelling}>
                        {cancelling ? t('track.cancelling') : t('track.cancelBooking')}
                      </button>
                    )}
                  </div>
                )}

                {terminal && (
                  <div className="mt-4">
                    {view.status === 'COMPLETED' && view.receipt ? (
                      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                        <div className="mb-2 font-semibold">{t('track.receiptTitle')}</div>
                        {view.receipt.estimateCents != null && (
                          <div className="flex justify-between"><span className="text-muted">{t('track.fareEstimate')}</span><span>{fmt.money(view.receipt.estimateCents, view.receipt.currency)}</span></div>
                        )}
                        {view.receipt.waitingCents > 0 && (
                          <div className="flex justify-between"><span className="text-muted">{t('track.waiting')}</span><span>{fmt.money(view.receipt.waitingCents, view.receipt.currency)}</span></div>
                        )}
                        <div className="mt-2 border-t border-edge pt-2 text-xs text-muted">
                          {view.receipt.priceType === 'REGULATED_METER_ESTIMATE'
                            ? t('track.receiptMeterNote')
                            : t('track.receiptQuoted')}
                        </div>
                        <div className="mt-1 flex justify-between text-xs text-muted">
                          <span>{t('track.paymentLine', { method: view.receipt.paymentMethod === 'CASH_TO_DRIVER' ? t('track.paymentCash') : view.receipt.paymentMethod })}</span>
                          <span>{view.receipt.paymentStatus === 'PENDING' ? t('track.toBeCollected') : t('track.collected')}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                        {view.status === 'COMPLETED' ? t('track.thanks') : t('track.canceledNote')}
                      </div>
                    )}
                    <a href="/" className="btn-primary mt-3 w-full">{t('track.bookAnother')}</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {confirmCancel && (
        <ConfirmSheet
          title={t('track.cancelTitle')}
          body={view.vehicle
            ? (etaText ? t('track.cancelBodyDriverEta', { name: view.vehicle.driverName, eta: etaText }) : t('track.cancelBodyDriver', { name: view.vehicle.driverName }))
            : t('track.cancelBodySearching')}
          confirmLabel={t('track.cancelConfirm')}
          danger
          busy={cancelling}
          onConfirm={cancel}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
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
  return <div className="flex h-[100dvh] items-center justify-center bg-page px-4">{children}</div>;
}
