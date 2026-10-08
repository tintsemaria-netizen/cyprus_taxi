'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { ChatPanel } from '@/components/ChatPanel';
import { NotifyToggle } from '@/components/NotifyToggle';
import { api, ApiRequestError, uuid } from '@/lib/api-client';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { ScheduledRides } from '@/components/driver/ScheduledRides';
import { unlockOfferSound, playOfferChime, vibrateOffer, keepScreenOn } from '@/lib/driver-alerts';
import { formatFlight } from '@/lib/flight';
import { useT, MsgKey } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export const dynamic = 'force-dynamic';

interface Trip {
  bookingId: string; reference: string; status: string; revision: number;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  passengerName: string; passengerPhone: string; note: string | null; flightNumber?: string | null; passengerCount: number; vClass: string;
  scheduledAt: string | null; waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null; allowedNext: string[];
}
interface CurrentTrip { onDuty: boolean; available: boolean; trip: Trip | null }
interface Offer {
  offerId: string; expiresAt: string; pickupEtaSec: number | null; pickupDistanceM: number | null;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  vClass: string; passengerCount: number; passengerName: string; note: string | null; flightNumber?: string | null; scheduledAt: string | null;
  fareCents: number | null; priceType: string | null; currency: string; fareBreakdown: { label: string; cents: number }[] | null;
}
interface TripCard {
  bookingId: string; reference: string; at: string; pickupLabel: string; dropoffLabel: string; vClass: string; passengerCount: number;
  driverStatus: string; fare: { label: string; cents: number | null; currency: string }; payment: string | null;
}
interface Dashboard {
  driver: { name: string; eligibility: string; canWork: boolean; rating: { average: number | null; count: number } };
  status: { onDuty: boolean; available: boolean; sharingSessionOpen: boolean; hasActiveTrip: boolean; activeBookingId: string | null };
  vehicle: { plate: string; vClass: string; seats: number; label: string } | null;
  today: { recordedEarnings: { currency: string; cents: number }[]; pendingFinalTrips: number; completedTrips: number; onlineSeconds: number };
  latestTrips: TripCard[];
  alerts: { level: string; code: string; message: string; action?: { label: string; href: string } }[];
  support: { operatorName: string | null; phone: string | null; email: string | null };
}

type Tab = 'home' | 'trips' | 'earnings' | 'profile';

// Locale-aware formatting helpers for the driver app (money, durations, distances, status labels).
function useDriverFmt() {
  const { t, fmt } = useT();
  const money = (cents: number | null, currency = 'EUR') => {
    if (cents == null) return '—';
    try { return fmt.money(cents, currency); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
  };
  const dur = (s: number) => (s < 60 ? t('driver.units.sec', { n: s }) : s < 3600 ? t('driver.units.min', { n: Math.round(s / 60) }) : t('driver.units.hourMin', { h: Math.floor(s / 3600), m: Math.round((s % 3600) / 60) }));
  const km = (m: number) => (m < 1000 ? t('driver.units.meters', { n: Math.round(m) }) : t('driver.units.km', { n: (m / 1000).toFixed(1) }));
  // Translate a dynamic key, falling back to the given text when the catalog has no entry.
  const tOr = (key: string, fallback: string) => { const v = t(key as MsgKey); return v === key ? fallback : v; };
  const statusLabel = (st: string) => (st === 'RELEASED' ? t('driver.status.RELEASED') : tOr(`common.status.${st}`, st.replace(/_/g, ' ')));
  const fareLabel = (l: string) => tOr(`driver.fareLabel.${l}`, l);
  const paymentLabel = (pm: string) => tOr(`driver.payment.${pm}`, pm);
  return { money, dur, km, tOr, statusLabel, fareLabel, paymentLabel };
}

export default function Page() {
  return <StaffShell roles={['DRIVER']}>{() => <Driver />}</StaffShell>;
}

function Driver() {
  const { t, tError } = useT();
  // Ref so the long-lived polling callbacks always use the current locale without re-subscribing.
  const tErrRef = useRef(tError);
  tErrRef.current = tError;
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
    catch (e) { if (e instanceof ApiRequestError) setBanner(tErrRef.current(e)); }
  }, []);
  const loadDash = useCallback(async () => {
    try { setDash(await api<Dashboard>('/driver/dashboard')); } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    load(); loadDash();
    const t = setInterval(() => { if (document.visibilityState === 'visible') { load(); loadDash(); } }, 5000);
    return () => { clearInterval(t); stopGps(); };
     
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
        if (err.code === err.PERMISSION_DENIED) { setGps((g) => ({ ...g, active: false, error: 'denied' })); stopGps(); return; }
        if (highAccuracy) { beginWatch(false); return; }
        setGps((g) => ({ ...g, error: lastPos.current ? null : 'acquiring' }));
      },
      highAccuracy ? { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 } : { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 },
    );
  }
  function startGps() {
    if (!('geolocation' in navigator)) { setGps({ active: false, error: 'unsupported', last: null }); return; }
    session.current = uuid(); seq.current = 0; setGps({ active: true, error: null, last: null });
    beginWatch(true); sendTimer.current = setInterval(sendSample, 5000);
  }
  async function sendSample() {
    const p = lastPos.current; if (!p) return; seq.current += 1;
    try {
      await api('/driver/location', { method: 'POST', body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? 0, heading: p.coords.heading ?? undefined, speed: p.coords.speed ?? undefined, sampledAt: new Date(p.timestamp).toISOString(), gpsSession: session.current, sequence: seq.current } });
      setGps((g) => ({ ...g, last: new Date().toISOString(), error: null }));
    } catch (e) { if (e instanceof ApiRequestError && (e.body.code === 'OFF_DUTY' || e.body.code === 'INACTIVE')) stopGps(); }
  }
  async function setDuty(onDuty: boolean) {
    if (onDuty) unlockOfferSound(); // user gesture: lets the offer chime play later
    try {
      const r = await api<{ onDuty: boolean }>('/driver/availability', { method: 'PATCH', body: { onDuty, available: onDuty } });
      if (!r.onDuty) stopGps();
      await load(); await loadDash();
    } catch (e) { if (e instanceof ApiRequestError) setBanner(tErrRef.current(e)); }
  }

  // Offer polling — runs regardless of the visible tab (never stops on tab switch).
  useEffect(() => {
    if (!data?.onDuty || data.trip) { setOffer(null); return; }
    let alive = true;
    const poll = async () => { try { const r = await api<{ offer: Offer | null }>('/driver/offers'); if (alive) setOffer(r.offer); } catch { /* transient */ } };
    poll(); const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [data?.onDuty, data?.trip]);

  // Keep the screen awake while on duty (a sleeping screen suspends polling + GPS).
  useEffect(() => {
    if (!data?.onDuty) return;
    return keepScreenOn();
  }, [data?.onDuty]);

  // Ring + vibrate for a new offer, repeating every 2 s until it is answered or expires.
  const offerId = offer?.offerId ?? null;
  useEffect(() => {
    if (!offerId) return;
    const ring = () => { playOfferChime(); vibrateOffer(); };
    ring();
    const t = setInterval(ring, 2000);
    return () => clearInterval(t);
  }, [offerId]);

  const ticking = !!offer || data?.trip?.status === 'ARRIVED';
  useEffect(() => { if (!ticking) return; setNowMs(Date.now()); const t = setInterval(() => setNowMs(Date.now()), 500); return () => clearInterval(t); }, [ticking]);

  async function acceptCurrentOffer(id: string) {
    setOfferBusy(true);
    try { await api(`/driver/offers/${id}/accept`, { method: 'POST' }); setOffer(null); setTab('home'); await load(); await loadDash(); }
    catch (e) { if (e instanceof ApiRequestError) setBanner(tErrRef.current(e)); setOffer(null); }
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
    catch (e) { if (e instanceof ApiRequestError) setBanner(tErrRef.current(e)); await load(); }
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

  if (!data) return <div className="p-8 text-muted">{t('common.loading')}</div>;
  const trip = data.trip;
  const offerSecs = offer ? Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - nowMs) / 1000)) : 0;

  return (
    <div className="mx-auto max-w-lg p-4 pb-24 sm:p-6 sm:pb-24">
      {banner && <p className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" onClick={() => setBanner(null)}>{banner}</p>}

      {/* Persistent cross-section bars: an offer alert, or a return-to-active-trip bar. */}
      {tab !== 'home' && offer && !trip && (
        <button onClick={() => setTab('home')} className="mb-3 flex w-full items-center justify-between rounded-[12px] border-2 border-accent bg-accent/10 px-3 py-2 text-sm">
          <span className="font-semibold text-accent">{t('driver.banner.newOffer')}</span>
          <span className={offerSecs <= 5 ? 'text-danger' : 'text-muted'}>{t('driver.banner.offerCountdown', { secs: offerSecs })}</span>
        </button>
      )}
      {tab !== 'home' && trip && (
        <button onClick={() => setTab('home')} className="mb-3 flex w-full items-center justify-between rounded-[12px] border border-edge bg-elevated px-3 py-2 text-sm">
          <span className="font-medium">{t('driver.banner.activeTrip', { reference: trip.reference })}</span>
          <span className="text-accent">{t('driver.banner.returnToTrip')}</span>
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
  const { t, tp, fmt } = useT();
  const { money, dur, km, statusLabel } = useDriverFmt();
  const [ask, setAsk] = useState<'complete' | 'release' | null>(null);
  const trip = data.trip;
  const blocker = dash?.alerts.find((a) => a.level === 'blocker');

  const navMarkers: MapMarker[] = [];
  if (pos) navMarkers.push({ id: 'me', lat: pos.lat, lng: pos.lng, kind: 'vehicle', label: t('driver.map.you') });
  if (trip) { navMarkers.push({ id: 'pk', lat: trip.pickup.lat, lng: trip.pickup.lng, kind: 'pickup', label: t('driver.map.pickup') }); if (trip.status === 'IN_PROGRESS') navMarkers.push({ id: 'dp', lat: trip.dropoff.lat, lng: trip.dropoff.lng, kind: 'dropoff', label: t('driver.map.destination') }); }

  return (
    <div className="space-y-4">
      {/* Status / duty */}
      <div className="card flex items-center justify-between p-4">
        <div>
          <div className="font-semibold">{dash?.driver.name ? t('driver.duty.greeting', { name: dash.driver.name }) : (data.onDuty ? t('driver.duty.onDuty') : t('driver.duty.offDuty'))}</div>
          <div className="text-xs text-muted">{dash?.vehicle ? `${dash.vehicle.plate} · ${dash.vehicle.label}` : t('driver.duty.noVehicle')}</div>
          <div className="mt-0.5 text-xs">{data.onDuty ? <span className="text-accent">{data.trip ? t('driver.duty.onDutyOnTrip') : t('driver.duty.onDutyReady')}</span> : <span className="text-muted">{t('driver.duty.offDuty')}</span>}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {blocker && !data.onDuty ? (
            <span className="rounded-full bg-danger/15 px-3 py-1 text-xs text-danger">{t('driver.duty.cantGoOnline')}</span>
          ) : (
            <button className={`min-h-[44px] ${data.onDuty ? 'btn-ghost' : 'btn-primary'}`} onClick={() => props.onDuty(!data.onDuty)}>{data.onDuty ? t('driver.duty.goOffline') : t('driver.duty.goOnline')}</button>
          )}
          <NotifyToggle pushUrl="/driver/push" />
        </div>
      </div>

      {/* Eligibility blocker replaces the online action */}
      {blocker && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">
          <p className="font-medium text-danger">{blocker.code === 'NO_VEHICLE' ? t('driver.alerts.noVehicle') : blocker.message}</p>
          {blocker.action && <a href={blocker.action.href} className="mt-1 inline-block text-xs underline">{blocker.action.label}</a>}
        </div>
      )}

      {/* GPS sharing */}
      {data.onDuty && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div><div className="font-semibold">{t('driver.gps.title')}</div><div className="text-xs text-muted">{gps.active ? <span className="text-accent">{t('driver.gps.active')}{gps.last ? t('driver.gps.sentAt', { time: fmt.time(gps.last) }) : ''}</span> : t('driver.gps.off')}</div></div>
            {gps.active ? <button className="btn-ghost min-h-[44px]" onClick={props.onStopGps}>{t('driver.gps.stop')}</button> : <button className="btn-primary min-h-[44px]" onClick={props.onStartGps}>{t('driver.gps.start')}</button>}
          </div>
          {gps.error && <p className={`mt-2 text-xs ${gps.error === 'acquiring' ? 'text-warn' : 'text-danger'}`}>{t(`driver.gps.${gps.error as 'denied' | 'acquiring' | 'unsupported'}`)}</p>}
          <p className="mt-2 text-xs text-muted">{t('driver.gps.note')}</p>
        </div>
      )}

      {/* Offer takes priority */}
      {offer && !trip && (
        <div className="card border-2 border-accent p-4">
          <div className="flex items-center justify-between"><span className="font-semibold text-accent">{t('driver.offer.title')}</span><span className={`chip ${offerSecs <= 5 ? '!text-danger' : ''}`}>⏳ {t('driver.units.sec', { n: offerSecs })}</span></div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">{t('driver.offer.pickup')}</span><span className="ml-auto text-right font-medium">{offer.pickup.label}</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">{t('driver.offer.destination')}</span><span className="ml-auto text-right font-medium">{offer.dropoff.label}</span></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            {offer.pickupEtaSec != null && <span className="rounded-full bg-elevated px-2 py-1">{t('driver.offer.etaToPickup', { min: Math.max(1, Math.round(offer.pickupEtaSec / 60)) })}</span>}
            {offer.pickupDistanceM != null && <span className="rounded-full bg-elevated px-2 py-1">{t('driver.offer.away', { dist: km(offer.pickupDistanceM) })}</span>}
            <span className="rounded-full bg-elevated px-2 py-1">{t('driver.units.paxShort', { count: offer.passengerCount })} · {offer.vClass}</span>
            {offer.scheduledAt && <span className="rounded-full bg-elevated px-2 py-1">🕒 {fmt.dateTime(offer.scheduledAt)}</span>}
          </div>
          {/* Complete passenger info (phone revealed on accept). */}
          <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
            <div className="font-medium">{t('driver.offer.passengerLine', { name: offer.passengerName, passengers: tp('common.passengers', offer.passengerCount), vClass: offer.vClass })}</div>
            {offer.note && <div className="mt-1 text-xs text-warn">{t('driver.offer.note', { note: offer.note })}</div>}
            {offer.flightNumber && <div className="mt-1 font-mono text-xs text-ink">✈ {t('driver.scheduled.flight', { flight: formatFlight(offer.flightNumber) })}</div>}
            <div className="mt-1 text-xs text-muted">{t('driver.offer.phoneHidden')}</div>
          </div>
          {/* Full fare breakdown so the driver sees all prices before accepting. */}
          <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{t('driver.offer.fare')}</span>
              <span className="text-xs text-muted">{offer.priceType === 'UPFRONT_DYNAMIC' ? t('driver.offer.upfront') : t('driver.offer.meterEstimate')}</span>
            </div>
            {offer.fareBreakdown?.length ? offer.fareBreakdown.map((l, i) => (
              <div key={i} className="flex justify-between gap-3 text-xs text-muted"><span className="min-w-0 truncate">{l.label}</span><span className="shrink-0">{money(l.cents, offer.currency)}</span></div>
            )) : <div className="text-xs text-muted">{t('driver.offer.noEstimate')}</div>}
            <div className="mt-1 flex justify-between border-t border-edge pt-1 font-semibold"><span>{offer.priceType === 'UPFRONT_DYNAMIC' ? t('driver.offer.total') : t('driver.offer.estimatedTotal')}</span><span>{offer.fareCents != null ? money(offer.fareCents, offer.currency) : '—'}</span></div>
            {offer.priceType !== 'UPFRONT_DYNAMIC' && <div className="mt-1 text-xs text-muted">{t('driver.offer.meterSettled')}</div>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="btn-ghost min-h-[44px] !text-danger border border-danger/40" disabled={offerBusy} onClick={() => props.onDecline(offer.offerId)}>{t('driver.offer.decline')}</button>
            <button className="btn-primary min-h-[44px]" disabled={offerBusy || offerSecs === 0} onClick={() => props.onAccept(offer.offerId)}>{t('driver.offer.accept')}</button>
          </div>
        </div>
      )}

      {/* Active trip (priority over stats) */}
      {trip ? (
        <div className="card p-4">
          <div className="flex items-center justify-between"><span className="font-mono text-accent">{trip.reference}</span><span className="chip">{statusLabel(trip.status)}</span></div>
          <div className="mt-3 h-56 overflow-hidden rounded-[12px] border border-edge"><AutoMapView markers={navMarkers} route={navRoute} center={pos ?? trip.pickup} zoom={13} interactive className="h-full w-full" /></div>
          <p className="mt-1 text-xs text-muted">{trip.status === 'IN_PROGRESS' ? t('driver.trip.routeToDestination') : t('driver.trip.routeToPickup')}{!pos && t('driver.trip.noPosHint')}</p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-muted">{t('driver.trip.pickup')}</span><span className="ml-auto text-right font-medium">{trip.pickup.label}</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ink" /><span className="text-muted">{t('driver.trip.destination')}</span><span className="ml-auto text-right font-medium">{trip.dropoff.label}</span></div>
          </div>
          <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
            <div className="font-medium">{trip.passengerName} · {t('driver.units.paxShort', { count: trip.passengerCount })} · {trip.vClass}</div>
            {trip.note && <div className="mt-1 text-xs text-muted">{t('driver.trip.note', { note: trip.note })}</div>}
            {trip.flightNumber && <div className="mt-1 font-mono text-xs text-ink">✈ {t('driver.scheduled.flight', { flight: formatFlight(trip.flightNumber) })}</div>}
            <div className="mt-3"><ChatPanel key={trip.bookingId} listUrl={`/driver/bookings/${trip.bookingId}/messages`} postUrl={`/driver/bookings/${trip.bookingId}/messages`} pushUrl="/driver/push" me="DRIVER" peerLabel="passenger" /></div>
            <div className="mt-3 flex gap-2">
              <a href={`tel:${trip.passengerPhone}`} className="btn-ghost !min-h-[44px] flex-1 !py-2 text-sm">{t('driver.trip.call')}</a>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${(trip.status === 'IN_PROGRESS' ? trip.dropoff : trip.pickup).lat},${(trip.status === 'IN_PROGRESS' ? trip.dropoff : trip.pickup).lng}&travelmode=driving`} target="_blank" rel="noreferrer" className="btn-ghost !min-h-[44px] flex-1 !py-2 text-sm">{t('driver.trip.navigate')}</a>
            </div>
            <p className="mt-2 text-xs text-warn">{t('driver.trip.navigateWarning')}</p>
          </div>
          {trip.status === 'ARRIVED' && trip.waiting && (() => {
            const elapsed = Math.max(0, Math.floor((nowMs - new Date(trip.waiting.arrivedAt).getTime()) / 1000));
            const freeLeft = Math.max(0, trip.waiting.graceSeconds - elapsed);
            const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
            return <div className="mt-3 rounded-[12px] border border-edge bg-elevated p-3 text-sm">{freeLeft > 0 ? (() => { const [before, after] = t('driver.trip.freeWaitingLeft', { time: '\u0000' }).split('\u0000'); return <span>{before}<span className="font-mono text-accent">{mmss(freeLeft)}</span>{after}</span>; })() : <span className="text-warn">{trip.waiting.paidRateCentsPerMin > 0 ? t('driver.trip.freeWaitingElapsedPaid', { rate: money(trip.waiting.paidRateCentsPerMin, 'EUR') }) : t('driver.trip.freeWaitingElapsedFree')}</span>}</div>;
          })()}
          <div className="mt-4 grid gap-2">
            {trip.status === 'ASSIGNED' && <button className="btn-primary min-h-[44px] w-full" onClick={() => props.onTripAction('status', { to: 'EN_ROUTE' })}>{t('driver.trip.onTheWay')}</button>}
            {trip.status === 'EN_ROUTE' && <button className="btn-primary min-h-[44px] w-full" onClick={() => props.onTripAction('arrive', {})}>{t('driver.trip.arrived')}</button>}
            {trip.status === 'ARRIVED' && (
              <div className="grid gap-2">
                <input inputMode="numeric" maxLength={4} placeholder={t('driver.trip.startCodePlaceholder')} value={startCode} onChange={(e) => setStartCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className="w-full rounded-[12px] border border-edge bg-page px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em]" />
                <button className="btn-primary min-h-[44px] w-full" disabled={startCode.length !== 4} onClick={() => props.onTripAction('start', { code: startCode })}>{t('driver.trip.startTrip')}</button>
              </div>
            )}
            {trip.status === 'IN_PROGRESS' && <button className="btn-primary min-h-[44px] w-full" onClick={() => setAsk('complete')}>{t('driver.trip.completeTrip')}</button>}
            {['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(trip.status) && <button className="btn-primary min-h-[44px] w-full !bg-elevated !text-danger border border-danger/40" onClick={() => setAsk('release')}>{t('driver.trip.release')}</button>}
          </div>
          {ask === 'complete' && (
            <ConfirmSheet title={t('driver.trip.completeTitle')} body={t('driver.trip.completeBody', { name: trip.passengerName })} confirmLabel={t('driver.trip.completeTrip')}
              onConfirm={() => { setAsk(null); props.onTripAction('complete', {}, { stopGps: true }); }} onCancel={() => setAsk(null)} cancelLabel={t('driver.trip.notYet')} />
          )}
          {ask === 'release' && (
            <ConfirmSheet title={t('driver.trip.releaseTitle')} body={t('driver.trip.releaseBody')} confirmLabel={t('driver.trip.releaseConfirm')} danger
              onConfirm={() => { setAsk(null); props.onTripAction('cancel', {}); }} onCancel={() => setAsk(null)} cancelLabel={t('driver.trip.keepRide')} />
          )}
        </div>
      ) : !offer && (
        <>
          {/* Today's three figures */}
          <div className="grid grid-cols-3 gap-2">
            <Figure label={t('driver.home.todaysEarnings')} value={dash ? (dash.today.recordedEarnings.length ? dash.today.recordedEarnings.map((e) => money(e.cents, e.currency)).join(' · ') : money(0)) : '—'} sub={dash && dash.today.pendingFinalTrips > 0 ? tp('driver.home.pending', dash.today.pendingFinalTrips) : t('driver.home.recorded')} />
            <Figure label={t('driver.home.completed')} value={dash ? String(dash.today.completedTrips) : '—'} sub={tp('driver.home.tripsToday', dash?.today.completedTrips ?? 0)} />
            <Figure label={t('driver.home.online')} value={dash ? dur(dash.today.onlineSeconds) : '—'} sub={t('driver.home.today')} />
          </div>
          {dash && dash.today.pendingFinalTrips === 0 && dash.today.completedTrips === 0 && <p className="text-center text-xs text-muted">{t('driver.home.earningsNote')}</p>}

          {/* Idle: last trips + one warning + help */}
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between"><span className="font-semibold">{t('driver.home.lastTrips')}</span><button onClick={props.goTrips} className="text-xs text-accent">{t('driver.home.seeAll')}</button></div>
            {dash?.latestTrips.length ? <div className="space-y-2">{dash.latestTrips.map((t) => <TripRow key={t.bookingId} t={t} />)}</div> : <p className="py-4 text-center text-sm text-muted">{t('driver.home.noTrips')}</p>}
          </div>
          {dash?.alerts.find((a) => a.level === 'warning') && (() => { const w = dash.alerts.find((a) => a.level === 'warning')!; return <div className="rounded-[12px] border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{w.message}{w.action && <a href={w.action.href} className="ml-2 underline">{w.action.label}</a>}</div>; })()}
        </>
      )}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-[12px] border border-edge bg-elevated p-3 text-center"><div className="truncate text-lg font-semibold">{value}</div><div className="text-xs text-muted">{label}</div><div className="text-xs text-muted">{sub}</div></div>;
}
function TripRow({ t, onClick }: { t: TripCard; onClick?: () => void }) {
  const { fmt } = useT();
  const { money, statusLabel, fareLabel, paymentLabel } = useDriverFmt();
  const badge = t.driverStatus === 'COMPLETED' ? 'text-accent' : t.driverStatus === 'RELEASED' ? 'text-muted' : 'text-warn';
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-edge p-2 text-left text-sm">
      <div className="min-w-0">
        <div className="truncate">{t.pickupLabel} → {t.dropoffLabel}</div>
        <div className="text-xs text-muted">{fmt.dateTime(t.at)} · <span className={badge}>{statusLabel(t.driverStatus)}</span></div>
      </div>
      <div className="shrink-0 text-right"><div className="font-medium">{t.fare.cents != null ? money(t.fare.cents, t.fare.currency) : (t.fare.label === 'Pending' ? fareLabel('Pending') : '—')}</div><div className="text-xs text-muted">{fareLabel(t.fare.label)}{t.payment ? ` · ${paymentLabel(t.payment)}` : ''}</div></div>
    </button>
  );
}

// ---- Trips ----
type Range = 'today' | 'week' | 'month';
function TripsModeToggle({ mode, setMode, count }: { mode: 'history' | 'prebook'; setMode: (m: 'history' | 'prebook') => void; count: number | null }) {
  const { t } = useT();
  return (
    <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1" role="tablist">
      {(['history', 'prebook'] as const).map((m) => (
        <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${mode === m ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>
          {m === 'history' ? t('driver.scheduled.tabHistory') : t('driver.scheduled.tabPrebook')}{m === 'prebook' && count ? ` · ${count}` : ''}
        </button>
      ))}
    </div>
  );
}

function TripsSection({ onOpen, activeDetail, onCloseDetail, onSettled }: { onOpen: (id: string) => void; activeDetail: string | null; onCloseDetail: () => void; onSettled: () => void }) {
  const { t, tError } = useT();
  const [range, setRange] = useState<Range>('today');
  const [mode, setMode] = useState<'history' | 'prebook'>('history');
  const [prebookCount, setPrebookCount] = useState<number | null>(null);
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
    } catch (e) { setErr(e ? tError(e) : t('driver.trips.loadFailed')); } finally { setLoading(false); }
  }, [range, cursor, t, tError]);

  // Reset only when the range changes; a reset load ignores the cursor, so loadPage's identity is irrelevant here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setItems([]); setCursor(null); loadPage(true); }, [range]);

  if (mode === 'prebook') {
    return (
      <div className="space-y-3">
        <TripsModeToggle mode={mode} setMode={setMode} count={prebookCount} />
        <ScheduledRides onCount={setPrebookCount} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <TripsModeToggle mode={mode} setMode={setMode} count={prebookCount} />
      <h1 className="text-xl font-semibold">{t('driver.trips.title')}</h1>
      <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1">
        {(['today', 'week', 'month'] as Range[]).map((r) => <button key={r} onClick={() => setRange(r)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${range === r ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>{t(`driver.range.${r}`)}</button>)}
      </div>
      {err && <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">{err} <button className="underline" onClick={() => loadPage(true)}>{t('driver.trips.retry')}</button></div>}
      {items.length === 0 && !loading && !err ? <p className="py-8 text-center text-sm text-muted">{t('driver.trips.empty')}</p> : (
        <div className="space-y-2">{items.map((t) => <TripRow key={t.bookingId + t.at} t={t} onClick={() => onOpen(t.bookingId)} />)}</div>
      )}
      {cursor && <button onClick={() => loadPage(false)} disabled={loading} className="btn-ghost w-full">{loading ? t('common.loading') : t('driver.trips.loadMore')}</button>}
      {activeDetail && <TripDetailModal bookingId={activeDetail} onClose={onCloseDetail} onSettled={() => { onSettled(); loadPage(true); }} />}
    </div>
  );
}

interface Detail extends TripCard {
  timestamps: { assignedAt: string; endedAt: string | null }; fareBreakdown: { label?: string; amountCents?: number }[] | null;
  releaseReason: string | null; settlement: { current: { revision: number; reportedFinalCents: number; currency: string; paymentReceived: boolean } | null; history: unknown[] } | null; canResume: boolean; canSettle: boolean;
}
function TripDetailModal({ bookingId, onClose, onSettled }: { bookingId: string; onClose: () => void; onSettled: () => void }) {
  const { t, tError, fmt } = useT();
  const { money, statusLabel, fareLabel, paymentLabel } = useDriverFmt();
  const [d, setD] = useState<Detail | null>(null);
  const [amount, setAmount] = useState('');
  const [received, setReceived] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setD(await api<Detail>(`/driver/trips/${bookingId}`)); } catch (e) { setErr(e ? tError(e) : t('driver.detail.loadFailed')); } }, [bookingId, t, tError]);
  useEffect(() => { load(); }, [load]);

  async function submitSettlement() {
    setBusy(true); setErr(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setErr(t('driver.detail.invalidAmount')); setBusy(false); return; }
    try {
      await api(`/driver/bookings/${bookingId}/settlement`, { method: 'POST', body: { reportedFinalCents: cents, paymentReceived: received, ...(d?.settlement?.current ? { correctionReason: reason, expectedRevision: d.settlement.current.revision } : {}) } });
      setAmount(''); setReason(''); await load(); onSettled();
    } catch (e) { setErr(e instanceof ApiRequestError ? tError(e) : t('driver.detail.saveFailed')); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[16px] border border-edge bg-page p-4 sm:rounded-[16px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between"><span className="font-mono text-accent">{d?.reference ?? '…'}</span><button onClick={onClose} className="text-muted">✕</button></div>
        {err && <p className="mb-2 text-sm text-danger">{err}</p>}
        {!d ? <p className="text-muted">{t('common.loading')}</p> : (
          <div className="space-y-3 text-sm">
            <div><span className="chip">{statusLabel(d.driverStatus)}</span></div>
            <div className="space-y-1"><div>{d.pickupLabel} → {d.dropoffLabel}</div><div className="text-xs text-muted">{t('driver.detail.meta', { vClass: d.vClass, pax: t('driver.units.paxShort', { count: d.passengerCount }), assigned: fmt.dateTime(d.timestamps.assignedAt) })}{d.timestamps.endedAt ? t('driver.detail.ended', { ended: fmt.dateTime(d.timestamps.endedAt) }) : ''}</div></div>
            {d.releaseReason && <p className="text-xs text-muted">{t('driver.detail.released', { reason: d.releaseReason })}</p>}
            <div className="rounded-[12px] border border-edge bg-elevated p-3">
              <div className="flex items-center justify-between"><span className="text-muted">{t('driver.detail.fare')}</span><span className="font-medium">{d.fare.cents != null ? money(d.fare.cents, d.fare.currency) : fareLabel(d.fare.label)}</span></div>
              <div className="text-xs text-muted">{fareLabel(d.fare.label)}{d.payment ? t('driver.detail.paymentSuffix', { payment: paymentLabel(d.payment) }) : ''}</div>
              {d.settlement?.current && <div className="mt-1 text-xs text-muted">{d.settlement.current.paymentReceived ? t('driver.detail.reportedReceived', { rev: d.settlement.current.revision }) : t('driver.detail.reported', { rev: d.settlement.current.revision })}</div>}
            </div>
            {d.canResume && <a href="/driver" className="btn-primary block w-full text-center">{t('driver.detail.returnToTrip')}</a>}
            {d.canSettle && (
              <div className="rounded-[12px] border border-edge bg-elevated p-3">
                <p className="font-medium">{d.settlement?.current ? t('driver.detail.correctSettlement') : t('driver.detail.recordMetered')}</p>
                <p className="mb-2 text-xs text-muted">{t('driver.detail.settlementNote')}</p>
                <input inputMode="decimal" placeholder={t('driver.detail.amountPlaceholder')} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} className="w-full rounded-[10px] border border-edge bg-page px-3 py-2" />
                <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} /> {t('driver.detail.paymentReceived')}</label>
                {d.settlement?.current && <input placeholder={t('driver.detail.reasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-[10px] border border-edge bg-page px-3 py-2 text-xs" />}
                <button onClick={submitSettlement} disabled={busy || !amount} className="btn-primary mt-2 w-full">{busy ? t('driver.detail.saving') : t('driver.detail.save')}</button>
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
  const { t, tp, tError } = useT();
  const { money } = useDriverFmt();
  const [range, setRange] = useState<Range>('week');
  const [data, setData] = useState<{ summary: { byCurrency: { currency: string; completedTrips: number; recordedEarningsCents: number; knownFinalTrips: number; pendingFinalTrips: number; collectedCents: number }[]; completedTrips: number; pendingFinalTrips: number; onlineSeconds: number }; daily: { day: string; recordedEarningsCents: number; completedTrips: number; currency: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await api(`/driver/earnings?range=${range}`)); } catch (e) { setErr(e ? tError(e) : t('driver.detail.loadFailed')); } finally { setLoading(false); }
  }, [range, t, tError]);
  useEffect(() => { load(); }, [load]);

  const max = Math.max(1, ...(data?.daily.map((d) => d.recordedEarningsCents) ?? [0]));
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t('driver.earnings.title')}</h1>
      <div className="flex gap-1 rounded-[12px] border border-edge bg-elevated p-1">
        {(['today', 'week', 'month'] as Range[]).map((r) => <button key={r} onClick={() => setRange(r)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${range === r ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>{t(`driver.range.${r}`)}</button>)}
      </div>
      {err && <div className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm">{t('driver.earnings.loadFailed', { error: err })} <button className="underline" onClick={load}>{t('driver.trips.retry')}</button></div>}
      {loading && !data && <p className="text-muted">{t('common.loading')}</p>}
      {data && (
        <>
          {data.summary.byCurrency.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t('driver.earnings.empty')}</p> : data.summary.byCurrency.map((c) => (
            <div key={c.currency} className="card p-4">
              <div className="text-3xl font-semibold">{money(c.recordedEarningsCents, c.currency)}</div>
              <div className="text-xs text-muted">{t('driver.earnings.summary', { currency: c.currency, completed: c.completedTrips })}{c.pendingFinalTrips > 0 ? t('driver.earnings.pendingFinal', { count: c.pendingFinalTrips }) : ''}</div>
              {c.collectedCents > 0 && <div className="mt-1 text-xs text-muted">{t('driver.earnings.collected', { amount: money(c.collectedCents, c.currency) })}</div>}
            </div>
          ))}
          <p className="text-xs text-muted">{t('driver.earnings.note')}</p>

          <div className="card p-4">
            <div className="mb-2 font-medium">{t('driver.earnings.daily')}</div>
            {data.daily.length === 0 ? <p className="text-sm text-muted">{t('driver.earnings.noData')}</p> : (
              <>
                <div className="flex items-end gap-1" style={{ height: 120 }} role="img" aria-label={t('driver.earnings.chartLabel')}>
                  {data.daily.map((d) => <div key={d.day + d.currency} className="flex min-w-[8px] flex-1 flex-col items-center justify-end" title={`${d.day}: ${money(d.recordedEarningsCents, d.currency)}`}><div className="w-full rounded-t bg-accent" style={{ height: `${(d.recordedEarningsCents / max) * 100}%` }} /></div>)}
                </div>
                <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">{t('driver.earnings.showList')}</summary><ul className="mt-1 space-y-0.5">{data.daily.map((d) => <li key={d.day + d.currency}>{d.day}: {money(d.recordedEarningsCents, d.currency)} · {tp('driver.earnings.trips', d.completedTrips)}</li>)}</ul></details>
              </>
            )}
          </div>
          <a href={`/api/v1/driver/earnings/export?range=${range}`} className="btn-ghost block w-full text-center">{t('driver.earnings.download')}</a>
        </>
      )}
    </div>
  );
}

// ---- Profile ----
function ProfileSection({ dash }: { dash: Dashboard | null }) {
  const { t, tp } = useT();
  const { tOr } = useDriverFmt();
  const [docs, setDocs] = useState<{ available: boolean; note?: string; documents: { slot: string; status: string; expiresAt: string | null }[] } | null>(null);
  useEffect(() => { api<typeof docs>('/driver/documents').then(setDocs).catch(() => {}); }, []);
  async function signOut() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/driver/login'; }
  const statusColor: Record<string, string> = { VALID: 'text-accent', EXPIRING: 'text-warn', EXPIRED: 'text-danger', UNDER_REVIEW: 'text-muted', ACTION_NEEDED: 'text-warn' };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h1 className="text-xl font-semibold">{t('driver.profile.title')}</h1><LanguageSwitcher /></div>
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold">{dash?.driver.name ?? t('driver.profile.driverFallback')}</div>
          {dash && (dash.driver.rating.count > 0
            ? <div className="text-sm font-semibold text-accent" title={tp('driver.profile.ratings', dash.driver.rating.count)}>★ {dash.driver.rating.average?.toFixed(1)} <span className="text-xs font-normal text-muted">({dash.driver.rating.count})</span></div>
            : <div className="text-xs text-muted">{t('driver.profile.noRatings')}</div>)}
        </div>
        <div className="text-xs text-muted">{t('driver.profile.eligibility', { value: dash?.driver.eligibility ? tOr(`driver.profile.eligibilityValue.${dash.driver.eligibility}`, dash.driver.eligibility) : '—' })}</div>
        <div className="mt-2"><NotifyToggle pushUrl="/driver/push" /></div>
      </div>

      <div className="card p-4">
        <div className="mb-1 font-medium">{t('driver.profile.vehicle')}</div>
        {dash?.vehicle ? <div className="text-sm">{dash.vehicle.plate} · {dash.vehicle.label} · {dash.vehicle.vClass} · {tp('driver.profile.seats', dash.vehicle.seats)}</div> : <div className="text-sm text-muted">{t('driver.profile.noVehicle')}</div>}
        <p className="mt-1 text-xs text-muted">{t('driver.profile.vehicleNote')}</p>
      </div>

      <div className="card p-4">
        <div className="mb-1 font-medium">{t('driver.profile.documents')}</div>
        {!docs ? <p className="text-sm text-muted">{t('common.loading')}</p> : !docs.available ? <p className="text-sm text-muted">{docs.note}</p> : docs.documents.length === 0 ? <p className="text-sm text-muted">{t('driver.profile.noDocuments')}</p> : (
          <ul className="space-y-1 text-sm">{docs.documents.map((d) => <li key={d.slot} className="flex items-center justify-between"><span>{d.slot.replace(/_/g, ' ')}</span><span className={statusColor[d.status] ?? 'text-muted'}>{tOr(`driver.profile.docStatus.${d.status}`, d.status.replace(/_/g, ' ').toLowerCase())}{d.expiresAt ? ` · ${d.expiresAt.slice(0, 10)}` : ''}</span></li>)}</ul>
        )}
        {docs?.documents.some((d) => d.status === 'EXPIRING' || d.status === 'EXPIRED' || d.status === 'ACTION_NEEDED') && <p className="mt-2 text-xs text-muted">{t('driver.profile.renewNote')}</p>}
      </div>

      <div className="card p-4">
        <div className="mb-1 font-medium">{t('driver.profile.help')}</div>
        {dash?.support && (dash.support.phone || dash.support.email) ? (
          <div className="space-y-1 text-sm">
            {dash.support.operatorName && <div className="text-muted">{dash.support.operatorName}</div>}
            {dash.support.phone && <a href={`tel:${dash.support.phone}`} className="block text-accent">📞 {dash.support.phone}</a>}
            {dash.support.email && <a href={`mailto:${dash.support.email}`} className="block text-accent">✉️ {dash.support.email}</a>}
          </div>
        ) : <p className="text-sm text-muted">{t('driver.profile.noSupport')}</p>}
      </div>

      <button onClick={signOut} className="btn-ghost w-full !text-danger">{t('driver.profile.signOut')}</button>
    </div>
  );
}

// ---- Bottom nav ----
function BottomNav({ tab, setTab, hasOffer, hasTrip }: { tab: Tab; setTab: (t: Tab) => void; hasOffer: boolean; hasTrip: boolean }) {
  const { t } = useT();
  const items: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: t('driver.nav.home'), icon: '🏠' }, { id: 'trips', label: t('driver.nav.trips'), icon: '🧾' },
    { id: 'earnings', label: t('driver.nav.earnings'), icon: '€' }, { id: 'profile', label: t('driver.nav.profile'), icon: '👤' },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-page/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto flex max-w-lg">
        {items.map((it) => (
          <button key={it.id} onClick={() => setTab(it.id)} className={`relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs ${tab === it.id ? 'text-accent' : 'text-muted'}`}>
            <span className="text-base leading-none" aria-hidden>{it.icon}</span>
            <span>{it.label}</span>
            {it.id === 'home' && (hasOffer || hasTrip) && tab !== 'home' && <span className={`absolute right-[28%] top-1.5 h-2 w-2 rounded-full ${hasOffer ? 'bg-accent' : 'bg-warn'}`} />}
          </button>
        ))}
      </div>
    </nav>
  );
}
