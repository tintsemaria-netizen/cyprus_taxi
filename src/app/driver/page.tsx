'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { ChatPanel } from '@/components/ChatPanel';
import { NotifyToggle } from '@/components/NotifyToggle';
import { api, ApiRequestError, uuid } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface Trip {
  bookingId: string;
  reference: string;
  status: string;
  revision: number;
  pickup: { lat: number; lng: number; label: string };
  dropoff: { lat: number; lng: number; label: string };
  passengerName: string;
  passengerPhone: string;
  note: string | null;
  passengerCount: number;
  vClass: string;
  scheduledAt: string | null;
  waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null;
  allowedNext: string[];
}
interface CurrentTrip { onDuty: boolean; available: boolean; trip: Trip | null; }

interface Offer {
  offerId: string;
  expiresAt: string;
  pickupEtaSec: number | null;
  pickup: { lat: number; lng: number; label: string };
  dropoff: { label: string };
  vClass: string;
  passengerCount: number;
  fareCents: number | null;
}

export default function Page() {
  return <StaffShell roles={['DRIVER']}>{() => <Driver />}</StaffShell>;
}

function Driver() {
  const [data, setData] = useState<CurrentTrip | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [gps, setGps] = useState<{ active: boolean; error: string | null; last: string | null }>({ active: false, error: null, last: null });
  const [offer, setOffer] = useState<Offer | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);
  const [offerBusy, setOfferBusy] = useState(false);
  const [startCode, setStartCode] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null); // driver's own live position for the map
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  const [navRoute, setNavRoute] = useState<[number, number][]>([]); // [lng,lat] route to the current target
  const watchId = useRef<number | null>(null);
  const sendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPos = useRef<GeolocationPosition | null>(null);
  const session = useRef<string>('');
  const seq = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      setData(await api<CurrentTrip>('/driver/current-trip'));
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => { clearInterval(t); stopGps(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  function stopGps() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    if (sendTimer.current) clearInterval(sendTimer.current);
    watchId.current = null;
    sendTimer.current = null;
    lastPos.current = null;
    posRef.current = null;
    setPos(null);
    setGps((g) => ({ ...g, active: false }));
  }

  function beginWatch(highAccuracy: boolean) {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        lastPos.current = p;
        const c = { lat: p.coords.latitude, lng: p.coords.longitude };
        posRef.current = c;
        setPos(c);
        setGps((g) => ({ ...g, error: null }));
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGps((g) => ({ ...g, active: false, error: 'Location permission denied. Allow location for this site to share GPS.' }));
          stopGps();
          return;
        }
        // Transient timeout / position-unavailable (common indoors / on desktops).
        // Fall back once from precise GPS to network location, and keep trying —
        // watchPosition recovers automatically once a fix is available.
        if (highAccuracy) { beginWatch(false); return; }
        setGps((g) => ({ ...g, error: lastPos.current ? null : 'Acquiring GPS… keep location on; a moving vehicle outdoors gets the best fix.' }));
      },
      highAccuracy
        ? { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
        : { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 },
    );
  }

  function startGps() {
    if (!('geolocation' in navigator)) {
      setGps({ active: false, error: 'Geolocation not supported on this device/browser.', last: null });
      return;
    }
    session.current = uuid();
    seq.current = 0;
    setGps({ active: true, error: null, last: null });
    beginWatch(true);
    // Coalesce + send at most once per 5s (real samples only).
    sendTimer.current = setInterval(sendSample, 5000);
  }

  async function sendSample() {
    const pos = lastPos.current;
    if (!pos) return;
    seq.current += 1;
    try {
      await api('/driver/location', {
        method: 'POST',
        body: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? 0,
          heading: pos.coords.heading ?? undefined,
          speed: pos.coords.speed ?? undefined,
          sampledAt: new Date(pos.timestamp).toISOString(),
          gpsSession: session.current,
          sequence: seq.current,
        },
      });
      setGps((g) => ({ ...g, last: new Date().toLocaleTimeString('en-GB'), error: null }));
    } catch (e) {
      // Duty/activation revoked → stop sharing. Out-of-order/transient errors are
      // ignored; the newest sample sends on the next tick.
      if (e instanceof ApiRequestError && (e.body.code === 'OFF_DUTY' || e.body.code === 'INACTIVE')) {
        stopGps();
      }
    }
  }

  async function setDuty(onDuty: boolean) {
    try {
      const r = await api<{ onDuty: boolean; available: boolean; hasActiveTrip: boolean }>('/driver/availability', { method: 'PATCH', body: { onDuty, available: onDuty } });
      if (!r.onDuty) stopGps();
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
    }
  }

  // Poll for a live dispatch offer whenever the driver is on duty and idle.
  useEffect(() => {
    if (!data?.onDuty || data.trip) { setOffer(null); return; }
    let alive = true;
    const poll = async () => {
      try {
        const r = await api<{ offer: Offer | null }>('/driver/offers');
        if (alive) setOffer(r.offer);
      } catch { /* transient */ }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [data?.onDuty, data?.trip]);

  // Drive the offer countdown and the pickup-waiting timer.
  const ticking = !!offer || data?.trip?.status === 'ARRIVED';
  useEffect(() => {
    if (!ticking) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, [ticking]);

  async function acceptCurrentOffer(id: string) {
    setOfferBusy(true);
    try {
      await api(`/driver/offers/${id}/accept`, { method: 'POST' });
      setOffer(null);
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
      setOffer(null);
    } finally {
      setOfferBusy(false);
    }
  }

  async function declineCurrentOffer(id: string) {
    setOfferBusy(true);
    try { await api(`/driver/offers/${id}/reject`, { method: 'POST' }); } catch { /* ignore */ }
    finally { setOffer(null); setOfferBusy(false); }
  }

  // M3 trip lifecycle: EN_ROUTE via the generic status endpoint; arrive/start/complete/
  // release via dedicated endpoints (proximity, start-code and fare rules live server-side).
  async function tripAction(path: string, body: Record<string, unknown>, opts?: { stopGps?: boolean }) {
    if (!data?.trip) return;
    try {
      await api(`/driver/bookings/${data.trip.bookingId}/${path}`, { method: 'POST', body: { expectedRevision: data.trip.revision, ...body } });
      if (opts?.stopGps) stopGps();
      setStartCode('');
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
      await load();
    }
  }

  // Live navigation route to the current target (pickup before start, destination after).
  const tripStatus = data?.trip?.status;
  const tripId = data?.trip?.bookingId;
  useEffect(() => {
    const trip = data?.trip;
    if (!trip) { setNavRoute([]); return; }
    const target = trip.status === 'IN_PROGRESS' ? trip.dropoff : trip.pickup;
    let alive = true;
    const refresh = async () => {
      const p = posRef.current;
      if (!p) return;
      try {
        const r = await api<{ available?: boolean; path?: [number, number][] }>('/routes/estimate', {
          method: 'POST', body: { from: p, to: { lat: target.lat, lng: target.lng } }, timeoutMs: 9000,
        });
        if (alive && r.available !== false && r.path) setNavRoute(r.path.map(([la, ln]) => [ln, la] as [number, number]));
      } catch { /* keep last known geometry */ }
    };
    refresh();
    const t = setInterval(refresh, 15000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripStatus, tripId]);

  if (!data) return <div className="p-8 text-muted">Loading…</div>;

  const trip = data.trip;
  const navMarkers: MapMarker[] = [];
  if (pos) navMarkers.push({ id: 'me', lat: pos.lat, lng: pos.lng, kind: 'vehicle', label: 'You' });
  if (trip) {
    navMarkers.push({ id: 'pk', lat: trip.pickup.lat, lng: trip.pickup.lng, kind: 'pickup', label: 'Pickup' });
    if (trip.status === 'IN_PROGRESS') navMarkers.push({ id: 'dp', lat: trip.dropoff.lat, lng: trip.dropoff.lng, kind: 'dropoff', label: 'Destination' });
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      {banner && <p className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" onClick={() => setBanner(null)}>{banner}</p>}

      {/* Duty */}
      <div className="card flex items-center justify-between p-4">
        <div>
          <div className="font-semibold">{data.onDuty ? 'On duty' : 'Off duty'}</div>
          <div className="text-xs text-muted">{data.onDuty ? (data.trip ? 'On a trip' : 'Available for assignments') : 'Not receiving assignments'}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button className={data.onDuty ? 'btn-ghost' : 'btn-primary'} onClick={() => setDuty(!data.onDuty)}>
            {data.onDuty ? 'Go off duty' : 'Go on duty'}
          </button>
          <NotifyToggle pushUrl="/driver/push" />
        </div>
      </div>

      {/* GPS */}
      {data.onDuty && (
        <div className="card mt-4 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Location sharing</div>
              <div className="text-xs text-muted">
                {gps.active ? <span className="text-accent">● Sharing active{gps.last ? ` · sent ${gps.last}` : ''}</span> : 'Off'}
              </div>
            </div>
            {gps.active ? (
              <button className="btn-ghost" onClick={stopGps}>Stop</button>
            ) : (
              <button className="btn-primary" onClick={startGps}>Start sharing</button>
            )}
          </div>
          {gps.error && <p className={`mt-2 text-xs ${gps.error.startsWith('Acquiring') ? 'text-warn' : 'text-danger'}`}>{gps.error}</p>}
          <p className="mt-2 text-[11px] text-muted">Foreground GPS only, while on duty. Switching apps or locking the screen may pause updates. Real device GPS — never simulated.</p>
        </div>
      )}

      {/* Live dispatch offer */}
      {offer && !data.trip && (() => {
        const secsLeft = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - nowMs) / 1000));
        const etaMin = offer.pickupEtaSec != null ? Math.max(1, Math.round(offer.pickupEtaSec / 60)) : null;
        return (
          <div className="card mt-4 border-2 border-accent p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-accent">New ride offer</span>
              <span className={`chip ${secsLeft <= 5 ? '!text-danger' : ''}`}>⏳ {secsLeft}s</span>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">Pickup</span><span className="ml-auto text-right font-medium">{offer.pickup.label}</span></div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">Destination</span><span className="ml-auto text-right font-medium">{offer.dropoff.label}</span></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
              {etaMin != null && <span className="rounded-full bg-elevated px-2 py-1">≈ {etaMin} min to pickup</span>}
              <span className="rounded-full bg-elevated px-2 py-1">{offer.passengerCount}p · {offer.vClass}</span>
              {offer.fareCents != null && <span className="rounded-full bg-elevated px-2 py-1">≈ €{(offer.fareCents / 100).toFixed(2)}</span>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn-ghost !text-danger border border-danger/40" disabled={offerBusy} onClick={() => declineCurrentOffer(offer.offerId)}>Decline</button>
              <button className="btn-primary" disabled={offerBusy || secsLeft === 0} onClick={() => acceptCurrentOffer(offer.offerId)}>Accept</button>
            </div>
          </div>
        );
      })()}

      {/* Trip */}
      <div className="card mt-4 p-4">
        {data.trip ? (
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-accent">{data.trip.reference}</span>
              <span className="chip">{data.trip.status.replace(/_/g, ' ')}</span>
            </div>
            {/* Live navigation: route to the pickup, then to the destination after start */}
            <div className="mt-3 h-56 overflow-hidden rounded-[12px] border border-edge">
              <AutoMapView markers={navMarkers} route={navRoute} center={pos ?? data.trip.pickup} zoom={13} interactive className="h-full w-full" />
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {data.trip.status === 'IN_PROGRESS' ? 'Route to destination' : 'Route to pickup'}{!pos && ' · start location sharing to show your position'}
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">Pickup</span><span className="ml-auto text-right font-medium">{data.trip.pickup.label}</span></div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">Destination</span><span className="ml-auto text-right font-medium">{data.trip.dropoff.label}</span></div>
            </div>
            <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
              <div className="font-medium">{data.trip.passengerName} · {data.trip.passengerCount}p · {data.trip.vClass}</div>
              {data.trip.note && <div className="mt-1 text-xs text-muted">Note: {data.trip.note}</div>}
              <div className="mt-3">
                <ChatPanel key={data.trip.bookingId} listUrl={`/driver/bookings/${data.trip.bookingId}/messages`} postUrl={`/driver/bookings/${data.trip.bookingId}/messages`} pushUrl="/driver/push" me="DRIVER" peerLabel="passenger" />
              </div>
              <div className="mt-3 flex gap-2">
                <a href={`tel:${data.trip.passengerPhone}`} className="btn-ghost !min-h-0 flex-1 !py-2 text-sm">📞 Call passenger</a>
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${(data.trip.status === 'IN_PROGRESS' ? data.trip.dropoff : data.trip.pickup).lat},${(data.trip.status === 'IN_PROGRESS' ? data.trip.dropoff : data.trip.pickup).lng}&travelmode=driving`} target="_blank" rel="noreferrer" className="btn-ghost !min-h-0 flex-1 !py-2 text-sm">🧭 Navigate</a>
              </div>
            </div>
            {/* Pickup waiting timer (after arrival) */}
            {data.trip.status === 'ARRIVED' && data.trip.waiting && (() => {
              const elapsed = Math.max(0, Math.floor((nowMs - new Date(data.trip.waiting.arrivedAt).getTime()) / 1000));
              const freeLeft = Math.max(0, data.trip.waiting.graceSeconds - elapsed);
              const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
              return (
                <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                  {freeLeft > 0 ? (
                    <span>Free waiting: <span className="font-mono text-accent">{mmss(freeLeft)}</span> left</span>
                  ) : (
                    <span className="text-warn">Free waiting elapsed{data.trip.waiting.paidRateCentsPerMin > 0 ? ` · paid waiting €${(data.trip.waiting.paidRateCentsPerMin / 100).toFixed(2)}/min` : ' (no pre-pickup charge)'}</span>
                  )}
                </div>
              );
            })()}

            <div className="mt-4 grid gap-2">
              {data.trip.status === 'ASSIGNED' && (
                <button className="btn-primary w-full" onClick={() => tripAction('status', { to: 'EN_ROUTE' })}>I&apos;m on the way</button>
              )}
              {data.trip.status === 'EN_ROUTE' && (
                <button className="btn-primary w-full" onClick={() => tripAction('arrive', {})}>I&apos;ve arrived</button>
              )}
              {data.trip.status === 'ARRIVED' && (
                <div className="grid gap-2">
                  <input
                    inputMode="numeric" maxLength={4} placeholder="Passenger start code (4 digits)"
                    value={startCode} onChange={(e) => setStartCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full rounded-[12px] border border-edge bg-page px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em]"
                  />
                  <button className="btn-primary w-full" disabled={startCode.length !== 4} onClick={() => tripAction('start', { code: startCode })}>Start trip</button>
                </div>
              )}
              {data.trip.status === 'IN_PROGRESS' && (
                <button className="btn-primary w-full" onClick={() => confirm('Complete the trip?') && tripAction('complete', {}, { stopGps: true })}>Complete trip</button>
              )}
              {['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(data.trip.status) && (
                <button className="btn-primary w-full !bg-elevated !text-danger border border-danger/40" onClick={() => confirm('Release this ride? It will be offered to another driver.') && tripAction('cancel', {})}>
                  Can&apos;t take it — release
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="text-2xl">🚕</div>
            <p className="mt-2 font-medium">No assigned trip</p>
            <p className="text-sm text-muted">{data.onDuty ? 'Waiting for a nearby ride request. Keep location sharing on to receive offers.' : 'Go on duty to receive ride offers.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
