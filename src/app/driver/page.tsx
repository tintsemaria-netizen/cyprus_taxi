'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
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
  allowedNext: string[];
}
interface CurrentTrip { onDuty: boolean; available: boolean; trip: Trip | null; }

const DRIVER_ACTION: Record<string, string> = {
  EN_ROUTE: "I'm on the way",
  ARRIVED: "I've arrived",
  IN_PROGRESS: 'Start trip',
  COMPLETED: 'Complete trip',
  CANCELED: 'Cancel',
};

export default function Page() {
  return <StaffShell roles={['DRIVER']}>{() => <Driver />}</StaffShell>;
}

function Driver() {
  const [data, setData] = useState<CurrentTrip | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [gps, setGps] = useState<{ active: boolean; error: string | null; last: string | null }>({ active: false, error: null, last: null });
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
    setGps((g) => ({ ...g, active: false }));
  }

  function startGps() {
    if (!('geolocation' in navigator)) {
      setGps({ active: false, error: 'Geolocation not supported on this device/browser.', last: null });
      return;
    }
    session.current = uuid();
    seq.current = 0;
    setGps({ active: true, error: null, last: null });
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => { lastPos.current = pos; setGps((g) => ({ ...g, error: null })); },
      (err) => {
        setGps((g) => ({ ...g, active: err.code !== err.PERMISSION_DENIED && g.active, error: err.code === err.PERMISSION_DENIED ? 'Location permission denied. Enable it to share GPS.' : 'GPS error — retrying.' }));
        if (err.code === err.PERMISSION_DENIED) stopGps();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
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

  async function driverStatus(to: string) {
    if (!data?.trip) return;
    if ((to === 'IN_PROGRESS' || to === 'COMPLETED') && !confirm(`${to === 'IN_PROGRESS' ? 'Start' : 'Complete'} the trip?`)) return;
    try {
      await api(`/driver/bookings/${data.trip.bookingId}/status`, { method: 'POST', body: { to, expectedRevision: data.trip.revision } });
      if (to === 'COMPLETED') stopGps();
      await load();
    } catch (e) {
      if (e instanceof ApiRequestError) setBanner(e.body.message);
      await load();
    }
  }

  if (!data) return <div className="p-8 text-muted">Loading…</div>;

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      {banner && <p className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" onClick={() => setBanner(null)}>{banner}</p>}

      {/* Duty */}
      <div className="card flex items-center justify-between p-4">
        <div>
          <div className="font-semibold">{data.onDuty ? 'On duty' : 'Off duty'}</div>
          <div className="text-xs text-muted">{data.onDuty ? (data.trip ? 'On a trip' : 'Available for assignments') : 'Not receiving assignments'}</div>
        </div>
        <button className={data.onDuty ? 'btn-ghost' : 'btn-primary'} onClick={() => setDuty(!data.onDuty)}>
          {data.onDuty ? 'Go off duty' : 'Go on duty'}
        </button>
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
          {gps.error && <p className="mt-2 text-xs text-danger">{gps.error}</p>}
          <p className="mt-2 text-[11px] text-muted">Foreground GPS only, while on duty. Switching apps or locking the screen may pause updates. Real device GPS — never simulated.</p>
        </div>
      )}

      {/* Trip */}
      <div className="card mt-4 p-4">
        {data.trip ? (
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-accent">{data.trip.reference}</span>
              <span className="chip">{data.trip.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">Pickup</span><span className="ml-auto text-right font-medium">{data.trip.pickup.label}</span></div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">Destination</span><span className="ml-auto text-right font-medium">{data.trip.dropoff.label}</span></div>
            </div>
            <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
              <div className="font-medium">{data.trip.passengerName} · {data.trip.passengerCount}p · {data.trip.vClass}</div>
              {data.trip.note && <div className="mt-1 text-xs text-muted">Note: {data.trip.note}</div>}
              <div className="mt-3 flex gap-2">
                <a href={`tel:${data.trip.passengerPhone}`} className="btn-ghost !min-h-0 flex-1 !py-2 text-sm">📞 Call passenger</a>
                <a href={`geo:${data.trip.dropoff.lat},${data.trip.dropoff.lng}`} className="btn-ghost !min-h-0 flex-1 !py-2 text-sm">🧭 Navigate</a>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {data.trip.allowedNext.map((s) => (
                <button key={s} className={`btn-primary w-full ${s === 'CANCELED' ? '!bg-elevated !text-danger border border-danger/40' : ''}`} onClick={() => driverStatus(s)}>
                  {DRIVER_ACTION[s] ?? s}
                </button>
              ))}
              {data.trip.allowedNext.length === 0 && <p className="text-center text-sm text-muted">Trip finished.</p>}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="text-2xl">🚕</div>
            <p className="mt-2 font-medium">No assigned trip</p>
            <p className="text-sm text-muted">{data.onDuty ? 'Waiting for the dispatcher to assign you a booking.' : 'Go on duty to receive assignments.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
