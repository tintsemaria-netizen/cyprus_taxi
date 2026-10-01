'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { Logo } from '@/components/Brand';
import { ChatPanel } from '@/components/ChatPanel';
import { NotifyToggle } from '@/components/NotifyToggle';
import { api, ApiRequestError } from '@/lib/api-client';
import { ConfirmSheet } from '@/components/ConfirmSheet';

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
  pickupEtaMin?: number | null;
  fareCents: number | null;
  startCode: string | null;
  waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null;
  receipt: null | { estimateCents: number | null; waitingCents: number; finalCents: number | null; currency: string; priceType: string; paymentMethod: string; paymentStatus: string };
  canCancel: boolean;
  canRetry: boolean;
  timeline: { type: string; at: string; status: string | null }[];
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Scheduled ride',
  SEARCHING: 'Finding you a driver',
  NO_DRIVER: 'No drivers available',
  ASSIGNED: 'Driver assigned',
  EN_ROUTE: 'Driver on the way',
  ARRIVED: 'Driver has arrived',
  IN_PROGRESS: 'On the trip',
  COMPLETED: 'Trip completed',
  CANCELED: 'Booking canceled',
};

export default function TrackApp() {
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
      setActionError(e instanceof ApiRequestError ? e.body.message : 'Could not cancel — check your connection and try again.');
    } finally {
      setCancelling(false);
    }
  }

  // Read-only "share my trip" link for family/friends: position, driver and car only.
  async function share() {
    setShareMsg(null);
    try {
      const r = await api<{ url: string }>('/tracking/share', { method: 'POST' });
      const text = 'Follow my IL-Y ride live';
      if (typeof navigator !== 'undefined' && navigator.share) {
        try { await navigator.share({ title: 'My IL-Y ride', text, url: r.url }); return; } catch { /* dismissed — fall back to copy */ }
      }
      await navigator.clipboard.writeText(r.url);
      setShareMsg('Link copied — it shows your car and live position only, and stops when the trip ends.');
    } catch (e) {
      setShareMsg(e instanceof ApiRequestError ? e.body.message : 'Could not create a share link. Try again.');
    }
  }

  // Tick the pickup-waiting timer once per second while the driver is waiting.
  const arrived = view?.status === 'ARRIVED';
  useEffect(() => {
    if (!arrived) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [arrived]);

  async function retry() {
    if (!view) return;
    setRetrying(true);
    try {
      await api('/tracking/research', { method: 'POST', body: { expectedRevision: view.revision } });
      await load();
    } catch (e) {
      setActionError(e instanceof ApiRequestError ? e.body.message : 'Could not search again — check your connection.');
    } finally {
      setRetrying(false);
    }
  }

  if (phase === 'loading') {
    return <Centered><div className="animate-pulse text-muted">Loading your ride…</div></Centered>;
  }
  if (phase === 'noauth') {
    return (
      <Centered>
        <div className="card max-w-sm p-6 text-center">
          <Logo className="mb-4 justify-center" />
          <h1 className="text-lg font-semibold">No active ride here</h1>
          <p className="mt-2 text-sm text-muted">Open your private tracking link, or book a new ride.</p>
          <a href="/" className="btn-primary mt-4 w-full">Book a ride</a>
        </div>
      </Centered>
    );
  }
  if (phase === 'error') {
    return (
      <Centered>
        <div className="card max-w-sm p-6 text-center">
          <Logo className="mb-4 justify-center" />
          <h1 className="text-lg font-semibold">Can&apos;t reach the server</h1>
          <p className="mt-2 text-sm text-muted">Check your connection and try again. Your booking is safe.</p>
          <button className="btn-primary mt-4 w-full" onClick={() => { setPhase('loading'); bootstrap(); }}>Retry</button>
          <a href="/" className="mt-3 block text-sm text-muted hover:text-ink">Book a new ride</a>
        </div>
      </Centered>
    );
  }
  if (!view) {
    return <Centered><div className="text-muted">Reconnecting…</div></Centered>;
  }

  const terminal = view.status === 'COMPLETED' || view.status === 'CANCELED';
  // While disconnected we suppress the live vehicle position/ETA entirely — a stale
  // marker must never look current.
  const liveLocation = disconnected ? null : view.location;
  const markers: MapMarker[] = [];
  // Before pickup, anchor on the pickup; during the trip, anchor on the destination.
  if (view.status === 'IN_PROGRESS') markers.push({ id: 'd', lat: view.dropoff.lat, lng: view.dropoff.lng, kind: 'dropoff', label: view.dropoff.label });
  else markers.push({ id: 'p', lat: view.pickup.lat, lng: view.pickup.lng, kind: 'pickup', label: view.pickup.label });
  if (liveLocation) markers.push({ id: 'v', lat: liveLocation.lat, lng: liveLocation.lng, kind: 'vehicle', label: 'Your driver', stale: liveLocation.freshness === 'stale' });

  const etaText = !disconnected && view.pickupEta && view.pickupEta.includes('min') ? view.pickupEta.replace('≈ ', '').replace(' (estimate)', '') : null;
  const headline =
    (view.status === 'EN_ROUTE' || view.status === 'ASSIGNED') && view.vehicle
      ? `Meet ${view.vehicle.driverName}${etaText ? ' — ' + etaText : ''}`
      : STATUS_LABEL[view.status] ?? view.status;

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      <header className="z-20 flex items-center justify-between border-b border-edge bg-page/90 px-4 py-3 backdrop-blur">
        <Logo />
        <a href="/" className="text-sm text-muted hover:text-ink">Book</a>
      </header>

      <div className="relative flex-1">
        <div className="absolute inset-0">
          <AutoMapView markers={markers} route={routeLine.length ? routeLine : undefined} center={view.pickup} zoom={12} interactive className="h-full w-full" />
        </div>

        {/* status pill */}
        <div className="absolute left-4 top-4 z-10 max-w-[70%]">
          <span className="chip !bg-page/90 !text-accent">
            {view.status === 'EN_ROUTE' ? '● DRIVER ON THE WAY' : `● ${(STATUS_LABEL[view.status] ?? view.status).toUpperCase()}`}
          </span>
          {reconnecting && <span className="chip ml-2 !bg-page/90 !text-warn">Reconnecting…</span>}
        </div>

        {/* bottom sheet */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end sm:block">
          <div className="pointer-events-auto w-full sm:absolute sm:bottom-4 sm:left-4 sm:w-[400px]">
            <div className="card flex max-h-[78dvh] flex-col overflow-hidden sm:max-h-[calc(100dvh-7rem)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              {/* Pinned: what the passenger needs at pickup (status, driver/plate, start code). */}
              <div className="shrink-0 border-b border-edge p-4 pb-3 sm:p-5 sm:pb-3">
                <h1 className="text-xl font-bold" role="status" aria-live="polite">{headline}</h1>
                {view.status === 'REQUESTED' && (
                  <p className="mt-1 text-sm text-muted">Scheduled request — we’ll dispatch a driver near your pickup time.</p>
                )}
                {view.status === 'SEARCHING' && (
                  <p className="mt-1 text-sm text-muted">Matching you with the nearest available driver…</p>
                )}
                {view.status === 'NO_DRIVER' && (
                  <p className="mt-1 text-sm text-muted">No drivers are free nearby right now. You can search again or cancel.</p>
                )}

                {view.vehicle ? (
                  <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-edge bg-elevated p-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/20 text-lg" aria-hidden>🧑‍✈️</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{view.vehicle.driverName}</div>
                      <div className="truncate text-sm text-muted">
                        {view.vehicle.rating && <span className="whitespace-nowrap text-accent" aria-label={`Rated ${view.vehicle.rating.average} out of 5 from ${view.vehicle.rating.count} trips`}>★ {view.vehicle.rating.average.toFixed(1)} · </span>}
                        {view.vehicle.color} {view.vehicle.make} {view.vehicle.model}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-[8px] border border-edge bg-page px-2.5 py-1.5 font-mono text-base font-bold tracking-wide" aria-label={`Number plate ${view.vehicle.plate}`}>{view.vehicle.plate}</span>
                  </div>
                ) : view.status === 'SEARCHING' ? (
                  <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm text-muted">
                    <span className="inline-block h-3 w-3 animate-ping rounded-full bg-accent" />
                    Reserving the nearest driver for you…
                  </div>
                ) : null}

                {/* start code — shown to the driver at pickup */}
                {view.startCode && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] border border-accent/50 bg-accent/10 px-3 py-2">
                    <div className="text-xs text-muted">Give this code to your driver when you get in</div>
                    <div className="font-mono text-2xl font-bold tracking-[0.3em] text-accent" aria-label={`Start code ${view.startCode.split('').join(' ')}`}>{view.startCode}</div>
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
                        ? <span>Your driver is waiting · <span className="font-mono text-accent">{mmss(freeLeft)}</span> free time left</span>
                        : <span className="text-warn">Free waiting time elapsed{view.waiting.paidRateCentsPerMin > 0 ? ` · €${(view.waiting.paidRateCentsPerMin / 100).toFixed(2)}/min applies` : ''}.</span>}
                    </div>
                  );
                })()}

                {/* stops */}
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">Pickup</span><span className="ml-auto truncate font-medium">{view.pickup.label}</span></div>
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">Destination</span><span className="ml-auto truncate font-medium">{view.dropoff.label}</span></div>
                </div>

                {liveLocation && (
                  <p className="mt-2 text-xs text-muted">
                    Location {liveLocation.freshness}{liveLocation.poorAccuracy ? ' · low accuracy' : ''} · updated {new Date(liveLocation.sampledAt).toLocaleTimeString('en-GB')}
                  </p>
                )}
                {disconnected && <p className="mt-2 text-xs text-warn">Live position paused — reconnecting…</p>}
                {(view.status === 'EN_ROUTE' || view.status === 'ASSIGNED') && !liveLocation && !disconnected && <p className="mt-2 text-xs text-muted">ETA unavailable — waiting for the driver&apos;s GPS.</p>}

                {/* actions */}
                {!terminal && (
                  <div className="mt-4 space-y-2">
                    <NotifyToggle pushUrl="/tracking/push" className="pb-1" />
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="btn-ghost !min-h-[44px] text-sm" onClick={share}>↗ Share trip</button>
                      <button type="button" className="btn-ghost !min-h-[44px] text-sm" onClick={() => setSafety(true)}>🛡 Safety</button>
                    </div>
                    {shareMsg && <p role="status" className="text-xs text-muted">{shareMsg}</p>}
                    {view.vehicle?.phone && (
                      <a href={`tel:${view.vehicle.phone}`} className="btn-primary w-full">📞 Call driver</a>
                    )}
                    {view.vehicle && (
                      <ChatPanel listUrl="/tracking/messages" postUrl="/tracking/messages" pushUrl="/tracking/push" me="PASSENGER" peerLabel="driver" />
                    )}
                    <button className="w-full text-sm text-muted hover:text-ink" onClick={() => setShowDetails((s) => !s)}>
                      {showDetails ? 'Hide trip details' : 'Trip details ›'}
                    </button>
                    {showDetails && (
                      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-xs text-muted">
                        <div>Reference: <span className="font-mono text-ink">{view.reference}</span></div>
                        <div className="mt-1">Class: {view.vClass} · {view.passengerCount} passenger(s)</div>
                        <div className="mt-1">Fare: {view.fareCents != null ? `≈ €${(view.fareCents / 100).toFixed(2)} (metered estimate)` : view.fareWording}</div>
                        <ul className="mt-2 space-y-1">
                          {view.timeline.map((t, i) => (
                            <li key={i}>· {t.type.replace(/_/g, ' ').toLowerCase()} — {new Date(t.at).toLocaleTimeString('en-GB')}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {view.canRetry && (
                      <button className="btn-primary w-full" onClick={retry} disabled={retrying}>
                        {retrying ? 'Searching…' : 'Search again'}
                      </button>
                    )}
                    {view.canCancel && (
                      <button className="w-full rounded-[12px] border border-danger/40 px-4 py-2.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50" onClick={() => setConfirmCancel(true)} disabled={cancelling}>
                        {cancelling ? 'Cancelling…' : 'Cancel booking'}
                      </button>
                    )}
                  </div>
                )}

                {terminal && (
                  <div className="mt-4">
                    {view.status === 'COMPLETED' && view.receipt ? (
                      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                        <div className="mb-2 font-semibold">Trip receipt</div>
                        {view.receipt.estimateCents != null && (
                          <div className="flex justify-between"><span className="text-muted">Fare estimate</span><span>€{(view.receipt.estimateCents / 100).toFixed(2)}</span></div>
                        )}
                        {view.receipt.waitingCents > 0 && (
                          <div className="flex justify-between"><span className="text-muted">Waiting</span><span>€{(view.receipt.waitingCents / 100).toFixed(2)}</span></div>
                        )}
                        <div className="mt-2 border-t border-edge pt-2 text-xs text-muted">
                          {view.receipt.priceType === 'REGULATED_METER_ESTIMATE'
                            ? 'Estimate only — the final regulated meter amount is settled with the driver.'
                            : 'Fare as quoted.'}
                        </div>
                        <div className="mt-1 flex justify-between text-xs text-muted">
                          <span>Payment: {view.receipt.paymentMethod === 'CASH_TO_DRIVER' ? 'cash to driver' : view.receipt.paymentMethod}</span>
                          <span>{view.receipt.paymentStatus === 'PENDING' ? 'to be collected' : 'collected'}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                        {view.status === 'COMPLETED' ? 'Thanks for riding with IL-Y.' : 'This booking was canceled.'}
                      </div>
                    )}
                    <a href="/" className="btn-primary mt-3 w-full">Book another ride</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {confirmCancel && (
        <ConfirmSheet
          title="Cancel this ride?"
          body={view.vehicle ? <>Your driver {view.vehicle.driverName} will be notified{etaText ? ` (they are ${etaText} away)` : ''}. There is no cancellation fee.</> : 'We will stop looking for a driver. There is no cancellation fee.'}
          confirmLabel="Cancel ride"
          danger
          busy={cancelling}
          onConfirm={cancel}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
      {safety && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-4 sm:items-center sm:pb-0" onClick={() => setSafety(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="safety-title" className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 id="safety-title" className="text-lg font-bold">Safety</h2>
            <a href="tel:112" className="mt-4 block w-full rounded-[12px] border border-danger bg-danger/15 px-4 py-3 text-center font-semibold text-danger">Call emergency services · 112</a>
            <div className="mt-4 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
              <div className="text-muted">Tell them</div>
              <div className="mt-1">Trip <span className="font-mono">{view.reference}</span>{view.vehicle ? <> · {view.vehicle.color} {view.vehicle.make} {view.vehicle.model}, plate <span className="font-mono font-bold">{view.vehicle.plate}</span></> : null}</div>
              <div className="mt-1 text-muted">Pickup: {view.pickup.label}</div>
            </div>
            <button className="btn-ghost mt-3 w-full" onClick={() => { setSafety(false); share(); }}>↗ Share trip with someone</button>
            <button className="mt-2 block w-full text-center text-sm text-muted hover:text-ink" onClick={() => setSafety(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[100dvh] items-center justify-center bg-page px-4">{children}</div>;
}
