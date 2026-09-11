'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MapView, { MapMarker } from '@/components/MapView';
import { Logo } from '@/components/Brand';
import { api, ApiRequestError } from '@/lib/api-client';

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
  vehicle: null | { driverName: string; make: string; model: string; color: string; plate: string; vClass: string; phone: string | null };
  location: null | { lat: number; lng: number; freshness: string; poorAccuracy: boolean; sampledAt: string };
  pickupEta: string | null;
  canCancel: boolean;
  timeline: { type: string; at: string; status: string | null }[];
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Waiting for dispatcher',
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

  async function cancel() {
    if (!view) return;
    if (!confirm('Cancel this booking?')) return;
    setCancelling(true);
    try {
      await api('/tracking/cancel', { method: 'POST', body: { expectedRevision: view.revision } });
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) alert(e.body.message);
    } finally {
      setCancelling(false);
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
  const markers: MapMarker[] = [{ id: 'p', lat: view.pickup.lat, lng: view.pickup.lng, kind: 'pickup', label: view.pickup.label }];
  if (liveLocation) markers.push({ id: 'v', lat: liveLocation.lat, lng: liveLocation.lng, kind: 'vehicle', label: 'Your driver', stale: liveLocation.freshness === 'stale' });

  const headline =
    view.status === 'EN_ROUTE' && view.vehicle
      ? `Meet ${view.vehicle.driverName}${!disconnected && view.pickupEta && view.pickupEta.includes('min') ? ' — ' + view.pickupEta.replace('≈ ', '').replace(' (estimate)', '') : ''}`
      : STATUS_LABEL[view.status] ?? view.status;

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      <header className="z-20 flex items-center justify-between border-b border-edge bg-page/90 px-4 py-3 backdrop-blur">
        <Logo />
        <a href="/" className="text-sm text-muted hover:text-ink">Book</a>
      </header>

      <div className="relative flex-1">
        <div className="absolute inset-0">
          <MapView markers={markers} center={view.pickup} zoom={12} interactive className="h-full w-full" />
        </div>

        {/* status pill */}
        <div className="absolute left-4 top-4 z-10 max-w-[70%]">
          <span className="chip !bg-page/90 !text-accent">
            {view.status === 'EN_ROUTE' ? '● DRIVER ON THE WAY' : `● ${(STATUS_LABEL[view.status] ?? view.status).toUpperCase()}`}
          </span>
          {reconnecting && <span className="chip ml-2 !bg-page/90 !text-warn">Reconnecting…</span>}
        </div>

        {/* bottom sheet */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end sm:block">
          <div className="pointer-events-auto w-full sm:absolute sm:bottom-4 sm:left-4 sm:w-[400px]">
            <div className="card overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <div className="p-4 sm:p-5">
                <h1 className="text-xl font-bold">{headline}</h1>
                {view.status === 'REQUESTED' && (
                  <p className="mt-1 text-sm text-muted">
                    {view.scheduledAt ? 'Scheduled request — awaiting dispatcher.' : 'We’re finding you a driver.'}
                  </p>
                )}

                {view.vehicle ? (
                  <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-edge bg-elevated p-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/20 text-lg">🧑‍✈️</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{view.vehicle.driverName}</div>
                      <div className="truncate text-xs text-muted">{view.vehicle.color} {view.vehicle.make} {view.vehicle.model}</div>
                    </div>
                    <span className="rounded-[8px] border border-edge px-2 py-1 text-xs font-mono">{view.vehicle.plate}</span>
                  </div>
                ) : !terminal ? (
                  <div className="mt-4 rounded-[12px] border border-edge bg-elevated p-3 text-sm text-muted">
                    No driver reserved yet — a dispatcher will assign one shortly.
                  </div>
                ) : null}

                {/* stops */}
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">Pickup</span><span className="ml-auto truncate font-medium">{view.pickup.label}</span></div>
                  <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">Destination</span><span className="ml-auto truncate font-medium">{view.dropoff.label}</span></div>
                </div>

                {liveLocation && (
                  <p className="mt-2 text-[11px] text-muted">
                    Location {liveLocation.freshness}{liveLocation.poorAccuracy ? ' · low accuracy' : ''} · updated {new Date(liveLocation.sampledAt).toLocaleTimeString('en-GB')}
                  </p>
                )}
                {disconnected && <p className="mt-2 text-[11px] text-warn">Live position paused — reconnecting…</p>}
                {view.status === 'EN_ROUTE' && !liveLocation && !disconnected && <p className="mt-2 text-[11px] text-muted">ETA unavailable — waiting for driver GPS.</p>}

                {/* actions */}
                {!terminal && (
                  <div className="mt-4 space-y-2">
                    {view.vehicle?.phone && (
                      <a href={`tel:${view.vehicle.phone}`} className="btn-primary w-full">📞 Call driver</a>
                    )}
                    <button className="w-full text-sm text-muted hover:text-ink" onClick={() => setShowDetails((s) => !s)}>
                      {showDetails ? 'Hide trip details' : 'Trip details ›'}
                    </button>
                    {showDetails && (
                      <div className="rounded-[12px] border border-edge bg-elevated p-3 text-xs text-muted">
                        <div>Reference: <span className="font-mono text-ink">{view.reference}</span></div>
                        <div className="mt-1">Class: {view.vClass} · {view.passengerCount} passenger(s)</div>
                        <div className="mt-1">Fare: {view.fareWording}</div>
                        <ul className="mt-2 space-y-1">
                          {view.timeline.map((t, i) => (
                            <li key={i}>· {t.type.replace(/_/g, ' ').toLowerCase()} — {new Date(t.at).toLocaleTimeString('en-GB')}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {view.canCancel && (
                      <button className="w-full rounded-[12px] border border-danger/40 px-4 py-2.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50" onClick={cancel} disabled={cancelling}>
                        {cancelling ? 'Cancelling…' : 'Cancel booking'}
                      </button>
                    )}
                  </div>
                )}

                {terminal && (
                  <div className="mt-4">
                    <div className="rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                      {view.status === 'COMPLETED' ? 'Thanks for riding with Taxi Cyprus.' : 'This booking was canceled.'}
                    </div>
                    <a href="/" className="btn-primary mt-3 w-full">Book another ride</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[100dvh] items-center justify-center bg-page px-4">{children}</div>;
}
