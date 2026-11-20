'use client';

import { DriverAnalytics } from '@/components/driver/DriverAnalytics';
import { BackArrow } from '@/components/BackArrow';
import { fareRangeText } from '@/lib/price-type';
import { useCallback, useEffect, useRef, useState } from 'react';
import SwipeButton from '@/components/SwipeButton';
import EdgeShine from '@/components/EdgeShine';
import { StaffShell } from '@/components/staff/StaffShell';
import { NotifyToggle } from '@/components/NotifyToggle';
import { ThemePicker } from '@/components/ThemePicker';
import { Postcode } from '@/components/driver/Postcode';
import { InstallPrompt } from '@/components/InstallPrompt';
import { api, ApiRequestError, uuid } from '@/lib/api-client';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { ScheduledRides } from '@/components/driver/ScheduledRides';
import { DriverNavigation, type NavTrip } from '@/components/driver/DriverNavigation';
import { filterFix, initialFilterState, accuracyLevel, type FilterState } from '@/lib/gpsFilter';
import { DriverHomeMap } from '@/components/driver/DriverHomeMap';
import { unlockOfferSound, playOfferChime, vibrateOffer, keepScreenOn } from '@/lib/driver-alerts';
import { formatFlight } from '@/lib/flight';
import { useT, useLocale, MsgKey } from '@/i18n/I18nProvider';
import { rememberPushLocale } from '@/lib/push-client';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

// Manual language choice for drivers (2026-11-17): Russian, Greek, English.
const DRIVER_LOCALES = ['ru', 'el', 'en'] as const;
import { StaffPasswordForm } from '@/components/StaffPasswordForm';
import { RatePassengerSheet } from '@/components/driver/RatePassengerSheet';

export const dynamic = 'force-dynamic';

interface Trip {
  bookingId: string; reference: string; status: string; revision: number;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string; postcode?: string | null }; stop?: NavTrip['stop'];
  passengerName: string; passengerPhone: string; note: string | null; flightNumber?: string | null; passengerCount: number; luggageCount?: number; vClass: string;
  scheduledAt: string | null; waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null; allowedNext: string[];
}
import { GpsMeterCard, type GpsMeterView } from '@/components/driver/GpsMeterCard';
import { DriverShareProposalSheet, CoRiderLegPill, AcceptsSharedToggle, type DriverShareProposal, type CoRiderLeg, type ShareInfo } from '@/components/share/ShareDriver';
interface CurrentTrip {
  onDuty: boolean; available: boolean; trip: Trip | null;
  // Ride-share «Попутчик» (Task 022)
  shareProposal?: DriverShareProposal | null; coRider?: CoRiderLeg | null; share?: ShareInfo | null;
  gpsMeter?: GpsMeterView | null; // GPS taximeter while on board (comparison, not charged)
}
interface Offer {
  offerId: string; expiresAt: string; expiresInMs: number; localDeadline?: number; pickupEtaSec: number | null; pickupDistanceM: number | null;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string; postcode?: string | null }; stop?: { lat: number; lng: number; label: string } | null;
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
  today: { recordedEarnings: { currency: string; cents: number }[]; pendingFinalTrips: number; completedTrips: number; onlineSeconds: number; cash?: { currency: string; cents: number }[]; card?: { currency: string; cents: number }[]; canceledTrips?: number };
  latestTrips: TripCard[];
  alerts: { level: string; code: string; message: string; action?: { label: string; href: string } }[];
  support: { operatorName: string | null; phone: string | null; email: string | null };
}

// Bottom tabs (2026-11-13): Home | Free orders | Pre-bookings | Profile (profile, trips, earnings).
// Free orders and pre-bookings carry a small red count badge. Today's earnings show on the Home map.
type Tab = 'home' | 'free' | 'prebook' | 'profile' | 'earnings';

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
  // The service worker localises background offer banners; it reads the app language from here.
  const uiLocale = useLocale();
  useEffect(() => { void rememberPushLocale(uiLocale); }, [uiLocale]);
  // Ref so the long-lived polling callbacks always use the current locale without re-subscribing.
  const tErrRef = useRef(tError);
  tErrRef.current = tError;
  const [tab, setTab] = useState<Tab>('home');
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { const open = () => setDrawer(true); window.addEventListener('il-y:driver-menu', open); return () => window.removeEventListener('il-y:driver-menu', open); }, []);
  // ‹ back arrow in the top bar on every sub-screen (pre-bookings, free orders) → back to the map (2026-11-19).
  useEffect(() => { window.dispatchEvent(new CustomEvent('il-y:driver-back-visible', { detail: tab !== 'home' })); }, [tab]);
  useEffect(() => { const back = () => setTab('home'); window.addEventListener('il-y:driver-back', back); return () => window.removeEventListener('il-y:driver-back', back); }, []);
  useEffect(() => () => { window.dispatchEvent(new CustomEvent('il-y:driver-back-visible', { detail: false })); }, []);
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);
  const [data, setData] = useState<CurrentTrip | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  // Notices like «Срок предложения истёк» go away by themselves after 6 s (2026-11-19).
  useEffect(() => { if (!banner) return; const id = setTimeout(() => setBanner(null), 6000); return () => clearTimeout(id); }, [banner]);
  const [gps, setGps] = useState<{ active: boolean; error: string | null; last: string | null; accuracyM?: number | null }>({ active: false, error: null, last: null });
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
  // GPS quality (2026-11-14): filter bad fixes, never stay stuck in the coarse Wi-Fi/cell mode.
  const filterRef = useRef<FilterState>(initialFilterState());
  const highModeRef = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const statusRef = useRef<string | null>(null);
  const load = useCallback(async () => {
    try { const d = await api<CurrentTrip>('/driver/current-trip'); statusRef.current = d.trip?.status ?? null; setData(d); }
    catch (e) { if (e instanceof ApiRequestError) setBanner(tErrRef.current(e)); }
  }, []);
  const loadDash = useCallback(async () => {
    try { setDash(await api<Dashboard>('/driver/dashboard')); } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    load(); loadDash();
    // Trip every 2 s while heading to / waiting at the pickup (the passenger's live marker),
    // otherwise every 5 s; the dashboard stays at 5 s.
    let n = 0;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      n += 1;
      const st = statusRef.current;
      const fast = st === 'EN_ROUTE' || st === 'ARRIVED' || st === 'ASSIGNED';
      if (fast || n % 5 === 0) load();
      if (n % 5 === 0) loadDash();
    }, 1000);
    return () => { clearInterval(t); stopGps(); };
     
  }, [load, loadDash]);

  function stopGps() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    if (sendTimer.current) clearInterval(sendTimer.current);
    if (retryTimer.current) clearInterval(retryTimer.current);
    retryTimer.current = null;
    watchId.current = null; sendTimer.current = null; lastPos.current = null; posRef.current = null;
    setPos(null); setGps((g) => ({ ...g, active: false }));
  }
  function beginWatch(highAccuracy: boolean) {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const acc = p.coords.accuracy ?? 9999;
        if (highAccuracy) highModeRef.current = true;
        setGps((g) => ({ ...g, error: null, accuracyM: Math.round(acc) }));
        const r = filterFix(filterRef.current, { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: acc, t: p.timestamp || Date.now() });
        filterRef.current = r.state;
        if (r.verdict !== 'accept') return; // neighbouring-street jump or a poor fix while a good one is recent
        lastPos.current = p; const c = { lat: p.coords.latitude, lng: p.coords.longitude }; posRef.current = c; setPos(c);
      },
      (err) => {
        // A silent automatic start (app reopened) that the phone refuses shows no alarm: the driver
        // just sees «Включить GPS»; the how-to-allow text comes only after the driver taps it (2026-11-18).
        if (err.code === err.PERMISSION_DENIED) { const quiet = autoStartRef.current; setGps((g) => ({ ...g, active: false, error: quiet ? null : 'denied' })); stopGps(); return; }
        if (highAccuracy) { highModeRef.current = false; beginWatch(false); return; }
        // POSITION_UNAVAILABLE even in coarse mode = the phone's own Location switch is off (common on
        // Android/Samsung): say so instead of an endless «Поиск GPS…» (2026-11-16).
        if (err.code === err.POSITION_UNAVAILABLE && !lastPos.current) { setGps((g) => ({ ...g, error: 'unavailable' })); return; }
        setGps((g) => ({ ...g, error: lastPos.current ? null : 'acquiring' }));
      },
      highAccuracy ? { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 } : { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 },
    );
  }
  const autoStartRef = useRef(false);
  function startGpsAuto() { autoStartRef.current = true; startGps(true); }
  function startGps(auto?: unknown) {
    if (auto !== true) autoStartRef.current = false; // the driver tapped «Включить GPS»
    if (!('geolocation' in navigator)) { setGps({ active: false, error: 'unsupported', last: null }); return; }
    // Chrome/Samsung Internet never prompt again once the site is blocked (incl. the automatic block
    // after the prompt was dismissed a few times) — show the fix-it steps right away (2026-11-16).
    try {
      void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((st) => {
        if (st.state === 'denied' && !autoStartRef.current) setGps((g) => ({ ...g, error: 'denied' }));
      }).catch(() => { /* not supported: the watch error tells us */ });
    } catch { /* ignore */ }
    session.current = uuid(); seq.current = 0; setGps({ active: true, error: null, last: null, accuracyM: null });
    filterRef.current = initialFilterState(); highModeRef.current = true;
    beginWatch(true); sendTimer.current = setInterval(sendSample, 5000);
    // In the coarse fallback, try precise GPS again every 30 s instead of staying coarse forever.
    if (retryTimer.current) clearInterval(retryTimer.current);
    retryTimer.current = setInterval(() => { if (!highModeRef.current && watchId.current !== null) beginWatch(true); }, 30_000);
  }
  const keepAliveBusy = useRef(false);
  async function sendSample() {
    let p = lastPos.current; if (!p) return;
    // Keep-alive (2026-11-19): phones deliver no new fixes while the car stands or creeps (and the
    // server ignores a repeated old fix), so after ~2 min the car vanished from the passenger's map.
    // No fresh fix for 8 s → ask the GPS for a real current one (never a made-up position).
    if (Date.now() - p.timestamp > 8000) {
      if (keepAliveBusy.current) return;
      keepAliveBusy.current = true;
      const fresh = await new Promise<GeolocationPosition | null>((res) => navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, maximumAge: 0, timeout: 6000 }));
      keepAliveBusy.current = false;
      if (fresh && fresh.timestamp > p.timestamp) {
        const r = filterFix(filterRef.current, { lat: fresh.coords.latitude, lng: fresh.coords.longitude, accuracyM: fresh.coords.accuracy ?? 9999, t: fresh.timestamp || Date.now() });
        filterRef.current = r.state;
        if (r.verdict === 'accept') { lastPos.current = fresh; const c = { lat: fresh.coords.latitude, lng: fresh.coords.longitude }; posRef.current = c; setPos(c); }
        p = lastPos.current ?? p;
      }
      if (Date.now() - p.timestamp > 8000) return; // still nothing new: don't resend the same old fix
    }
    seq.current += 1;
    try {
      await api('/driver/location', { method: 'POST', body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? 0, heading: p.coords.heading ?? undefined, speed: p.coords.speed ?? undefined, sampledAt: new Date(p.timestamp).toISOString(), gpsSession: session.current, sequence: seq.current } });
      setGps((g) => ({ ...g, last: new Date().toISOString(), error: null }));
    } catch (e) { if (e instanceof ApiRequestError && (e.body.code === 'OFF_DUTY' || e.body.code === 'INACTIVE')) stopGps(); }
  }
  async function setDuty(onDuty: boolean) {
    if (onDuty) unlockOfferSound(); // user gesture: lets the offer chime play later
    // «Выйти на линию» also turns on location sharing (2026-11-18) — inside the same tap, so the
    // phone's permission prompt is allowed to appear; no separate «Включить GPS» press needed.
    if (onDuty && !gps.active) startGps();
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
  const [profileView, setProfileView] = useState<'me' | 'trips'>('me');
  const [earnEntry, setEarnEntry] = useState<'summary' | 'analytics'>('summary'); // which part of «Заработок» to open (2026-11-20)
  const [prebookCount, setPrebookCount] = useState(0);
  const [prebookPair, setPrebookPair] = useState(false); // any open pre-booking is a ride-share pair
  const [prebookMine, setPrebookMine] = useState(0); // pre-bookings this driver has taken
  const onPrebookCount = useCallback((n: number, pair: boolean, mine: number) => { setPrebookCount(n); setPrebookPair(pair); setPrebookMine(mine); }, []);
  // Free orders count for the bottom-nav badge (rides automatic dispatch could not place).
  const [freeCount, setFreeCount] = useState(0);
  useEffect(() => {
    if (!data?.onDuty || data.trip) { setFreeCount(0); return; }
    let alive = true;
    const poll = async () => { try { const r = await api<{ orders: unknown[] }>('/driver/free-orders'); if (alive) setFreeCount(r.orders.length); } catch { /* transient */ } };
    poll(); const t = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [data?.onDuty, data?.trip]);

  // Pre-booking count for the badge: open scheduled rides this driver could take (polled, 30 s).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await api<{ available: { conflict?: boolean; share?: unknown }[]; mine?: unknown[] }>('/driver/scheduled');
        if (!alive) return;
        const open = r.available.filter((i) => !i.conflict);
        setPrebookCount(open.length); setPrebookPair(open.some((i) => !!i.share)); setPrebookMine(r.mine?.length ?? 0);
      } catch { /* transient */ }
    };
    poll(); const iv = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, [tab]); // re-checked at once when the driver comes back to the map

  // Reopened app (2026-11-17): the current ride is back on screen from the server; switch the GPS
  // back on by itself as well when the driver is on a ride or on duty, so the passenger keeps seeing
  // the car without the driver having to press «Включить GPS» again. Once per app launch.
  const gpsAutoTried = useRef(false);
  useEffect(() => {
    if (gpsAutoTried.current || !data || gps.active || document.visibilityState !== 'visible') return;
    if (!data.trip && !data.onDuty) return;
    gpsAutoTried.current = true;
    startGpsAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, gps.active]);

  // Keep the screen awake while on duty (a sleeping screen suspends polling + GPS).
  useEffect(() => {
    if (!data?.onDuty) return;
    return keepScreenOn();
  }, [data?.onDuty]);

  // Ring + vibrate for a new offer, repeating every 2 s until it is answered or expires.
  const offerId = offer?.offerId ?? null;
  // A new offer jumps over whatever the driver is looking at (2026-11-15): back to the main
  // screen (other tabs, profile pages, an open order detail are left) so the offer card is on top.
  useEffect(() => {
    if (!offerId) return;
    setTab('home'); setProfileView('me'); setActiveDetailId(null);
  }, [offerId]);
  useEffect(() => {
    if (!offerId) return;
    const ring = () => { playOfferChime(); vibrateOffer(); };
    ring();
    const t = setInterval(ring, 2000);
    return () => clearInterval(t);
  }, [offerId]);

  // Clock for countdowns/meters: offer, pickup waiting, and paid waiting at the stop (2026-11-15).
  const ticking = !!offer || data?.trip?.status === 'ARRIVED' || !!(data?.trip?.stop?.waitStartedAt && !data.trip.stop.departedAt);
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
  // After «Завершить окончательно»: ask the driver to rate the passenger (2026-11-15).
  const [rateFor, setRateFor] = useState<{ bookingId: string; name: string } | null>(null);
  async function tripAction(path: string, body: Record<string, unknown>, opts?: { stopGps?: boolean }) {
    if (!data?.trip) return;
    const done = data.trip;
    try {
      await api(`/driver/bookings/${done.bookingId}/${path}`, { method: 'POST', body: { expectedRevision: done.revision, ...body } });
      if (path === 'complete') setRateFor({ bookingId: done.bookingId, name: done.passengerName }); // then rate the passenger
      if (opts?.stopGps) stopGps(); setStartCode(''); await load(); await loadDash();
    }
    catch (e) { if (e instanceof ApiRequestError) setBanner(tErrRef.current(e)); await load(); }
  }


  if (!data) return <div className="p-8 text-muted">{t('common.loading')}</div>;
  const trip = data.trip;
  if (!trip && rateFor) return <RatePassengerSheet bookingId={rateFor.bookingId} passengerName={rateFor.name} onDone={() => setRateFor(null)} />;
  const offerSecs = offer ? Math.max(0, Math.ceil(((offer.localDeadline ?? new Date(offer.expiresAt).getTime()) - nowMs) / 1000)) : 0;

  // An accepted ride takes over the whole screen: navigation + the one action for the stage, no tabs.
  if (trip) {
    return (
      <>
        <DriverNavigation trip={trip} pos={pos} gps={gps} nowMs={nowMs} startCode={startCode} setStartCode={setStartCode}
          banner={banner} onDismissBanner={() => setBanner(null)} onStartGps={startGps} onTripAction={tripAction} />
        {/* Ride-share (Task 022): the second passenger's leg, and a co-rider proposal to decide on the spot. */}
        {trip.status === 'IN_PROGRESS' && data.gpsMeter && <GpsMeterCard m={data.gpsMeter} />}
        {data.coRider && <CoRiderLegPill leg={data.coRider} share={data.share ?? null} onChanged={() => { void load(); void loadDash(); }} onError={setBanner} />}
        {data.shareProposal && <DriverShareProposalSheet key={data.shareProposal.groupId} p={data.shareProposal} onAnswered={() => { void load(); }} />}
      </>
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
          onAccept={acceptCurrentOffer} onDecline={declineCurrentOffer} goTrips={() => { setProfileView('trips'); setDrawer(true); }}
          goEarnings={(to) => { setEarnEntry(to ?? 'summary'); setTab('earnings'); }}
          refreshDash={loadDash}
        />
      )}
      {tab === 'free' && <FreeOrdersSection pos={pos} onDuty={!!data.onDuty} onTaken={async () => { setFreeCount(0); setTab('home'); await load(); await loadDash(); }} />}
      {/* Count AND «is a pair» come together, so the map button never shows «П» for a moment before «ПП» (2026-11-19). */}
      {tab === 'prebook' && <ScheduledRides onCount={onPrebookCount} />}
      {/* «Заработок» (2026-11-20, operator): no longer a menu tab — the earnings pill on the map opens a small
          «today» card, its «Подробнее» opens this full screen (back arrow «‹» in the top bar, like other sub-screens). */}
      {tab === 'earnings' && <div className="mx-auto max-w-lg px-4 pb-28 pt-3" data-testid="earnings-screen"><EarningsSection key={earnEntry} initialRange="today" openAnalytics={earnEntry === 'analytics'} /></div>}
      {/* Side menu (2026-11-18): ☰ top-right → slides in from the right like a new page, not the full width. */}
      <div className={`fixed inset-0 z-50 bg-black/55 transition-opacity duration-300 ${drawer ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setDrawer(false)} aria-hidden={!drawer} />
      <aside role="dialog" aria-modal="true" aria-label={t('driver.nav.profile')} data-testid="driver-drawer"
        className={`fixed inset-y-0 end-0 z-50 flex w-[86%] max-w-[400px] flex-col bg-page shadow-2xl transition-transform duration-300 ease-out ${drawer ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex h-14 shrink-0 items-center justify-end px-3">
          <button type="button" onClick={() => setDrawer(false)} aria-label={t('common.close')} className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-ink hover:bg-white/5">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {drawer && (
            <>
              {/* Pre-bookings moved from the bottom bar into the menu (2026-11-19). */}
              <button type="button" onClick={() => { setDrawer(false); setTab('prebook'); }} data-testid="drawer-prebook"
                className="mb-3 flex w-full items-center justify-between rounded-[12px] border border-edge bg-elevated px-4 py-3 text-start text-[16px] font-semibold">
                <span>{t('driver.scheduled.tabPrebook')}</span>
                {/* 2026-11-19: taken by me and new ones I could take — both red (operator). */}
                <span className="flex items-center gap-1.5">
                  {prebookMine > 0 && <span className="min-w-[22px] rounded-full bg-danger px-1.5 text-center text-[12px] font-bold leading-[22px] text-white" title={t('driver.scheduled.mine')}>{prebookMine}</span>}
                  {prebookCount > 0 && <span className="min-w-[22px] rounded-full bg-danger px-1.5 text-center text-[12px] font-bold leading-[22px] text-white">{prebookCount}</span>}
                </span>
              </button>
              <SubTabs value={profileView} onChange={setProfileView} items={[
                { id: 'me', label: t('driver.nav.profile') },
                { id: 'trips', label: t('driver.nav.trips') },
              ]} />
              {profileView === 'me' && <ProfileSection dash={dash} />}
              {profileView === 'trips' && <TripsSection onOpen={setActiveDetailId} activeDetail={activeDetailId} onCloseDetail={() => setActiveDetailId(null)} onSettled={() => { loadDash(); }} />}
            </>
          )}
        </div>
      </aside>

      {/* New pre-booking (2026-11-19): a round button on the right of the map, a little below the middle —
          «П» for a pre-booking, «ПП» when it is a ride-share pair; pulses between its colour and a soft red. */}
      {tab === 'home' && !offer && !data.trip && prebookCount > 0 && (
        <button type="button" onClick={() => setTab('prebook')} data-testid="prebook-fab"
          aria-label={prebookPair ? t('driver.prebookFab.pairAria') : t('driver.prebookFab.singleAria')}
          className={`ily-fab-pulse fixed end-3 top-[58%] z-30 flex h-14 w-14 items-center justify-center rounded-full text-[18px] font-extrabold shadow-card ${prebookPair ? 'text-white' : 'text-[#0d1608]'}`}
          // «ПП» (ride-share pair) is the better-paid one: bright red (2026-11-19, operator).
          style={{ ['--fab' as string]: prebookPair ? '#FF2D2D' : '#C8FF46' }}>
          {prebookPair ? t('driver.prebookFab.pair') : t('driver.prebookFab.single')}
        </button>
      )}
      <BottomNav tab={tab} setTab={setTab} hasOffer={!!offer} freeCount={freeCount} />
    </div>
  );
}

// ---- Home ----
function HomeSection(props: {
  banner: string | null; onDismissBanner: () => void;
  data: CurrentTrip; dash: Dashboard | null; gps: { active: boolean; error: string | null; last: string | null; accuracyM?: number | null };
  pos: { lat: number; lng: number } | null;
  offer: Offer | null; offerSecs: number; offerBusy: boolean;
  onDuty: (v: boolean) => void; onStartGps: () => void; onStopGps: () => void;
  onAccept: (id: string) => void; onDecline: (id: string) => void; goTrips: () => void; goEarnings: (to?: 'summary' | 'analytics') => void; refreshDash?: () => void;
}) {
  const { data, dash, gps, offer, offerSecs, offerBusy } = props;
  const { t, fmt } = useT();
  const { money, km, dur } = useDriverFmt();
  const [earnPop, setEarnPop] = useState(false); // today's earnings card under the pill (2026-11-20)
  const [earnView, setEarnView] = useState<'main' | 'time'>('main'); // «Время на линии» opens inside the card
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
        dropoff={offer && !trip ? offer.dropoff : null} via={offer && !trip ? offer.stop ?? null : null}
        fitPadding={offer && !trip ? sheetFitPadding() : undefined} />

      {/* Top: status + messages */}
      <div style={{ top: 'calc(64px + env(safe-area-inset-top))' }} className="pointer-events-none fixed inset-x-0 z-10 mx-auto flex max-w-lg flex-col items-start gap-2 px-3 pt-2">
        {/* No status pill (2026-11-13): the Go online / offline button already shows the state. */}
        <div className="flex w-full items-start justify-end gap-2">
        {/* Today's recorded earnings as a figure over the map; tap → today's card (2026-11-20). */}
        {dash && (
          <button className={`${pill} shrink-0 px-3 py-1.5 text-end`} onClick={() => { if (!earnPop) { props.refreshDash?.(); setEarnView('main'); } setEarnPop((v) => !v); }} aria-label={t('driver.home.earnedToday')} aria-expanded={earnPop} data-testid="earn-pill">
            <span className="block text-base font-bold leading-tight text-accent">{dash.today.recordedEarnings.length ? dash.today.recordedEarnings.map((e) => money(e.cents, e.currency)).join(' + ') : money(0, 'EUR')}</span>
            <span className="block text-[10px] leading-tight text-muted">{t('driver.home.earnedToday')}</span>
          </button>
        )}
        </div>
        {/* Today's card (2026-11-20): what the pill sums up, and «Подробнее» → the full earnings screen. */}
        {dash && earnPop && (
          <>
            <div className="pointer-events-auto fixed inset-0" onClick={() => setEarnPop(false)} aria-hidden />
            <div className="pointer-events-auto relative ms-auto w-[min(290px,100%)] rounded-[16px] border border-edge bg-page/95 p-4 shadow-card backdrop-blur" data-testid="earn-pop" role="dialog" aria-label={t('driver.home.earnedToday')}>
              {earnView === 'time' ? <DutyPane onBack={() => setEarnView('main')} onClose={() => setEarnPop(false)} /> : (<>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted">{t('driver.range.today')}</span>
                <button type="button" onClick={() => setEarnPop(false)} aria-label={t('common.close')} className="-me-1 flex h-8 w-8 items-center justify-center rounded-full text-xl text-muted hover:text-ink">×</button>
              </div>
              <div className="text-[28px] font-bold leading-tight text-accent">{dash.today.recordedEarnings.length ? dash.today.recordedEarnings.map((e) => money(e.cents, e.currency)).join(' + ') : money(0, 'EUR')}</div>
              {/* Four tiles (2026-11-20, operator): cash | card / done + cancelled | time online.
                  Done/cancelled → the trips analytics straight on «Выполнено»; the others → the full screen. */}
              {(() => {
                const sum = (xs?: { currency: string; cents: number }[]) => (xs && xs.length ? xs.map((e) => money(e.cents, e.currency)).join(' + ') : money(0, 'EUR'));
                const tile = 'rounded-[12px] border border-edge bg-elevated px-3 py-2 text-start active:bg-white/5';
                const go = (to: 'summary' | 'analytics') => { setEarnPop(false); props.goEarnings(to); };
                return (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className={tile} onClick={() => go('summary')} data-testid="earn-cash">
                        <div className="text-[11px] text-muted">💶 {t('driver.home.todayCash')}</div>
                        <div className="text-lg font-semibold tabular-nums">{sum(dash.today.cash)}</div>
                      </button>
                      <button type="button" className={tile} onClick={() => go('summary')} data-testid="earn-card">
                        <div className="text-[11px] text-muted">💳 {t('driver.home.todayCard')}</div>
                        <div className="text-lg font-semibold tabular-nums">{sum(dash.today.card)}</div>
                      </button>
                    </div>
                    {/* Trips tile wider, time tile narrower (2026-11-20, operator); done AND cancelled shown
                        equally; a tap opens the analytics panel (Выполнено / Не выполнено), not the list. */}
                    <div className="grid grid-cols-[1.55fr_1fr] gap-2">
                      <button type="button" className={`${tile} flex items-center justify-around`} onClick={() => go('analytics')} data-testid="earn-trips"
                        aria-label={`${t('driver.analytics.doneShort')} ${dash.today.completedTrips}, ${t('driver.analytics.notDone')} ${dash.today.canceledTrips ?? 0}`}>
                        {/* Side by side, no words (2026-11-20, operator): green ✓ done, red ✕ not done. */}
                        <span className="flex items-baseline gap-1.5"><span className="text-[14px] font-bold text-[#34C759]">✓</span><span className="text-[22px] font-semibold tabular-nums" data-testid="earn-done-n">{dash.today.completedTrips}</span></span>
                        <span className="flex items-baseline gap-1.5"><span className="text-[14px] font-bold text-danger">✕</span><span className="text-[22px] font-semibold tabular-nums" data-testid="earn-canceled-n">{dash.today.canceledTrips ?? 0}</span></span>
                      </button>
                      <button type="button" className={tile} onClick={() => setEarnView('time')} data-testid="earn-online">
                        <div className="text-[11px] text-muted">{t('driver.earnings.onlineTime')} ›</div>
                        <div className="whitespace-nowrap text-[15px] font-semibold">{dur(dash.today.onlineSeconds)}</div>
                      </button>
                    </div>
                  </div>
                );
              })()}
              {dash.today.pendingFinalTrips > 0 && <p className="mt-2 text-xs text-muted">{t('driver.analytics.pending', { n: dash.today.pendingFinalTrips })}</p>}
              <button type="button" className="btn-primary mt-3 w-full" data-testid="earn-details" onClick={() => { setEarnPop(false); props.goEarnings('summary'); }}>{t('driver.analytics.tileHint')} ›</button>
              </>)}
            </div>
          </>
        )}
        {props.banner && <button className="pointer-events-auto rounded-[12px] border border-warn/40 bg-page/95 px-3 py-2 text-start text-sm text-warn" onClick={props.onDismissBanner}>{props.banner}</button>}
        {blocker && (
          <div className="pointer-events-auto rounded-[12px] border border-danger/40 bg-page/95 px-3 py-2 text-sm">
            <p className="font-medium text-danger">{blocker.code === 'NO_VEHICLE' ? t('driver.alerts.noVehicle') : blocker.message}</p>
            {blocker.action && <a href={blocker.action.href} className="mt-1 inline-block text-xs underline">{blocker.action.label}</a>}
          </div>
        )}
        {!offer && warning && <div className="pointer-events-auto rounded-[12px] border border-warn/40 bg-page/95 px-3 py-2 text-sm text-warn">{warning.message}{warning.action && <a href={warning.action.href} className="ms-2 underline">{warning.action.label}</a>}</div>}
        {data.onDuty && gps.error && <div className={`pointer-events-auto rounded-[12px] border bg-page/95 px-3 py-2 text-xs ${gps.error === 'acquiring' ? 'border-warn/40 text-warn' : 'border-danger/40 text-danger'}`}>{t(`driver.gps.${gps.error as 'denied' | 'acquiring' | 'unsupported' | 'unavailable'}`)}</div>}
        {data.onDuty && !gps.active && !gps.error && <div className="pointer-events-auto rounded-[12px] border border-edge bg-page/95 px-3 py-2 text-xs text-muted">{t('driver.map.noGps')}</div>}
        <InstallPrompt app="driver" className="pointer-events-auto w-full bg-page/95" />
        {/* One button per action, right-aligned under the messages (never overlapping them). */}
        {!offer && (
          <div className="flex w-full flex-col items-end gap-2">
            {/* Only problems are shown (2026-11-18): GPS off, or a weak fix — not «GPS включён». */}
            {data.onDuty && (!gps.active || (gps.accuracyM != null && accuracyLevel(gps.accuracyM) === 'poor')) && (
              <button className={`${pill} flex h-12 items-center gap-1.5 px-4 text-sm font-medium ${gps.active ? '!border-warn text-warn' : '!border-danger/60 text-danger'}`}
                onClick={gps.active ? props.onStopGps : props.onStartGps} aria-pressed={gps.active}>
                📍 {gps.active ? t('driver.home.gpsOn') : t('driver.home.gpsOff')}
                {gps.active && gps.accuracyM != null && (
                  <span className={`ms-1 rounded-full px-2 py-0.5 text-xs font-semibold ${accuracyLevel(gps.accuracyM) === 'good' ? 'bg-accent/20 text-accent' : accuracyLevel(gps.accuracyM) === 'fair' ? 'bg-warn/20 text-warn' : 'bg-danger/20 text-danger'}`}>
                    ±{gps.accuracyM > 999 ? '999+' : gps.accuracyM} {t('driver.home.gpsM')}{accuracyLevel(gps.accuracyM) === 'poor' ? ` · ${t('driver.home.gpsWeak')}` : ''}
                  </span>
                )}
              </button>
            )}
            <NotifyToggle pushUrl="/driver/push" onlyProblems className={`${pill} flex min-h-[48px] items-center !border-danger/50 px-4`} />
          </div>
        )}
      </div>

      {/* Bottom: online/offline button + cars count, or the offer sheet */}
      <div className="pointer-events-none fixed inset-x-0 z-10 mx-auto max-w-lg px-3" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        {!offer && (
          <div className="flex flex-col items-center gap-2">
            <div className={`${pill} px-3 py-1 text-xs text-muted`}>
              <span className="me-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" />{t('driver.map.free', { n: counts.free })}
              <span className="ms-3 me-1 inline-block h-2 w-2 rounded-full bg-muted align-middle" />{t('driver.map.busy', { n: counts.busy })}
            </div>
            {blocker && !data.onDuty ? (
              <span className="pointer-events-auto rounded-full bg-danger/90 px-5 py-3 text-sm font-semibold text-white">{t('driver.duty.cantGoOnline')}</span>
            ) : (
              data.onDuty ? (
                // Going offline is a swipe (2026-11-18), in a light orange that does not glare at night.
                <div className="pointer-events-auto w-[65%]">
                  <SwipeButton small label={t('driver.duty.goOffline')} onDone={() => props.onDuty(false)} testId="swipe-offline"
                    bgColor="#FFA94D" className="bg-[#FFA94D] text-[#3B2108]" knobClassName="text-[#3B2108]" />
                </div>
              ) : (
                // Same size as the swipe bars (2026-11-18): 65 % wide, 53 px, glint on the rim.
                <button className="pointer-events-auto relative h-[53px] w-[65%] rounded-full bg-accent text-[16px] font-bold text-[#0d1608] shadow-card"
                  onClick={() => props.onDuty(true)}>
                  <EdgeShine />
                  {t('driver.duty.goOnline')}
                </button>
              )
            )}
          </div>
        )}
      {/* Offer takes priority */}
      {offer && !trip && (
        <div key={offer.offerId} className="ily-offer-in card pointer-events-auto max-h-[58dvh] overflow-y-auto border-2 border-accent p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.55)]">
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
            {offer.stop && <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.stop.via')}</span><span className="font-medium">{offer.stop.label}</span></div>}
            <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.whereTo')}</span><span className="font-medium">{offer.dropoff.label}<Postcode code={offer.dropoff.postcode} /></span></div>
            <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.client')}</span><span className="font-medium">{offer.passengerName}</span><ClassBadge vClass={offer.vClass} /></div>
            <div className="flex items-baseline gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.sum')}</span><span className="text-lg font-bold">{offer.fareCents != null ? fareRangeText(offer.fareCents, offer.priceType, (c) => money(c, offer.currency)) : '—'}</span></div>
            {offer.scheduledAt && <div className="text-xs text-muted">🕒 {fmt.dateTime(offer.scheduledAt)}</div>}
            {offer.note && <div className="text-xs text-warn">{t('driver.offer.note', { note: offer.note })}</div>}
            {offer.flightNumber && <div className="font-mono text-xs text-ink">✈ {t('driver.scheduled.flight', { flight: formatFlight(offer.flightNumber) })}</div>}
          </div>
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
    <button onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-edge p-2 text-start text-sm">
      <div className="min-w-0">
        <div className="truncate">{t.pickupLabel} → {t.dropoffLabel}</div>
        <div className="text-xs text-muted">{fmt.dateTime(t.at)} · <span className={badge}>{statusLabel(t.driverStatus)}</span></div>
      </div>
      <div className="shrink-0 text-end"><div className="font-medium">{t.fare.cents != null ? money(t.fare.cents, t.fare.currency) : (t.fare.label === 'Pending' ? fareLabel('Pending') : '—')}</div><div className="text-xs text-muted">{fareLabel(t.fare.label)}{t.payment ? ` · ${paymentLabel(t.payment)}` : ''}</div></div>
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
  bookingId: string; pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string; postcode?: string | null }; stop?: { lat: number; lng: number; label: string } | null;
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
            // The whole card opens the order (2026-11-15), not only the «Посмотреть» button.
            <div key={o.bookingId} role="button" tabIndex={0} aria-label={t('driver.free.view')}
              onClick={() => setViewId(o.bookingId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewId(o.bookingId); } }}
              className="card cursor-pointer p-4 transition hover:border-accent/50 active:scale-[0.99]">
              {o.distanceM != null && <p className="mb-2 text-lg font-bold text-ink">{t('driver.offer.away', { dist: km(o.distanceM) })}</p>}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-accent" /><span className="text-muted">{t('driver.offer.pickup')}</span><span className="ms-auto text-end font-medium">{o.pickup.label}</span></div>
                {o.stop && <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-[#FFC83D]" /><span className="text-muted">{t('driver.map.stop')}</span><span className="ms-auto text-end font-medium">{o.stop.label}</span></div>}
                <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-ink" /><span className="text-muted">{t('driver.offer.destination')}</span><span className="ms-auto text-end font-medium">{o.dropoff.label}<Postcode code={o.dropoff.postcode} /></span></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                <span className="rounded-md border-2 border-white/25 px-2 py-0.5 text-[13px] font-bold uppercase tracking-wide text-ink/80">{t(`common.vClass.${o.vClass}` as MsgKey)}</span>
                {o.scheduledAt && <span className="rounded-full bg-elevated px-2 py-1">🕒 {fmt.dateTime(o.scheduledAt)}</span>}
                {o.flightNumber && <span className="rounded-full bg-elevated px-2 py-1">✈ {o.flightNumber}</span>}
              </div>
              <p className="mt-2 text-sm font-medium">{o.passengerName}</p>
              {o.note && <p className="mt-1 text-xs text-muted">{t('driver.offer.note', { note: o.note })}</p>}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-sm"><span className="font-semibold">{o.fareCents != null ? fareRangeText(o.fareCents, o.priceType, (c) => money(c, o.currency)) : '—'}</span></div>
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
      <DriverHomeMap pos={pos} fullscreen pickup={o ? o.pickup : null} dropoff={o ? o.dropoff : null} via={o?.stop ?? null} fitPadding={sheetFitPadding()} />
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
                {o.stop && <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.stop.via')}</span><span className="font-medium">{o.stop.label}</span></div>}
                <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.whereTo')}</span><span className="font-medium">{o.dropoff.label}<Postcode code={o.dropoff.postcode} /></span></div>
                <div className="flex gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.client')}</span><span className="font-medium">{o.passengerName}</span><ClassBadge vClass={o.vClass} /></div>
                <div className="flex items-baseline gap-2"><span className="w-20 shrink-0 text-muted">{t('driver.offer.sum')}</span><span className="text-lg font-bold">{o.fareCents != null ? fareRangeText(o.fareCents, o.priceType, (c) => money(c, o.currency)) : '—'}</span></div>
                {o.scheduledAt && <div className="text-xs text-muted">🕒 {fmt.dateTime(o.scheduledAt)}</div>}
                {o.note && <div className="text-xs text-warn">{t('driver.offer.note', { note: o.note })}</div>}
                {o.flightNumber && <div className="font-mono text-xs text-ink">✈ {t('driver.scheduled.flight', { flight: formatFlight(o.flightNumber) })}</div>}
              </div>
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

// ---- «Время на линии» inside the today card (2026-11-20) ----
function DutyPane({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { t } = useT();
  const { dur } = useDriverFmt();
  type Duty = { onlineSec: number; onTripSec: number; km: number; weekSec: number; weekKm: number; week: { day: string; onlineSec: number; km: number }[]; onlineNow: boolean };
  const [d, setD] = useState<Duty | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api<Duty>('/driver/duty').then((r) => { if (alive) { setD(r); setErr(false); } }).catch(() => { if (alive) setErr(true); });
    load();
    const id = setInterval(load, 30_000); // an open shift keeps counting
    return () => { alive = false; clearInterval(id); };
  }, []);
  const km = (n: number) => t('rides.detail.km', { km: n.toLocaleString(undefined, { maximumFractionDigits: 1 }) });
  return (
    <div data-testid="duty-pane">
      <div className="flex items-center justify-between">
        <BackArrow onBack={onBack} className="-ms-2" />
        <span className="flex-1 text-sm font-semibold text-muted">{t('driver.earnings.onlineTime')}</span>
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="-me-1 flex h-8 w-8 items-center justify-center rounded-full text-xl text-muted hover:text-ink">×</button>
      </div>
      {!d ? <p className="py-4 text-sm text-muted">{err ? t('driver.detail.loadFailed') : t('common.loading')}</p> : (
        <>
          <div className="text-[28px] font-bold leading-tight text-accent">{dur(d.onlineSec)}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2">
              <div className="text-[11px] text-muted">🚕 {t('driver.home.timeOnTrips')}</div>
              <div className="whitespace-nowrap text-lg font-semibold">{dur(d.onTripSec)}</div>
            </div>
            {/* Km on orders today (2026-11-20, operator): to the client + A → B, by GPS. */}
            <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2" data-testid="duty-km">
              <div className="text-[11px] text-muted">🛣️ {t('driver.home.timeKm')}</div>
              <div className="whitespace-nowrap text-lg font-semibold">{km(d.km)}</div>
            </div>
          </div>
          <WeekCandles week={d.week} dur={dur} km={km} />
          <div className="mt-2 rounded-[12px] border border-edge px-3 py-2 text-sm">
            <div className="text-[12px] text-muted">{t('driver.home.timeWeek')}</div>
            <span className="whitespace-nowrap font-semibold"><span className="text-accent">{dur(d.weekSec)}</span> · <span className="text-danger">{km(d.weekKm)}</span></span>
          </div>
        </>
      )}
    </div>
  );
}

// Monday → Sunday like an exchange candle chart (2026-11-20, operator): per day a lime candle for the
// time online and a red one beside it for the km on orders, each on its own scale. Today is marked.
function WeekCandles({ week, dur, km }: { week: { day: string; onlineSec: number; km: number }[]; dur: (s: number) => string; km: (n: number) => string }) {
  const { t, locale } = useT();
  const W = 280, H = 132, top = 10, base = 108, gw = W / 7;
  const maxH = Math.max(8 * 3600, ...week.map((d) => d.onlineSec));
  const maxK = Math.max(50, ...week.map((d) => d.km));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Nicosia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // Tap a day → its hours and km above the chart (2026-11-20, operator); today is picked at first.
  const [sel, setSel] = useState<string>(() => (week.some((d) => d.day === today) ? today : week[0]?.day ?? ''));
  const picked = week.find((d) => d.day === sel) ?? null;
  const dayLabel = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const wd = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const candle = (x: number, v: number, max: number, color: string, key: string) => {
    const h = v > 0 ? Math.max(3, ((base - top) * v) / max) : 0;
    const y = base - h;
    return (
      <g key={key}>
        {h > 0 && <line x1={x + 4.5} x2={x + 4.5} y1={Math.max(top, y - 5)} y2={base} stroke={color} strokeWidth={1} opacity={0.6} />}
        <rect x={x} y={h > 0 ? y : base - 1} width={9} height={h > 0 ? h : 1} rx={2} fill={color} opacity={h > 0 ? 1 : 0.35} />
      </g>
    );
  };
  return (
    <div className="mt-3 rounded-[12px] border border-edge bg-elevated px-2 pb-1 pt-2" data-testid="duty-candles">
      {picked && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1" data-testid="candle-picked">
          <span className="truncate text-[12px] font-semibold first-letter:uppercase">{dayLabel(picked.day)}</span>
          <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold"><span className="text-accent">{dur(picked.onlineSec)}</span> · <span className="text-danger">{km(picked.km)}</span></span>
        </div>
      )}
      <div className="flex items-center gap-3 px-1 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-accent" />{t('driver.home.chartOnline')}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-danger" />{t('driver.home.chartKm')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${t('driver.home.chartOnline')} / ${t('driver.home.chartKm')}`}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={base - (base - top) * f} y2={base - (base - top) * f} stroke="currentColor" opacity={0.08} />)}
        <line x1={0} x2={W} y1={base} y2={base} stroke="currentColor" opacity={0.25} />
        {week.map((d, i) => {
          const x0 = i * gw + gw / 2 - 10.5;
          const isToday = d.day === today;
          return (
            <g key={d.day}>
              {(d.day === sel || isToday) && <rect x={i * gw + 2} y={top - 6} width={gw - 4} height={base - top + 22} rx={6} fill={d.day === sel ? '#C8FF46' : 'currentColor'} opacity={d.day === sel ? 0.14 : 0.06} />}
              {candle(x0, d.onlineSec, maxH, '#C8FF46', 'o')}
              {candle(x0 + 12, d.km, maxK, 'rgb(var(--c-danger))', 'k')}
              <text x={i * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={isToday || d.day === sel ? 1 : 0.55} fontWeight={isToday || d.day === sel ? 700 : 400}>{wd(d.day)}</text>
              {/* The whole column is the tap target. */}
              <rect x={i * gw} y={0} width={gw} height={H} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => setSel(d.day)} data-testid={`candle-${d.day}`}>
                <title>{`${wd(d.day)}: ${dur(d.onlineSec)} · ${km(d.km)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- Earnings ----
function EarningsSection({ initialRange = 'week', openAnalytics }: { initialRange?: Range; openAnalytics?: boolean } = {}) {
  const { t, tp, tError } = useT();
  const [analytics, setAnalytics] = useState(!!openAnalytics); // «Выполнено заказов» tile → analytics sub-screen (2026-11-19)
  const { money, dur } = useDriverFmt();
  const [range, setRange] = useState<Range>(initialRange);
  const [data, setData] = useState<{ summary: { byCurrency: { currency: string; completedTrips: number; recordedEarningsCents: number; knownFinalTrips: number; pendingFinalTrips: number; collectedCents: number }[]; completedTrips: number; pendingFinalTrips: number; onlineSeconds: number }; daily: { day: string; recordedEarningsCents: number; completedTrips: number; currency: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await api(`/driver/earnings?range=${range}`)); } catch (e) { setErr(e ? tError(e) : t('driver.detail.loadFailed')); } finally { setLoading(false); }
  }, [range, t, tError]);
  useEffect(() => { load(); }, [load]);

  const max = Math.max(1, ...(data?.daily.map((d) => d.recordedEarningsCents) ?? [0]));
  if (analytics) return <DriverAnalytics onBack={() => setAnalytics(false)} />;
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
            <button type="button" onClick={() => setAnalytics(true)} data-testid="analytics-tile" className="relative rounded-[12px] text-start">
              <Figure label={t('driver.earnings.completedTrips')} value={String(data.summary.completedTrips)} sub={t('driver.analytics.tileHint') + ' ›'} />
            </button>
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
                  {data.daily.map((d) => <div key={d.day + d.currency} className="flex h-full min-w-[8px] flex-1 flex-col items-center justify-end" title={`${d.day}: ${money(d.recordedEarningsCents, d.currency)}`}><div className="w-full rounded-t bg-accent" style={{ height: `${(d.recordedEarningsCents / max) * 100}%` }} /></div>)}
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
      <h1 className="text-xl font-semibold">{t('driver.profile.title')}</h1>
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold">{dash?.driver.name ?? t('driver.profile.driverFallback')}</div>
          {dash && (dash.driver.rating.count > 0
            ? <div className="text-sm font-semibold text-accent" title={tp('driver.profile.ratings', dash.driver.rating.count)}>★ {dash.driver.rating.average?.toFixed(1)} <span className="text-xs font-normal text-muted">({dash.driver.rating.count})</span></div>
            : <div className="text-xs text-muted">{t('driver.profile.noRatings')}</div>)}
        </div>
        <div className="text-xs text-muted">{t('driver.profile.eligibility', { value: dash?.driver.eligibility ? tOr(`driver.profile.eligibilityValue.${dash.driver.eligibility}`, dash.driver.eligibility) : '—' })}</div>
        {/* Notifications in the settings (2026-11-18): status + turn on, next to the language. */}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-edge pt-3">
          <span className="text-sm">{t('driver.profile.notifications')}</span>
          <NotifyToggle pushUrl="/driver/push" className="text-end" />
        </div>
        {/* Ride-share «Беру попутчиков» (Task 022). */}
        <div className="mt-3 border-t border-edge pt-3">
          <AcceptsSharedToggle />
        </div>
        {/* App colour (2026-11-19): chosen at registration, changed here. */}
        <div className="mt-3 border-t border-edge pt-3">
          <div className="mb-2 text-sm">{t('common.theme.title')}</div>
          <ThemePicker role="driver" />
        </div>
        {/* App language (2026-11-17): set by the phone's language; changed only here. */}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-edge pt-3">
          <span className="text-sm">{t('common.language')}</span>
          <LanguageSwitcher only={DRIVER_LOCALES} />
        </div>
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

      <StaffPasswordForm />

      <button onClick={signOut} className="btn-ghost w-full !text-danger">{t('driver.profile.signOut')}</button>
    </div>
  );
}

// ---- Bottom nav ----
function BottomNav({ tab, setTab, hasOffer, freeCount }: { tab: Tab; setTab: (t: Tab) => void; hasOffer: boolean; freeCount: number }) {
  const { t } = useT();
  const items: { id: Tab; label: string }[] = [
    // Pre-bookings live in the ☰ menu now (2026-11-19); a new one shows as the round «П» button on the map.
    { id: 'home', label: t('driver.nav.home') }, { id: 'free', label: t('driver.nav.free') },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-page/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto flex max-w-lg">
        {items.map((it) => (
          // Text only (2026-11-18): no emoji, bigger and bolder words; counts sit at the word's corner.
          // 2026-11-19: 18 px, a touch heavier, letters a bit see-through, the chosen one a duller lime.
          <button key={it.id} onClick={() => setTab(it.id)} className={`flex min-h-[56px] flex-1 items-center justify-center py-1 text-[18px] font-extrabold ${tab === it.id ? 'text-accent/70' : 'text-muted/75'}`}>
            <span className="relative">
              {it.label}
              {it.id === 'home' && hasOffer && tab !== 'home' && <span className="absolute -end-3 -top-1 h-2 w-2 rounded-full bg-accent" />}
              {/* Small red count: new free orders / open pre-bookings. */}
              {it.id === 'free' && freeCount > 0 && <span className="absolute -end-5 -top-2.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[18px] text-white">{freeCount}</span>}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// Car class on offers / free orders (2026-11-18): no passenger count — just «Comfort» or «XL», bold and
// outlined so it stands out at a glance.
function ClassBadge({ vClass }: { vClass: string }) {
  const { t } = useT();
  return <span className="ms-auto shrink-0 rounded-md border-2 border-white/25 px-2 py-0.5 text-[15px] font-bold uppercase tracking-wide text-ink/80">{t(`common.vClass.${vClass}` as MsgKey)}</span>;
}
