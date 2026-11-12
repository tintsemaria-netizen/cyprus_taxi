'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffShell } from '@/components/staff/StaffShell';
import { NotifyToggle } from '@/components/NotifyToggle';
import { InstallPrompt } from '@/components/InstallPrompt';
import { api, ApiRequestError, uuid } from '@/lib/api-client';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { ScheduledRides } from '@/components/driver/ScheduledRides';
import { DriverNavigation } from '@/components/driver/DriverNavigation';
import { DriverHomeMap } from '@/components/driver/DriverHomeMap';
import { unlockOfferSound, playOfferChime, vibrateOffer, keepScreenOn } from '@/lib/driver-alerts';
import { formatFlight } from '@/lib/flight';
import { useT, MsgKey } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

export const dynamic = 'force-dynamic';

interface Trip {
  bookingId: string; reference: string; status: string; revision: number;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  passengerName: string; passengerPhone: string; note: string | null; flightNumber?: string | null; passengerCount: number; luggageCount?: number; vClass: string;
  scheduledAt: string | null; waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null; allowedNext: string[];
}
interface CurrentTrip { onDuty: boolean; available: boolean; trip: Trip | null }
interface Offer {
  offerId: string; expiresAt: string; expiresInMs: number; localDeadline?: number; pickupEtaSec: number | null; pickupDistanceM: number | null;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  vClass: string; passengerCount: number; luggageCount?: number; passengerName: string; note: string | null; flightNumber?: string | null; scheduledAt: string | null;
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

// Bottom tabs (2026-11-13): Home | Orders (free orders + pre-bookings) | Profile (profile, trips,
// earnings). Today's earnings are also shown as a figure over the Home map.
type Tab = 'home' | 'free' | 'profile';

// Locale-aware formatting helpers for the driver app (money, durations, distances, status labels).
// Map padding that keeps the driver's car and the client ABOVE a bottom sheet (offer / free-order
// details): the sheet is up to ~60% of the screen plus the bottom nav, so frame the points in the
// band between the header overlays and the sheet's top edge.
function sheetFitPadding() {
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  return { top: 110, right: 50, bottom: Math.round(h * 0.6) + 90, left: 50 };
}

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
    // Convert the server-relative remaining time into a deadline on THIS device's clock, so the
    // countdown (and the Accept button) is right even when the device clock is skewed.
    const poll = async () => { try { const r = await api<{ offer: Offer | null }>('/driver/offers'); if (alive) setOffer(r.offer ? { ...r.offer, localDeadline: Date.now() + r.offer.expiresInMs } : null); } catch { /* transient */ } };
    poll(); const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [data?.onDuty, data?.trip]);

  // Sub-views of the merged tabs.
  const [ordersView, setOrdersView] = useState<'free' | 'prebook'>('free');
  const [profileView, setProfileView] = useState<'me' | 'trips' | 'earnings'>('me');
  const [prebookCount, setPrebookCount] = useState<number | null>(null);
  // Free orders count for the bottom-nav badge (rides automatic dispatch could not place).
  const [freeCount, setFreeCount] = useState(0);
  useEffect(() => {
    if (!data?.onDuty || data.trip) { setFreeCount(0); return; }
    let alive = true;
    const poll = async () => { try { const r = await api<{ orders: unknown[] }>('/driver/free-orders'); if (alive) setFreeCount(r.orders.length); } catch { /* transient */ } };
    poll(); const t = setInterval(poll, 10_000);
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


  if (!data) return <div className="p-8 text-muted">{t('common.loading')}</div>;
  const trip = data.trip;
  const offerSecs = offer ? Math.max(0, Math.ceil(((offer.localDeadline ?? new Date(offer.expiresAt).getTime()) - nowMs) / 1000)) : 0;

  // An accepted ride takes over the whole screen: navigation + the one action for the stage, no tabs.
  if (trip) {
    return (
      <DriverNavigation trip={trip} pos={pos} gps={gps} nowMs={nowMs} startCode={startCode} setStartCode={setStartCode}
        banner={banner} onDismissBanner={() => setBanner(null)} onStartGps={startGps} onTripAction={tripAction} />
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4 pb-24 sm:p-6 sm:pb-24">
      {banner && tab !== 'home' && <p className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" onClick={() => setBanner(null)}>{banner}</p>}

      {/* Persistent cross-section bars: an offer alert, or a return-to-active-trip bar. */}
      {tab !== 'home' && offer && (
        <button onClick={() => setTab('home')} className="relative z-20 mb-3 flex w-full items-center justify-between rounded-[12px] border-2 border-accent bg-page px-3 py-2 text-sm">
          <span className="font-semibold text-accent">{t('driver.banner.newOffer')}</span>
          <span className={offerSecs <= 5 ? 'text-danger' : 'text-muted'}>{t('driver.banner.offerCountdown', { secs: offerSecs })}</span>
        </button>
      )}

      {tab === 'home' && (
        <HomeSection
          banner={banner} onDismissBanner={() => setBanner(null)}
          data={data} dash={dash} gps={gps} pos={pos} offer={offer} offerSecs={offerSecs} offerBusy={offerBusy}
          onDuty={setDuty} onStartGps={startGps} onStopGps={stopGps}
          onAccept={acceptCurrentOffer} onDecline={declineCurrentOffer} goTrips={() => { setTab('profile'); setProfileView('trips'); }}
          goEarnings={() => { setTab('profile'); setProfileView('earnings'); }}
        />
      )}
      {tab === 'free' && (
        <SubTabs value={ordersView} onChange={setOrdersView} items={[
          { id: 'free', label: t('driver.nav.free'), count: freeCount },
          { id: 'prebook', label: t('driver.scheduled.tabPrebook'), count: prebookCount },
        ]} />
      )}
      {tab === 'free' && ordersView === 'free' && <FreeOrdersSection pos={pos} onDuty={!!data.onDuty} onTaken={async () => { setFreeCount(0); setTab('home'); await load(); await loadDash(); }} />}
      {tab === 'free' && ordersView === 'prebook' && <ScheduledRides onCount={setPrebookCount} />}
      {tab === 'profile' && (
        <SubTabs value={profileView} onChange={setProfileView} items={[
          { id: 'me', label: t('driver.nav.profile') },
          { id: 'trips', label: t('driver.nav.trips') },
          { id: 'earnings', label: t('driver.nav.earnings') },
        ]} />
      )}
      {tab === 'profile' && profileView === 'me' && <ProfileSection dash={dash} />}
      {tab === 'profile' && profileView === 'trips' && <TripsSection onOpen={setActiveDetailId} activeDetail={activeDetailId} onCloseDetail={() => setActiveDetailId(null)} onSettled={() => { loadDash(); }} />}
      {tab === 'profile' && profileView === 'earnings' && <EarningsSection />}

      <BottomNav tab={tab} setTab={setTab} hasOffer={!!offer} freeCount={freeCount} />
    </div>
  );
}

// ---- Home ----
function HomeSection(props: {
  banner: string | null; onDismissBanner: () => void;
  data: CurrentTrip; dash: Dashboard | null; gps: { active: boolean; error: string | null; last: string | null };
  pos: { lat: number; lng: number } | null;
  offer: Offer | null; offerSecs: number; offerBusy: boolean;
  onDuty: (v: boolean) => void; onStartGps: () => void; onStopGps: () => void;
  onAccept: (id: string) => void; onDecline: (id: string) => void; goTrips: () => void; goEarnings: () => void;
}) {
  const { data, dash, gps, offer, offerSecs, offerBusy } = props;
  const { t, fmt } = useT();
  const { money, km } = useDriverFmt();
  const trip = data.trip;
  const blocker = dash?.alerts.find((a) => a.level === 'blocker');

  const [counts, setCounts] = useState({ free: 0, busy: 0 });
  const onCounts = useCallback((free: number, busy: number) => setCounts({ free, busy }), []);
  const warning = dash?.alerts.find((a) => a.level === 'warning');
  const pill = 'pointer-events-auto rounded-full border border-edge bg-page/90 shadow-card backdrop-blur';

  // Full-screen map with single floating controls on top (2026-11-12). The header (z-30) and the
  // bottom nav (z-40) sit above; overlays are z-10 between them.
  return (
    <>
      <DriverHomeMap pos={props.pos} fullscreen onCounts={onCounts}
        pickup={offer && !trip ? offer.pickup : null}
        fitPadding={offer && !trip ? sheetFitPadding() : undefined} />

      {/* Top: status + messages */}
      <div className="pointer-events-none fixed inset-x-0 top-[64px] z-10 mx-auto flex max-w-lg flex-col items-start gap-2 px-3 pt-2">
        <div className="flex w-full items-start justify-between gap-2">
        <div className={`${pill} flex items-center gap-2 px-3 py-1.5 text-sm`}>
          <span className={`h-2.5 w-2.5 rounded-full ${data.onDuty ? 'bg-accent' : 'bg-muted'}`} />
          {/* Catalog strings may start with their own "●"; the dot is drawn here. */}
          <span className="font-medium">{(data.onDuty ? (trip ? t('driver.duty.onDutyOnTrip') : t('driver.duty.onDutyReady')) : t('driver.duty.offDuty')).replace(/^[●•]\s*/, '')}</span>
          {dash?.vehicle && <span className="text-xs text-muted">· {dash.vehicle.plate}</span>}
        </div>
        {/* Today's recorded earnings as a figure over the map; tap → Profile › Earnings. */}
        {dash && (
          <button className={`${pill} shrink-0 px-3 py-1.5 text-right`} onClick={props.goEarnings} aria-label={t('driver.home.earnedToday')}>
            <span className="block text-base font-bold leading-tight text-accent">{dash.today.recordedEarnings.length ? dash.today.recordedEarnings.map((e) => money(e.cents, e.currency)).join(' + ') : money(0, 'EUR')}</span>
            <span className="block text-[10px] leading-tight text-muted">{t('driver.home.earnedToday')}</span>
          </button>
        )}
        </div>
        {props.banner && <button className="pointer-events-auto rounded-[12px] border border-warn/40 bg-page/95 px-3 py-2 text-left text-sm text-warn" onClick={props.onDismissBanner}>{props.banner}</button>}
        {blocker && (
          <div className="pointer-events-auto rounded-[12px] border border-danger/40 bg-page/95 px-3 py-2 text-sm">
            <p className="font-medium text-danger">{blocker.code === 'NO_VEHICLE' ? t('driver.alerts.noVehicle') : blocker.message}</p>
            {blocker.action && <a href={blocker.action.href} className="mt-1 inline-block text-xs underline">{blocker.action.label}</a>}
          </div>
        )}
        {!offer && warning && <div className="pointer-events-auto rounded-[12px] border border-warn/40 bg-page/95 px-3 py-2 text-sm text-warn">{warning.message}{warning.action && <a href={warning.action.href} className="ml-2 underline">{warning.action.label}</a>}</div>}
        {data.onDuty && gps.error && <div className={`pointer-events-auto rounded-[12px] border bg-page/95 px-3 py-2 text-xs ${gps.error === 'acquiring' ? 'border-warn/40 text-warn' : 'border-danger/40 text-danger'}`}>{t(`driver.gps.${gps.error as 'denied' | 'acquiring' | 'unsupported'}`)}</div>}
        {data.onDuty && !gps.active && !gps.error && <div className="pointer-events-auto rounded-[12px] border border-edge bg-page/95 px-3 py-2 text-xs text-muted">{t('driver.map.noGps')}</div>}
        <InstallPrompt app="driver" className="pointer-events-auto w-full bg-page/95" />
        {/* One button per action, right-aligned under the messages (never overlapping them). */}
        {!offer && (
          <div className="flex w-full flex-col items-end gap-2">
            {data.onDuty && (
              <button className={`${pill} flex h-12 items-center gap-1.5 px-4 text-sm font-medium ${gps.active ? '!border-accent text-accent' : 'text-ink'}`}
                onClick={gps.active ? props.onStopGps : props.onStartGps} aria-pressed={gps.active}>
                📍 {gps.active ? t('driver.home.gpsOn') : t('driver.home.gpsOff')}
              </button>
            )}
            <div className={`${pill} flex min-h-[48px] items-center px-4`}><NotifyToggle pushUrl="/driver/push" /></div>
          </div>
        )}
      </div>

      {/* Bottom: online/offline button + cars count, or the offer sheet */}
      <div className="pointer-events-none fixed inset-x-0 z-10 mx-auto max-w-lg px-3" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        {!offer && (
          <div className="flex flex-col items-center gap-2">
            <div className={`${pill} px-3 py-1 text-xs text-muted`}>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" />{t('driver.map.free', { n: counts.free })}
              <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-muted align-middle" />{t('driver.map.busy', { n: counts.busy })}
            </div>
            {blocker && !data.onDuty ? (
              <span className="pointer-events-auto rounded-full bg-danger/90 px-5 py-3 text-sm font-semibold text-white">{t('driver.duty.cantGoOnline')}</span>
            ) : (
              <button className={`pointer-events-auto min-h-[56px] w-full rounded-full text-base font-semibold shadow-card ${data.onDuty ? 'border border-edge bg-page/95 text-ink' : 'bg-accent text-[#0d1608]'}`}
                onClick={() => props.onDuty(!data.onDuty)}>
                {data.onDuty ? t('driver.duty.goOffline') : t('driver.duty.goOnline')}
              </button>
            )}
          </div>
        )}
      {/* Offer takes priority */}
      {offer && !trip && (
        <div className="card pointer-events-auto max-h-[58dvh] overflow-y-auto border-2 border-accent p-4">
          <div className="flex items-center justify-between"><span className="font-semibold text-accent">{t('driver.offer.title')}</span><span className={`chip ${offerSecs <= 5 ? '!text-danger' : ''}`}>⏳ {t('driver.units.sec', { n: offerSecs })}</span></div>
          {/* 1) How far the client is: time and km to the pickup (the pickup is also on the map). */}
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-3xl font-bold text-ink">{offer.pickupEtaSec != null ? t('driver.offer.minShort', { min: Math.max(1, Math.round(offer.pickupEtaSec / 60)) }) : '—'}</span>
            {offer.pickupDistanceM != null && <span className="text-xl font-semibold text-muted">{km(offer.pickupDistanceM)}</span>}
            <span className="text-sm text-muted">{t('driver.offer.toClient')}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm"><span className="h-2 w-2 shrink-0 rounded-full bg-accent" /><span className="font-medium">{offer.pickup.label}</span></div>
          {/* 2) Main info: where to, client name, the sum. */}
          <div className="mt-3 space-y-1.5 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
            <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.whereTo')}</span><span className="font-medium">{offer.dropoff.label}</span></div>
            <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.client')}</span><span className="font-medium">{offer.passengerName}</span><span className="ml-auto text-xs text-muted">{t('driver.units.paxShort', { count: offer.passengerCount })}{offer.luggageCount ? ` · 🧳 ${offer.luggageCount}` : ''} · {offer.vClass}</span></div>
            <div className="flex items-baseline gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.sum')}</span><span className="text-lg font-bold">{offer.fareCents != null ? money(offer.fareCents, offer.currency) : '—'}</span><span className="text-xs text-muted">{offer.priceType === 'UPFRONT_DYNAMIC' ? t('driver.offer.upfront') : t('driver.offer.meterEstimate')}</span></div>
            {offer.scheduledAt && <div className="text-xs text-muted">🕒 {fmt.dateTime(offer.scheduledAt)}</div>}
            {offer.note && <div className="text-xs text-warn">{t('driver.offer.note', { note: offer.note })}</div>}
            {offer.flightNumber && <div className="font-mono text-xs text-ink">✈ {t('driver.scheduled.flight', { flight: formatFlight(offer.flightNumber) })}</div>}
          </div>
          {/* Fare breakdown on demand. */}
          <details className="mt-2 text-xs text-muted">
            <summary className="cursor-pointer">{t('driver.offer.more')}</summary>
            <div className="mt-1 space-y-0.5">
              {offer.fareBreakdown?.length ? offer.fareBreakdown.map((l, i) => (
                <div key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.label}</span><span className="shrink-0">{money(l.cents, offer.currency)}</span></div>
              )) : <div>{t('driver.offer.noEstimate')}</div>}
              {offer.priceType !== 'UPFRONT_DYNAMIC' && <div>{t('driver.offer.meterSettled')}</div>}
              <div>{t('driver.offer.phoneHidden')}</div>
            </div>
          </details>
          {/* Kept in view while the details scroll. */}
          <div className="sticky -bottom-4 -mx-4 -mb-4 mt-4 grid grid-cols-2 gap-2 bg-panel px-4 pb-4 pt-2">
            <button className="btn-ghost min-h-[44px] !text-danger border border-danger/40" disabled={offerBusy} onClick={() => props.onDecline(offer.offerId)}>{t('driver.offer.decline')}</button>
            <button className="btn-primary min-h-[44px]" disabled={offerBusy || offerSecs === 0} onClick={() => props.onAccept(offer.offerId)}>{t('driver.offer.accept')}</button>
          </div>
        </div>
      )}

      </div>
    </>
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
// Segmented switch for the merged bottom tabs.
function SubTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number | null }[] }) {
  return (
    <div className="mb-3 flex gap-1 rounded-[12px] border border-edge bg-elevated p-1" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)} className={`flex-1 rounded-[9px] px-3 py-2 text-sm font-medium ${value === it.id ? 'bg-accent text-[#0d1608]' : 'text-muted'}`}>
          {it.label}{it.count ? ` · ${it.count}` : ''}
        </button>
      ))}
    </div>
  );
}

interface FreeOrder {
  bookingId: string; pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  vClass: string; passengerName: string; passengerCount: number; luggageCount?: number; note: string | null; flightNumber: string | null; scheduledAt: string | null;
  fareCents: number | null; priceType: string | null; currency: string; waitingSince: string; expiresAt: string; expiresInMs: number; distanceM: number | null;
  localDeadline?: number;
}

// Free orders (2026-11-12): rides automatic dispatch offered to every eligible nearby driver without
// anyone accepting. Listed for 2 min to any on-duty driver whose car fits (COMFORT rides: COMFORT
// and XL cars; XL rides: XL only). Passenger name shown; phone only after taking.
function FreeOrdersSection({ pos, onDuty, onTaken }: { pos: { lat: number; lng: number } | null; onDuty: boolean; onTaken: () => void }) {
  const { t, fmt, tError } = useT();
  const { money, km } = useDriverFmt();
  const [orders, setOrders] = useState<FreeOrder[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [viewId, setViewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await api<{ orders: FreeOrder[] }>('/driver/free-orders'); const at = Date.now(); setOrders(r.orders.map((o) => ({ ...o, localDeadline: at + o.expiresInMs }))); setNowMs(at); } catch { /* keep last */ }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000);
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [load]);

  async function take(id: string) {
    setBusyId(id); setMsg(null);
    try { await api(`/driver/free-orders/${id}/claim`, { method: 'POST' }); onTaken(); }
    catch (e) { setMsg(e instanceof ApiRequestError ? tError(e) : t('common.somethingWrong')); setViewId(null); void load(); }
    finally { setBusyId(null); }
  }

  // Review first, then decide (2026-11-12): a card opens the full details over the map.
  if (viewId) {
    return <FreeOrderDetailView id={viewId} pos={pos} onDuty={onDuty} busy={busyId === viewId}
      onBack={(gone) => { setViewId(null); if (gone) { setMsg(t('errors.ORDER_GONE')); void load(); } }} onTake={() => take(viewId)} />;
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t('driver.free.title')}</h1>
      <p className="text-xs text-muted">{t('driver.free.hint')}</p>
      {!onDuty && <p className="rounded-[12px] border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{t('driver.free.goOnline')}</p>}
      {msg && <p className="rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{msg}</p>}
      {orders === null ? <p className="py-8 text-center text-sm text-muted">{t('common.loading')}</p>
        : orders.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t('driver.free.empty')}</p>
        : orders.map((o) => {
          const leftSec = Math.max(0, Math.ceil(((o.localDeadline ?? new Date(o.expiresAt).getTime()) - nowMs) / 1000));
          if (leftSec === 0) return null;
          return (
            <div key={o.bookingId} className="card p-4">
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-accent" /><span className="text-muted">{t('driver.offer.pickup')}</span><span className="ml-auto text-right font-medium">{o.pickup.label}</span></div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-ink" /><span className="text-muted">{t('driver.offer.destination')}</span><span className="ml-auto text-right font-medium">{o.dropoff.label}</span></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                {o.distanceM != null && <span className="rounded-full bg-elevated px-2 py-1">{t('driver.offer.away', { dist: km(o.distanceM) })}</span>}
                <span className="rounded-full bg-elevated px-2 py-1">{t('driver.units.paxShort', { count: o.passengerCount })}{o.luggageCount ? ` · 🧳 ${o.luggageCount}` : ''} · {o.vClass}</span>
                {o.scheduledAt && <span className="rounded-full bg-elevated px-2 py-1">🕒 {fmt.dateTime(o.scheduledAt)}</span>}
                {o.flightNumber && <span className="rounded-full bg-elevated px-2 py-1">✈ {o.flightNumber}</span>}
                <span className={`rounded-full bg-elevated px-2 py-1 ${leftSec <= 30 ? 'text-danger' : ''}`}>{t('driver.free.left', { sec: leftSec })}</span>
              </div>
              <p className="mt-2 text-sm"><span className="font-medium">{o.passengerName}</span> <span className="text-xs text-muted">· {t('driver.offer.phoneHidden')}</span></p>
              {o.note && <p className="mt-1 text-xs text-muted">{t('driver.offer.note', { note: o.note })}</p>}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-sm"><span className="font-semibold">{money(o.fareCents, o.currency)}</span>{o.priceType && <span className="ml-1 text-xs text-muted">{o.priceType === 'UPFRONT_DYNAMIC' ? t('driver.offer.upfront') : o.priceType === 'REGULATED_METER_ESTIMATE' ? t('driver.offer.meterEstimate') : ''}</span>}</div>
                <button className="btn-primary min-h-[44px]" onClick={() => setViewId(o.bookingId)}>{t('driver.free.view')}</button>
              </div>
            </div>
          );
        })}
    </div>
  );
}

interface FreeOrderDetail extends FreeOrder {
  fareBreakdown: { label: string; cents: number }[] | null; pickupEtaSec: number | null; pickupDistanceM: number | null; roadRouted: boolean;
}

// Free order review screen: map with the driver's car and the client, then time/km to the client,
// destination, client name and fare, with the breakdown on demand. Back or Take.
function FreeOrderDetailView({ id, pos, onDuty, busy, onBack, onTake }: {
  id: string; pos: { lat: number; lng: number } | null; onDuty: boolean; busy: boolean; onBack: (gone: boolean) => void; onTake: () => void;
}) {
  const { t, fmt } = useT();
  const { money, km } = useDriverFmt();
  const [o, setO] = useState<(FreeOrderDetail & { localDeadline: number }) | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    api<{ order: FreeOrderDetail }>(`/driver/free-orders/${id}`)
      .then((r) => { if (alive) setO({ ...r.order, localDeadline: Date.now() + r.order.expiresInMs }); })
      .catch(() => { if (alive) onBack(true); });
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => { alive = false; clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const leftSec = o ? Math.max(0, Math.ceil((o.localDeadline - nowMs) / 1000)) : null;
  useEffect(() => { if (leftSec === 0) onBack(true); }, [leftSec, onBack]);

  return (
    <>
      <DriverHomeMap pos={pos} fullscreen pickup={o ? o.pickup : null} fitPadding={sheetFitPadding()} />
      <div className="pointer-events-none fixed inset-x-0 z-10 mx-auto max-w-lg px-3" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        <div className="card pointer-events-auto max-h-[60dvh] overflow-y-auto border-2 border-accent p-4">
          {!o ? <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p> : (
            <>
              <div className="flex items-center justify-between"><span className="font-semibold text-accent">{t('driver.free.title')}</span><span className={`chip ${leftSec! <= 30 ? '!text-danger' : ''}`}>⏳ {t('driver.free.left', { sec: leftSec! })}</span></div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="text-3xl font-bold text-ink">{o.pickupEtaSec != null ? t('driver.offer.minShort', { min: Math.max(1, Math.round(o.pickupEtaSec / 60)) }) : '—'}</span>
                {o.pickupDistanceM != null && <span className="text-xl font-semibold text-muted">{km(o.pickupDistanceM)}</span>}
                <span className="text-sm text-muted">{t('driver.offer.toClient')}</span>
              </div>
              {!o.roadRouted && o.pickupEtaSec != null && <p className="text-xs text-muted">{t('driver.free.approx')}</p>}
              {o.pickupEtaSec == null && <p className="text-xs text-muted">{t('driver.map.noGps')}</p>}
              <div className="mt-1 flex items-center gap-2 text-sm"><span className="h-2 w-2 shrink-0 rounded-full bg-accent" /><span className="font-medium">{o.pickup.label}</span></div>
              <div className="mt-3 space-y-1.5 rounded-[12px] border border-edge bg-elevated p-3 text-sm">
                <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.whereTo')}</span><span className="font-medium">{o.dropoff.label}</span></div>
                <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.client')}</span><span className="font-medium">{o.passengerName}</span><span className="ml-auto text-xs text-muted">{t('driver.units.paxShort', { count: o.passengerCount })}{o.luggageCount ? ` · 🧳 ${o.luggageCount}` : ''} · {o.vClass}</span></div>
                <div className="flex items-baseline gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.sum')}</span><span className="text-lg font-bold">{o.fareCents != null ? money(o.fareCents, o.currency) : '—'}</span><span className="text-xs text-muted">{o.priceType === 'UPFRONT_DYNAMIC' ? t('driver.offer.upfront') : t('driver.offer.meterEstimate')}</span></div>
                {o.scheduledAt && <div className="text-xs text-muted">🕒 {fmt.dateTime(o.scheduledAt)}</div>}
                {o.note && <div className="text-xs text-warn">{t('driver.offer.note', { note: o.note })}</div>}
                {o.flightNumber && <div className="font-mono text-xs text-ink">✈ {t('driver.scheduled.flight', { flight: formatFlight(o.flightNumber) })}</div>}
              </div>
              <details className="mt-2 text-xs text-muted">
                <summary className="cursor-pointer">{t('driver.offer.more')}</summary>
                <div className="mt-1 space-y-0.5">
                  {o.fareBreakdown?.length ? o.fareBreakdown.map((l, i) => (
                    <div key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.label}</span><span className="shrink-0">{money(l.cents, o.currency)}</span></div>
                  )) : <div>{t('driver.offer.noEstimate')}</div>}
                  {o.priceType !== 'UPFRONT_DYNAMIC' && <div>{t('driver.offer.meterSettled')}</div>}
                  <div>{t('driver.offer.phoneHidden')}</div>
                </div>
              </details>
              {!onDuty && <p className="mt-2 rounded-[12px] border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{t('driver.free.goOnline')}</p>}
            </>
          )}
          <div className="sticky -bottom-4 -mx-4 -mb-4 mt-4 grid grid-cols-2 gap-2 bg-panel px-4 pb-4 pt-2">
            <button className="btn-ghost min-h-[44px]" onClick={() => onBack(false)}>{t('driver.free.back')}</button>
            <button className="btn-primary min-h-[44px]" disabled={!o || !onDuty || busy} onClick={onTake}>{busy ? t('driver.free.taking') : t('driver.free.take')}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function TripsSection({ onOpen, activeDetail, onCloseDetail, onSettled }: { onOpen: (id: string) => void; activeDetail: string | null; onCloseDetail: () => void; onSettled: () => void }) {
  const { t, tError } = useT();
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
    } catch (e) { setErr(e ? tError(e) : t('driver.trips.loadFailed')); } finally { setLoading(false); }
  }, [range, cursor, t, tError]);

  // Reset only when the range changes; a reset load ignores the cursor, so loadPage's identity is irrelevant here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setItems([]); setCursor(null); loadPage(true); }, [range]);

  return (
    <div className="space-y-3">
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
  const { money, dur } = useDriverFmt();
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
          {/* Work figures for the selected period (moved here from the Home tab). */}
          <div className="grid grid-cols-2 gap-2">
            <Figure label={t('driver.earnings.completedTrips')} value={String(data.summary.completedTrips)} sub={t(`driver.range.${range}`)} />
            <Figure label={t('driver.earnings.onlineTime')} value={dur(data.summary.onlineSeconds)} sub={t(`driver.range.${range}`)} />
          </div>
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
function BottomNav({ tab, setTab, hasOffer, freeCount }: { tab: Tab; setTab: (t: Tab) => void; hasOffer: boolean; freeCount: number }) {
  const { t } = useT();
  const items: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: t('driver.nav.home'), icon: '🏠' }, { id: 'free', label: t('driver.nav.orders'), icon: '📋' },
    { id: 'profile', label: t('driver.nav.profile'), icon: '👤' },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-page/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto flex max-w-lg">
        {items.map((it) => (
          <button key={it.id} onClick={() => setTab(it.id)} className={`relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs ${tab === it.id ? 'text-accent' : 'text-muted'}`}>
            <span className="text-base leading-none" aria-hidden>{it.icon}</span>
            <span>{it.label}</span>
            {it.id === 'home' && hasOffer && tab !== 'home' && <span className="absolute right-[28%] top-1.5 h-2 w-2 rounded-full bg-accent" />}
            {it.id === 'free' && freeCount > 0 && <span className="absolute right-[22%] top-1 min-w-[18px] rounded-full bg-accent px-1 text-[10px] font-semibold leading-[18px] text-[#0d1608]">{freeCount}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}
