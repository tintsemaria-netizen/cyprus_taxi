'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { ChatPanel } from '@/components/ChatPanel';
import { NotifyToggle } from '@/components/NotifyToggle';
import { api, ApiRequestError, uuid } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface Trip {
  bookingId: string; reference: string; status: string; revision: number;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  passengerName: string; passengerPhone: string; note: string | null; passengerCount: number; vClass: string;
  scheduledAt: string | null; waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null; allowedNext: string[];
}
interface CurrentTrip { onDuty: boolean; available: boolean; trip: Trip | null }
interface Offer {
  offerId: string; expiresAt: string; pickupEtaSec: number | null; pickup: { lat: number; lng: number; label: string };
  dropoff: { label: string }; vClass: string; passengerCount: number; fareCents: number | null;
}
interface TripCard {
  bookingId: string; reference: string; at: string; pickupLabel: string; dropoffLabel: string; vClass: string; passengerCount: number;
  driverStatus: string; fare: { label: string; cents: number | null; currency: string }; payment: string | null;
}
interface Dashboard {
  driver: { name: string; eligibility: string; canWork: boolean };
  status: { onDuty: boolean; available: boolean; sharingSessionOpen: boolean; hasActiveTrip: boolean; activeBookingId: string | null };
  vehicle: { plate: string; vClass: string; seats: number; label: string } | null;
  today: { recordedEarnings: { currency: string; cents: number }[]; pendingFinalTrips: number; completedTrips: number; onlineSeconds: number };
  latestTrips: TripCard[];
  alerts: { level: string; code: string; message: string; action?: { label: string; href: string } }[];
  support: { operatorName: string | null; phone: string | null; email: string | null };
}

type Tab = 'home' | 'trips' | 'earnings' | 'profile';

const money = (cents: number | null, currency = 'EUR') => {
  if (cents == null) return '—';
  try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
};
const dur = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);

export default function Page() {
  return <StaffShell roles={['DRIVER']}>{() => <Driver />}</StaffShell>;
}

function Driver() {
  const [tab, setTab] = useState<Tab>('home');
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);
  const [data, setData] = useState<CurrentTrip | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [gps, setGps] = useState<{ active: boolean; error: string | null; last: string | null }>({ active: false, error: null, last: null });
  const [offer, setOffer] = useState<Offer | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);
  const [offerBusy, setOfferBusy] = useState(false);
  const [startCode, setStartCode] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  const [navRoute, setNavRoute] = useState<[number, number][]>([]);
  const watchId = useRef<number | null>(null);
  const sendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPos = useRef<GeolocationPosition | null>(null);
  const session = useRef<string>('');
  const seq = useRef<number>(0);

  const load = useCallback(async () => {
    try { setData(await api<CurrentTrip>('/driver/current-trip')); }
    catch (e) { if (e instanceof ApiRequestError) setBanner(e.body.message); }
  }, []);
  const loadDash = useCallback(async () => {
    try { setDash(await api<Dashboard>('/driver/dashboard')); } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    load(); loadDash();
    const t = setInterval(() => { if (document.visibilityState === 'visible') { load(); loadDash(); } }, 5000);
    return () => { clearInterval(t); stopGps(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadDash]);

  function stopGps() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    if (sendTimer.current) clearInterval(sendTimer.current);
    watchId.current = null; sendTimer.current = null; lastPos.current = null; posRef.current = null;
    setPos(null); setGps((g) => ({ ...g, active: false }));
  }
  function beginWatch(highAccuracy: boolean) {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => { lastPos.current = p; const c = { lat: p.coords.latitude, lng: p.coords.longitude }; posRef.current = c; setPos(c); setGps((g) => ({ ...g, error: null })); },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) { setGps((g) => ({ ...g, active: false, error: 'Location permission denied. Allow location for this site to share GPS.' })); stopGps(); return; }
        if (highAccuracy) { beginWatch(false); return; }
        setGps((g) => ({ ...g, error: lastPos.current ? null : 'Acquiring GPS… keep location on; a moving vehicle outdoors gets the best fix.' }));
      },
      highAccuracy ? { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 } : { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 },
    );
  }
  function startGps() {
    if (!('geolocation' in navigator)) { setGps({ active: false, error: 'Geolocation not supported on this device/browser.', last: null }); return; }
    session.current = uuid(); seq.current = 0; setGps({ active: true, error: null, last: null });
    beginWatch(true); sendTimer.current = setInterval(sendSample, 5000);
  }
  async function sendSample() {
    const p = lastPos.current; if (!p) return; seq.current += 1;
    try {
      await api('/driver/location', { method: 'POST', body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? 0, heading: p.coords.heading ?? undefined, speed: p.coords.speed ?? undefined, sampledAt: new Date(p.timestamp).toISOString(), gpsSession: session.current, sequence: seq.current } });
      setGps((g) => ({ ...g, last: new Date().toLocaleTimeString('en-GB'), error: null }));
    } catch (e) { if (e instanceof ApiRequestError && (e.body.code === 'OFF_DUTY' || e.body.code === 'INACTIVE')) stopGps(); }
  }
  async function setDuty(onDuty: boolean) {
    try {
      const r = await api<{ onDuty: boolean }>('/driver/availability', { method: 'PATCH', body: { onDuty, available: onDuty } });
      if (!r.onDuty) stopGps();
      await load(); await loadDash();
    } catch (e) { if (e instanceof ApiRequestError) setBanner(e.body.message); }
  }

  // Offer polling — runs regardless of the visible tab (never stops on tab switch).
  useEffect(() => {
    if (!data?.onDuty || data.trip) { setOffer(null); return; }
    let alive = true;
    const poll = async () => { try { const r = await api<{ offer: Offer | null }>('/driver/offers'); if (alive) setOffer(r.offer); } catch { /* transient */ } };
    poll(); const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [data?.onDuty, data?.trip]);

  const ticking = !!offer || data?.trip?.status === 'ARRIVED';
  useEffect(() => { if (!ticking) return; setNowMs(Date.now()); const t = setInterval(() => setNowMs(Date.now()), 500); return () => clearInterval(t); }, [ticking]);

  async function acceptCurrentOffer(id: string) {
    setOfferBusy(true);
    try { await api(`/driver/offers/${id}/accept`, { method: 'POST' }); setOffer(null); setTab('home'); await load(); await loadDash(); }
    catch (e) { if (e instanceof ApiRequestError) setBanner(e.body.message); setOffer(null); }
    finally { setOfferBusy(false); }
  }
  async function declineCurrentOffer(id: string) {
    setOfferBusy(true);
    try { await api(`/driver/offers/${id}/reject`, { method: 'POST' }); } catch { /* ignore */ }
    finally { setOffer(null); setOfferBusy(false); }
  }
  async function tripAction(path: string, body: Record<string, unknown>, opts?: { stopGps?: boolean }) {
    if (!data?.trip) return;
    try { await api(`/driver/bookings/${data.trip.bookingId}/${path}`, { method: 'POST', body: { expectedRevision: data.trip.revision, ...body } }); if (opts?.stopGps) stopGps(); setStartCode(''); await load(); await loadDash(); }
    catch (e) { if (e instanceof ApiRequestError) setBanner(e.body.message); await load(); }
  }

  const tripStatus = data?.trip?.status; const tripId = data?.trip?.bookingId;
  useEffect(() => {
    const trip = data?.trip; if (!trip) { setNavRoute([]); return; }
    const target = trip.status === 'IN_PROGRESS' ? trip.dropoff : trip.pickup;
    let alive = true;
    const refresh = async () => {
      const p = posRef.current; if (!p) return;
      try { const r = await api<{ available?: boolean; path?: [number, number][] }>('/routes/estimate', { method: 'POST', body: { from: p, to: { lat: target.lat, lng: target.lng } }, timeoutMs: 9000 }); if (alive && r.available !== false && r.path) setNavRoute(r.path.map(([la, ln]) => [ln, la] as [number, number])); }
      catch { /* keep last */ }
    };
    refresh(); const t = setInterval(refresh, 15000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripStatus, tripId]);

  if (!data) return <div className="p-8 text-muted">Loading…</div>;
  const trip = data.trip;
  const offerSecs = offer ? Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - nowMs) / 1000)) : 0;

  return (
    <div className="mx-auto max-w-lg p-4 pb-24 sm:p-6 sm:pb-24">
      {banner && <p className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" onClick={() => setBanner(null)}>{banner}</p>}

      {/* Persistent cross-section bars: an offer alert, or a return-to-active-trip bar. */}
      {tab !== 'home' && offer && !trip && (
        <button onClick={() => setTab('home')} className="mb-3 flex w-full items-center justify-between rounded-[12px] border-2 border-accent bg-accent/10 px-3 py-2 text-sm">
          <span className="font-semibold text-accent">New ride offer</span>
          <span className={offerSecs <= 5 ? 'text-danger' : 'text-muted'}>⏳ {offerSecs}s · View</span>
        </button>
      )}
      {tab !== 'home' && trip && (
        <button onClick={() => setTab('home')} className="mb-3 flex w-full items-center justify-between rounded-[12px] border border-edge bg-elevated px-3 py-2 text-sm">
          <span className="font-medium">Active trip · {trip.reference}</span>
          <span className="text-accent">Return →</span>
        </button>
      )}

      {tab === 'home' && (
        <HomeSection
          data={data} dash={dash} gps={gps} offer={offer} offerSecs={offerSecs} offerBusy={offerBusy} nowMs={nowMs}
          pos={pos} navRoute={navRoute} startCode={startCode} setStartCode={setStartCode}
          onDuty={setDuty} onStartGps={startGps} onStopGps={stopGps}
          onAccept={acceptCurrentOffer} onDecline={declineCurrentOffer} onTripAction={tripAction} goTrips={() => setTab('trips')}
        />
      )}
      {tab === 'trips' && <TripsSection onOpen={setActiveDetailId} activeDetail={activeDetailId} onCloseDetail={() => setActiveDetailId(null)} onSettled={() => { loadDash(); }} />}
      {tab === 'earnings' && <EarningsSection />}
      {tab === 'profile' && <ProfileSection dash={dash} />}

      <BottomNav tab={tab} setTab={setTab} hasOffer={!!offer && !trip} hasTrip={!!trip} />
    </div>
  );
}

// ---- Home ----
function HomeSection(props: {
  data: CurrentTrip; dash: Dashboard | null; gps: { active: boolean; error: string | null; last: string | null };
  offer: Offer | null; offerSecs: number; offerBusy: boolean; nowMs: number;
  pos: { lat: number; lng: number } | null; navRoute: [number, number][]; startCode: string; setStartCode: (v: string) => void;
  onDuty: (v: boolean) => void; onStartGps: () => void; onStopGps: () => void;
  onAccept: (id: string) => void; onDecline: (id: string) => void; onTripAction: (path: string, body: Record<string, unknown>, opts?: { stopGps?: boolean }) => void; goTrips: () => void;
}) {
  const { data, dash, gps, offer, offerSecs, offerBusy, nowMs, pos, navRoute, startCode, setStartCode } = props;
  const trip = data.trip;
  const blocker = dash?.alerts.find((a) => a.level === 'blocker');

  const navMarkers: MapMarker[] = [];
  if (pos) navMarkers.push({ id: 'me', lat: pos.lat, lng: pos.lng, kind: 'vehicle', label: 'You' });
  if (trip) { navMarkers.push({ id: 'pk', lat: trip.pickup.lat, lng: trip.pickup.lng, kind: 'pickup', label: 'Pickup' }); if (trip.status === 'IN_PROGRESS') navMarkers.push({ id: 'dp', lat: trip.dropoff.lat, lng: trip.dropoff.lng, kind: 'dropoff', label: 'Destination' }); }

  return (
    <div className="space-y-4">
      {/* Status / duty */}
      <div className="card flex items-center justify-between p-4">
        <div>
          <div className="font-semibold">{dash?.driver.name ? `Hi, ${dash.driver.name}` : (data.onDuty ? 'On duty' : 'Off duty')}</div>
          <div className="text-xs text-muted">{dash?.vehicle ? `${dash.vehicle.plate} · ${dash.vehicle.label}` : 'No approved vehicle'}</div>
          <div className="mt-0.5 text-xs">{data.onDuty ? <span className="text-accent">● On duty{data.trip ? ' · on a trip' : ' · ready for requests'}</span> : <span className="text-muted">Off duty</span>}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {blocker ? (
            <span className="rounded-full bg-danger/15 px-3 py-1 text-xs text-danger">Can’t go online</span>
          ) : (
            <button className={`min-h-[44px] ${data.onDuty ? 'btn-ghost' : 'btn-primary'}`} onClick={() => props.onDuty(!data.onDuty)}>{data.onDuty ? 'Go offline' : 'Go online'}</button>
          )}
          <NotifyToggle pushUrl="/driver/push" />
        </div>
      </div>

      {/* Eligibility blocker replaces the online action */}
      {blocker && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">
          <p className="font-medium text-danger">{blocker.message}</p>
          {blocker.action && <a href={blocker.action.href} className="mt-1 inline-block text-xs underline">{blocker.action.label}</a>}
        </div>
      )}

      {/* GPS sharing */}
      {data.onDuty && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div><div className="font-semibold">Location sharing</div><div className="text-xs text-muted">{gps.active ? <span className="text-accent">● Sharing active{gps.last ? ` · sent ${gps.last}` : ''}</span> : 'Off'}</div></div>
            {gps.active ? <button className="btn-ghost min-h-[44px]" onClick={props.onStopGps}>Stop</button> : <button className="btn-primary min-h-[44px]" onClick={props.onStartGps}>Start sharing</button>}
          </div>
          {gps.error && <p className={`mt-2 text-xs ${gps.error.startsWith('Acquiring') ? 'text-warn' : 'text-danger'}`}>{gps.error}</p>}
          <p className="mt-2 text-[11px] text-muted">Foreground GPS only, while on duty. Real device GPS — never simulated.</p>
        </div>
      )}

      {/* Offer takes priority */}
      {offer && !trip && (
        <div className="card border-2 border-accent p-4">
          <div className="flex items-center justify-between"><span className="font-semibold text-accent">New ride offer</span><span className={`chip ${offerSecs <= 5 ? '!text-danger' : ''}`}>⏳ {offerSecs}s</span></div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">Pickup</span><span className="ml-auto text-right font-medium">{offer.pickup.label}</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">Destination</span><span className="ml-auto text-right font-medium">{offer.dropoff.label}</span></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            {offer.pickupEtaSec != null && <span className="rounded-full bg-elevated px-2 py-1">≈ {Math.max(1, Math.round(offer.pickupEtaSec / 60))} min to pickup</span>}
            <span className="rounded-full bg-elevated px-2 py-1">{offer.passengerCount}p · {offer.vClass}</span>
            {offer.fareCents != null && <span className="rounded-full bg-elevated px-2 py-1">≈ {money(offer.fareCents)}</span>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn-ghost min-h-[44px] !text-danger border border-danger/40" disabled={offerBusy} onClick={() => props.onDecline(offer.offerId)}>Decline</button>
            <button className="btn-primary min-h-[44px]" disabled={offerBusy || offerSecs === 0} onClick={() => props.onAccept(offer.offerId)}>Accept</button>
          </div>
        </div>
      )}

      {/* Active trip (priority over stats) */}
      {trip ? (
        <div className="card p-4">
          <div className="flex items-center justify-between"><span className="font-mono text-accent">{trip.reference}</span><span className="chip">{trip.status.replace(/_/g, ' ')}</span></div>
          <div className="mt-3 h-56 overflow-hidden rounded-[12px] border border-edge"><AutoMapView markers={navMarkers} route={navRoute} center={pos ?? trip.pickup} zoom={13} interactive className="h-full w-full" /></div>
          <p className="mt-1 text-[11px] text-muted">{trip.status === 'IN_PROGRESS' ? 'Route to destination' : 'Route to pickup'}{!pos && ' · start location sharing to show your position'}</p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">Pickup</span><span className="ml-auto text-right font-medium">{trip.pickup.label}</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">Destination</span><span className="ml-auto text-right font-medium">{trip.dropoff.label}</span></div>
          </div>
          <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
            <div className="font-medium">{trip.passengerName} · {trip.passengerCount}p · {trip.vClass}</div>
            {trip.note && <div className="mt-1 text-xs text-muted">Note: {trip.note}</div>}
            <div className="mt-3"><ChatPanel key={trip.bookingId} listUrl={`/driver/bookings/${trip.bookingId}/messages`} postUrl={`/driver/bookings/${trip.bookingId}/messages`} pushUrl="/driver/push" me="DRIVER" peerLabel="passenger" /></div>
            <div className="mt-3 flex gap-2">
              <a href={`tel:${trip.passengerPhone}`} className="btn-ghost !min-h-[44px] flex-1 !py-2 text-sm">📞 Call</a>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${(trip.status === 'IN_PROGRESS' ? trip.dropoff : trip.pickup).lat},${(trip.status === 'IN_PROGRESS' ? trip.dropoff : trip.pickup).lng}&travelmode=driving`} target="_blank" rel="noreferrer" className="btn-ghost !min-h-[44px] flex-1 !py-2 text-sm">🧭 Navigate</a>
            </div>
          </div>
          {trip.status === 'ARRIVED' && trip.waiting && (() => {
            const elapsed = Math.max(0, Math.floor((nowMs - new Date(trip.waiting.arrivedAt).getTime()) / 1000));
            const freeLeft = Math.max(0, trip.waiting.graceSeconds - elapsed);
            const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
            return <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">{freeLeft > 0 ? <span>Free waiting: <span className="font-mono text-accent">{mmss(freeLeft)}</span> left</span> : <span className="text-warn">Free waiting elapsed{trip.waiting.paidRateCentsPerMin > 0 ? ` · paid €${(trip.waiting.paidRateCentsPerMin / 100).toFixed(2)}/min` : ' (no pre-pickup charge)'}</span>}</div>;
          })()}
          <div className="mt-4 grid gap-2">
            {trip.status === 'ASSIGNED' && <button className="btn-primary min-h-[44px] w-full" onClick={() => props.onTripAction('status', { to: 'EN_ROUTE' })}>I&apos;m on the way</button>}
            {trip.status === 'EN_ROUTE' && <button className="btn-primary min-h-[44px] w-full" onClick={() => props.onTripAction('arrive', {})}>I&apos;ve arrived</button>}
            {trip.status === 'ARRIVED' && (
              <div className="grid gap-2">
                <input inputMode="numeric" maxLength={4} placeholder="Passenger start code (4 digits)" value={startCode} onChange={(e) => setStartCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className="w-full rounded-[12px] border border-edge bg-page px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em]" />
                <button className="btn-primary min-h-[44px] w-full" disabled={startCode.length !== 4} onClick={() => props.onTripAction('start', { code: startCode })}>Start trip</button>
              </div>
            )}
            {trip.status === 'IN_PROGRESS' && <button className="btn-primary min-h-[44px] w-full" onClick={() => confirm('Complete the trip?') && props.onTripAction('complete', {}, { stopGps: true })}>Complete trip</button>}
            {['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(trip.status) && <button className="btn-primary min-h-[44px] w-full !bg-elevated !text-danger border border-danger/40" onClick={() => confirm('Release this ride? It will be offered to another driver.') && props.onTripAction('cancel', {})}>Can&apos;t take it — release</button>}
          </div>
        </div>
      ) : !offer && (
        <>
          {/* Today's three figures */}
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Today’s earnings" value={dash ? (dash.today.recordedEarnings.length ? dash.today.recordedEarnings.map((e) => money(e.cents, e.currency)).join(' · ') : money(0)) : '—'} sub={dash && dash.today.pendingFinalTrips > 0 ? `${dash.today.pendingFinalTrips} pending` : 'recorded'} />
            <Figure label="Completed" value={dash ? String(dash.today.completedTrips) : '—'} sub="trips today" />
            <Figure label="Online" value={dash ? dur(dash.today.onlineSeconds) : '—'} sub="today" />
          </div>
          {dash && dash.today.pendingFinalTrips === 0 && dash.today.completedTrips === 0 && <p className="text-center text-xs text-muted">Recorded earnings = completed trips with a known final amount. This is before expenses; it is not net profit.</p>}

          {/* Idle: last trips + one warning + help */}
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between"><span className="font-semibold">Last trips</span><button onClick={props.goTrips} className="text-xs text-accent">See all</button></div>
            {dash?.latestTrips.length ? <div className="space-y-2">{dash.latestTrips.map((t) => <TripRow key={t.bookingId} t={t} />)}</div> : <p className="py-4 text-center text-sm text-muted">No trips yet. Go online to get your first ride.</p>}
          </div>
          {dash?.alerts.find((a) => a.level === 'warning') && (() => { const w = dash.alerts.find((a) => a.level === 'warning')!; return <div className="rounded-[12px] border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{w.message}{w.action && <a href={w.action.href} className="ml-2 underline">{w.action.label}</a>}</div>; })()}
        </>
      )}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-[12px] border border-edge bg-elevated p-3 text-center"><div className="truncate text-lg font-semibold">{value}</div><div className="text-[11px] text-muted">{label}</div><div className="text-[10px] text-muted">{sub}</div></div>;
}
function TripRow({ t, onClick }: { t: TripCard; onClick?: () => void }) {
  const badge = t.driverStatus === 'COMPLETED' ? 'text-accent' : t.driverStatus === 'RELEASED' ? 'text-muted' : 'text-warn';
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-edge p-2 text-left text-sm">
      <div className="min-w-0">
        <div className="truncate">{t.pickupLabel} → {t.dropoffLabel}</div>
        <div className="text-[11px] text-muted">{new Date(t.at).toLocaleString('en-GB')} · <span className={badge}>{t.driverStatus.replace(/_/g, ' ').toLowerCase()}</span></div>
      </div>
      <div className="shrink-0 text-right"><div className="font-medium">{t.fare.cents != null ? money(t.fare.cents, t.fare.currency) : (t.fare.label === 'Pending' ? 'Pending' : '—')}</div><div className="text-[10px] text-muted">{t.fare.label}{t.payment ? ` · ${t.payment}` : ''}</div></div>
    </button>
  );
}

// ---- Trips ----
type Range = 'today' | 'week' | 'month';
function TripsSection({ onOpen, activeDetail, onCloseDetail, onSettled }: { onOpen: (id: string) => void; activeDetail: string | null; onCloseDetail: () => void; onSettled: () => void }) {
  const [range, setRange] = useState<Range>('today');
  const [items, setItems] = useState<TripCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadPage = useCallback(async (reset: boolean) => {
    setLoading(true); setErr(null);
    try {
      const q = new URLSearchParams({ range, limit: '20', ...(reset ? {} : cursor ? { cursor } : {}) });
      const r = await api<{ items: TripCard[]; nextCursor: string | null }>(`/driver/trips?${q}`);
      setItems((prev) => (reset ? r.items : [...prev, ...r.items])); setCursor(r.nextCursor);
    } catch (e) { setErr((e as Error)?.message ?? 'Failed to load'); } finally { setLoading(false); }
  }, [range, cursor]);

  useEffect(() => { setItems([]); setCursor(null); loadPage(true); /* eslint-disable-next-line */ }, [range]);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Trips</h1>
      <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1">
        {(['today', 'week', 'month'] as Range[]).map((r) => <button key={r} onClick={() => setRange(r)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${range === r ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>{r[0].toUpperCase() + r.slice(1)}</button>)}
      </div>
      {err && <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">{err} <button className="underline" onClick={() => loadPage(true)}>Retry</button></div>}
      {items.length === 0 && !loading && !err ? <p className="py-8 text-center text-sm text-muted">No trips in this range.</p> : (
        <div className="space-y-2">{items.map((t) => <TripRow key={t.bookingId + t.at} t={t} onClick={() => onOpen(t.bookingId)} />)}</div>
      )}
      {cursor && <button onClick={() => loadPage(false)} disabled={loading} className="btn-ghost w-full">{loading ? 'Loading…' : 'Load more'}</button>}
      {activeDetail && <TripDetailModal bookingId={activeDetail} onClose={onCloseDetail} onSettled={() => { onSettled(); loadPage(true); }} />}
    </div>
  );
}

interface Detail extends TripCard {
  timestamps: { assignedAt: string; endedAt: string | null }; fareBreakdown: { label?: string; amountCents?: number }[] | null;
  releaseReason: string | null; settlement: { current: { revision: number; reportedFinalCents: number; currency: string; paymentReceived: boolean } | null; history: unknown[] } | null; canResume: boolean; canSettle: boolean;
}
function TripDetailModal({ bookingId, onClose, onSettled }: { bookingId: string; onClose: () => void; onSettled: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [amount, setAmount] = useState('');
  const [received, setReceived] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setD(await api<Detail>(`/driver/trips/${bookingId}`)); } catch (e) { setErr((e as Error)?.message ?? 'Failed'); } }, [bookingId]);
  useEffect(() => { load(); }, [load]);

  async function submitSettlement() {
    setBusy(true); setErr(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setErr('Enter a valid amount.'); setBusy(false); return; }
    try {
      await api(`/driver/bookings/${bookingId}/settlement`, { method: 'POST', body: { reportedFinalCents: cents, paymentReceived: received, ...(d?.settlement?.current ? { correctionReason: reason, expectedRevision: d.settlement.current.revision } : {}) } });
      setAmount(''); setReason(''); await load(); onSettled();
    } catch (e) { setErr(e instanceof ApiRequestError ? e.body.message : 'Failed to save'); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[16px] border border-edge bg-page p-4 sm:rounded-[16px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between"><span className="font-mono text-accent">{d?.reference ?? '…'}</span><button onClick={onClose} className="text-muted">✕</button></div>
        {err && <p className="mb-2 text-sm text-danger">{err}</p>}
        {!d ? <p className="text-muted">Loading…</p> : (
          <div className="space-y-3 text-sm">
            <div><span className="chip">{d.driverStatus.replace(/_/g, ' ')}</span></div>
            <div className="space-y-1"><div>{d.pickupLabel} → {d.dropoffLabel}</div><div className="text-xs text-muted">{d.vClass} · {d.passengerCount}p · assigned {new Date(d.timestamps.assignedAt).toLocaleString('en-GB')}{d.timestamps.endedAt ? ` · ended ${new Date(d.timestamps.endedAt).toLocaleString('en-GB')}` : ''}</div></div>
            {d.releaseReason && <p className="text-xs text-muted">Released: {d.releaseReason}</p>}
            <div className="rounded-[12px] border border-edge bg-elevated p-3">
              <div className="flex items-center justify-between"><span className="text-muted">Fare</span><span className="font-medium">{d.fare.cents != null ? money(d.fare.cents, d.fare.currency) : d.fare.label}</span></div>
              <div className="text-[11px] text-muted">{d.fare.label}{d.payment ? ` · payment ${d.payment}` : ''}</div>
              {d.settlement?.current && <div className="mt-1 text-[11px] text-muted">Driver-reported (rev {d.settlement.current.revision}){d.settlement.current.paymentReceived ? ' · marked received' : ''}. Driver-reported — not bank/provider verified.</div>}
            </div>
            {d.canResume && <a href="/driver" className="btn-primary block w-full text-center">Return to active trip</a>}
            {d.canSettle && (
              <div className="rounded-[12px] border border-edge bg-elevated p-3">
                <p className="font-medium">{d.settlement?.current ? 'Correct settlement' : 'Record metered amount'}</p>
                <p className="mb-2 text-[11px] text-muted">The final regulated meter amount is settled with the passenger. Record it for your own statement.</p>
                <input inputMode="decimal" placeholder="Metered amount (e.g. 18.50)" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} className="w-full rounded-[10px] border border-edge bg-page px-3 py-2" />
                <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} /> Payment received (cash)</label>
                {d.settlement?.current && <input placeholder="Reason for correction" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-[10px] border border-edge bg-page px-3 py-2 text-xs" />}
                <button onClick={submitSettlement} disabled={busy || !amount} className="btn-primary mt-2 w-full">{busy ? 'Saving…' : 'Save'}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Earnings ----
function EarningsSection() {
  const [range, setRange] = useState<Range>('week');
  const [data, setData] = useState<{ summary: { byCurrency: { currency: string; completedTrips: number; recordedEarningsCents: number; knownFinalTrips: number; pendingFinalTrips: number; collectedCents: number }[]; completedTrips: number; pendingFinalTrips: number; onlineSeconds: number }; daily: { day: string; recordedEarningsCents: number; completedTrips: number; currency: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await api(`/driver/earnings?range=${range}`)); } catch (e) { setErr((e as Error)?.message ?? 'Failed'); } finally { setLoading(false); }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const max = Math.max(1, ...(data?.daily.map((d) => d.recordedEarningsCents) ?? [0]));
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Earnings</h1>
      <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1">
        {(['today', 'week', 'month'] as Range[]).map((r) => <button key={r} onClick={() => setRange(r)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${range === r ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>{r[0].toUpperCase() + r.slice(1)}</button>)}
      </div>
      {err && <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">Couldn’t load earnings: {err} <button className="underline" onClick={load}>Retry</button></div>}
      {loading && !data && <p className="text-muted">Loading…</p>}
      {data && (
        <>
          {data.summary.byCurrency.length === 0 ? <p className="py-6 text-center text-sm text-muted">No completed trips in this range.</p> : data.summary.byCurrency.map((c) => (
            <div key={c.currency} className="card p-4">
              <div className="text-3xl font-semibold">{money(c.recordedEarningsCents, c.currency)}</div>
              <div className="text-xs text-muted">recorded earnings ({c.currency}) · {c.completedTrips} completed{c.pendingFinalTrips > 0 ? ` · ${c.pendingFinalTrips} pending final` : ''}</div>
              {c.collectedCents > 0 && <div className="mt-1 text-xs text-muted">Recorded collected: {money(c.collectedCents, c.currency)} (driver-reported)</div>}
            </div>
          ))}
          <p className="text-[11px] text-muted">Recorded earnings = completed trips with a known final amount, before expenses — not net profit. Unknown metered amounts are pending, not zero. Payment is to the driver; this is not platform revenue.</p>

          <div className="card p-4">
            <div className="mb-2 font-medium">Daily</div>
            {data.daily.length === 0 ? <p className="text-sm text-muted">No data.</p> : (
              <>
                <div className="flex items-end gap-1" style={{ height: 120 }} role="img" aria-label="Daily recorded earnings">
                  {data.daily.map((d) => <div key={d.day + d.currency} className="flex min-w-[8px] flex-1 flex-col items-center justify-end" title={`${d.day}: ${money(d.recordedEarningsCents, d.currency)}`}><div className="w-full rounded-t bg-accent" style={{ height: `${(d.recordedEarningsCents / max) * 100}%` }} /></div>)}
                </div>
                <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Show as list</summary><ul className="mt-1 space-y-0.5">{data.daily.map((d) => <li key={d.day + d.currency}>{d.day}: {money(d.recordedEarningsCents, d.currency)} · {d.completedTrips} trips</li>)}</ul></details>
              </>
            )}
          </div>
          <a href={`/api/v1/driver/earnings/export?range=${range}`} className="btn-ghost block w-full text-center">Download statement (CSV)</a>
        </>
      )}
    </div>
  );
}

// ---- Profile ----
function ProfileSection({ dash }: { dash: Dashboard | null }) {
  const [docs, setDocs] = useState<{ available: boolean; note?: string; documents: { slot: string; status: string; expiresAt: string | null }[] } | null>(null);
  useEffect(() => { api<typeof docs>('/driver/documents').then(setDocs).catch(() => {}); }, []);
  async function signOut() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/driver/login'; }
  const statusColor: Record<string, string> = { VALID: 'text-accent', EXPIRING: 'text-warn', EXPIRED: 'text-danger', UNDER_REVIEW: 'text-muted', ACTION_NEEDED: 'text-warn' };

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Profile</h1>
      <div className="card p-4">
        <div className="font-semibold">{dash?.driver.name ?? 'Driver'}</div>
        <div className="text-xs text-muted">Eligibility: {dash?.driver.eligibility ?? '—'}</div>
        <div className="mt-2"><NotifyToggle pushUrl="/driver/push" /></div>
      </div>

      <div className="card p-4">
        <div className="mb-1 font-medium">Vehicle</div>
        {dash?.vehicle ? <div className="text-sm">{dash.vehicle.plate} · {dash.vehicle.label} · {dash.vehicle.vClass} · {dash.vehicle.seats} seats</div> : <div className="text-sm text-muted">No approved vehicle.</div>}
        <p className="mt-1 text-[11px] text-muted">A vehicle change goes through operator review; you can’t change the operational binding yourself.</p>
      </div>

      <div className="card p-4">
        <div className="mb-1 font-medium">Documents</div>
        {!docs ? <p className="text-sm text-muted">Loading…</p> : !docs.available ? <p className="text-sm text-muted">{docs.note}</p> : docs.documents.length === 0 ? <p className="text-sm text-muted">No documents on file.</p> : (
          <ul className="space-y-1 text-sm">{docs.documents.map((d) => <li key={d.slot} className="flex items-center justify-between"><span>{d.slot.replace(/_/g, ' ')}</span><span className={statusColor[d.status] ?? 'text-muted'}>{d.status.replace(/_/g, ' ').toLowerCase()}{d.expiresAt ? ` · ${d.expiresAt.slice(0, 10)}` : ''}</span></li>)}</ul>
        )}
        {docs?.documents.some((d) => d.status === 'EXPIRING' || d.status === 'EXPIRED' || d.status === 'ACTION_NEEDED') && <p className="mt-2 text-[11px] text-muted">To renew a document, contact the operator (see Help). Self-serve document renewal is not yet available.</p>}
      </div>

      <div className="card p-4">
        <div className="mb-1 font-medium">Help</div>
        {dash?.support && (dash.support.phone || dash.support.email) ? (
          <div className="space-y-1 text-sm">
            {dash.support.operatorName && <div className="text-muted">{dash.support.operatorName}</div>}
            {dash.support.phone && <a href={`tel:${dash.support.phone}`} className="block text-accent">📞 {dash.support.phone}</a>}
            {dash.support.email && <a href={`mailto:${dash.support.email}`} className="block text-accent">✉️ {dash.support.email}</a>}
          </div>
        ) : <p className="text-sm text-muted">Support contact isn’t configured yet. Ask the operator to set it in admin settings.</p>}
      </div>

      <button onClick={signOut} className="btn-ghost w-full !text-danger">Sign out</button>
    </div>
  );
}

// ---- Bottom nav ----
function BottomNav({ tab, setTab, hasOffer, hasTrip }: { tab: Tab; setTab: (t: Tab) => void; hasOffer: boolean; hasTrip: boolean }) {
  const items: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: 'Home', icon: '🏠' }, { id: 'trips', label: 'Trips', icon: '🧾' },
    { id: 'earnings', label: 'Earnings', icon: '€' }, { id: 'profile', label: 'Profile', icon: '👤' },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-page/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto flex max-w-lg">
        {items.map((it) => (
          <button key={it.id} onClick={() => setTab(it.id)} className={`relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[11px] ${tab === it.id ? 'text-accent' : 'text-muted'}`}>
            <span className="text-base leading-none">{it.icon}</span>
            <span>{it.label}</span>
            {it.id === 'home' && (hasOffer || hasTrip) && tab !== 'home' && <span className={`absolute right-[28%] top-1.5 h-2 w-2 rounded-full ${hasOffer ? 'bg-accent' : 'bg-warn'}`} />}
          </button>
        ))}
      </div>
    </nav>
  );
}
