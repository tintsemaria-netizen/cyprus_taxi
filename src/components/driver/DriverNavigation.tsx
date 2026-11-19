'use client';

import { Postcode } from '@/components/driver/Postcode';
import { navZoomTarget, nextNavZoom, smoothSpeed, NAV_ZOOM_MAX } from '@/lib/nav-zoom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { ChatPanel } from '@/components/ChatPanel';
import { FarePreviewSheet } from './FarePreviewSheet';
import { useSheetDrag } from '@/components/useSheetDrag';
import { useHideClipped } from '@/components/useHideClipped';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { api } from '@/lib/api-client';
import { formatFlight } from '@/lib/flight';
import { meterWaitingCents, meterWaitingRatePerHourCents } from '@/lib/tariff';
import { useT, type MsgKey } from '@/i18n/I18nProvider';
import { INTL_TAG } from '@/i18n/config';
import SwipeButton from '@/components/SwipeButton';
import EdgeShine from '@/components/EdgeShine';

// One size for every driver action button (2026-11-18): like «Выйти на линию» — 65 % wide, 53 px,
// round, bold, glint on the rim.
const STAGE_BTN = 'relative mx-auto block h-[53px] w-[65%] rounded-full bg-accent text-[16px] font-bold text-[#0d1608] shadow-lg active:scale-[0.99]';
import { bearingDeg, cumulative, distM, locate, maneuverIcon, nextStep, offsetPoint, promptBand, roundNavDistance, type LatLng, type NavStep } from '@/lib/nav';

// Full-screen navigation for an accepted ride (replaces the tabbed driver UI while a trip is
// active): heading-up map following the car, turn-by-turn banner with optional voice, rerouting,
// and a compact sheet with the one action for the current stage. Route = real Google Routes data
// from /driver/navigation; with no router we say so and offer external navigation — never a fake line.

export interface NavTrip {
  bookingId: string; reference: string; status: string;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string; postcode?: string | null };
  payment?: 'CASH' | 'CARD'; startCodeRequired?: boolean; passengerName: string; passengerRating?: { average: number; count: number } | null; passengerPhone: string; note: string | null; flightNumber?: string | null; passengerCount: number; luggageCount?: number; vClass: string;
  waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null;
  /** Passenger's live position, only if they chose to share it, only before pickup (2026-11-15). */
  passengerLocation?: { lat: number; lng: number; accuracyM: number; ageSec: number } | null;
  /** One optional intermediate stop (2026-11-15). */
  stop?: { lat: number; lng: number; label: string; arrivedAt: string | null; waitStartedAt: string | null; departedAt: string | null; waitCents: number | null; tariff?: string } | null;
}
interface NavRoute { distanceM: number; durationSec: number; path: [number, number][]; steps: NavStep[]; fetchedAt: number; from: LatLng }
type NavResp = { available: boolean; reason?: string; distanceM?: number; durationSec?: number; path?: [number, number][]; steps?: NavStep[] };

const OFF_ROUTE_M = 60;
const REFRESH_MS = 60_000;
const MIN_GAP_MS = 8_000;
const MUTE_KEY = 'driver-nav-muted';

export function DriverNavigation(props: {
  trip: NavTrip; pos: LatLng | null; gps: { active: boolean; error: string | null }; nowMs: number;
  startCode: string; setStartCode: (v: string) => void; banner: string | null; onDismissBanner: () => void;
  onStartGps: () => void; onTripAction: (path: string, body: Record<string, unknown>, opts?: { stopGps?: boolean }) => void;
}) {
  const { trip, pos, gps, nowMs, startCode, setStartCode } = props;
  const { t, fmt, locale } = useT();
  // Legs: pickup → (stop, if any, until the driver continues from it) → destination.
  const stop = trip.stop ?? null;
  const leg: 'pickup' | 'stop' | 'dropoff' = trip.status !== 'IN_PROGRESS' ? 'pickup' : stop && !stop.departedAt ? 'stop' : 'dropoff';
  const target = leg === 'dropoff' ? trip.dropoff : leg === 'stop' ? stop! : trip.pickup;
  const atStop = leg === 'stop' && !!stop?.arrivedAt; // standing at the stop (maybe paid waiting)
  const waitingAtPickup = trip.status === 'ARRIVED' || atStop;

  const [route, setRoute] = useState<NavRoute | null>(null);
  const [routeState, setRouteState] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [following, setFollowing] = useState(true);
  // Chat lives behind a map button now (2026-11-15); kept mounted so it polls and counts unread.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  // Info panel open/collapsed (2026-11-15): tap the handle or swipe it up/down.
  const [panelOpen, setPanelOpen] = useState(trip.status !== 'IN_PROGRESS');
  const [menuOpen, setMenuOpen] = useState(false);
  const canRelease = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(trip.status);
  // Tablets/desktop (≥640px): the sheet becomes a left column, so the map fit pads the left side.
  const [wide, setWide] = useState(false);
  useEffect(() => { const mq = window.matchMedia('(min-width: 640px)'); const on = () => setWide(mq.matches); on(); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }, []);
  // The info panel folds itself away the moment the ride starts (manual tap/swipe still works).
  const prevStatus = useRef(trip.status);
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const sheetDrag = useSheetDrag({ open: panelOpen, setOpen: setPanelOpen, scrollRef: panelBodyRef });
  useHideClipped(panelBodyRef, !panelOpen);
  useEffect(() => { if (trip.status !== prevStatus.current) { if (trip.status === 'IN_PROGRESS') setPanelOpen(false); prevStatus.current = trip.status; } }, [trip.status]);
  const swipeY = useRef<number | null>(null);
  const swiped = useRef(false);
  const [ask, setAsk] = useState<'complete' | 'release' | null>(null);
  const [muted, setMuted] = useState(false);
  const [clock, setClock] = useState(0); // for the arrival time; refreshed every 15 s
  useEffect(() => { setClock(Date.now()); const id = setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(id); }, []);
  useEffect(() => { try { setMuted(localStorage.getItem(MUTE_KEY) === '1'); } catch { /* storage blocked */ } }, []);
  const toggleMute = () => setMuted((m) => { try { localStorage.setItem(MUTE_KEY, m ? '0' : '1'); } catch { /* ignore */ } if (!m) window.speechSynthesis?.cancel(); return !m; });

  const spoken = useRef<Set<string>>(new Set()); // voice prompts already given

  // ---- Route fetching / rerouting ----
  const posRef = useRef(pos);
  posRef.current = pos;
  const inFlight = useRef(false);
  const lastFetch = useRef(0);
  const moveHeading = useRef<number | null>(null);
  const [travelHeading, setTravelHeading] = useState<number | null>(null);
  const fetchRoute = useCallback(async (force = false) => {
    const p = posRef.current;
    if (!p || inFlight.current || (!force && Date.now() - lastFetch.current < MIN_GAP_MS)) return;
    inFlight.current = true; lastFetch.current = Date.now();
    try {
      const r = await api<NavResp>('/driver/navigation', { method: 'POST', body: { from: p, heading: moveHeading.current, lang: locale }, timeoutMs: 10000 });
      if (r.available && r.path && r.path.length > 1) {
        setRoute({ distanceM: r.distanceM ?? 0, durationSec: r.durationSec ?? 0, path: r.path, steps: r.steps ?? [], fetchedAt: Date.now(), from: p });
        setRouteState('ok');
      } else { setRoute(null); setRouteState(r.reason === 'ARRIVED' ? 'ok' : 'unavailable'); }
    } catch { setRouteState((s) => (s === 'ok' ? s : 'unavailable')); /* keep the last good route on a blip */ }
    finally { inFlight.current = false; }
  }, [locale]);

  // New leg (pickup → destination) or language: drop the old route and fetch at once.
  const hasPos = !!pos;
  useEffect(() => {
    setRoute(null); setRouteState('loading'); spoken.current = new Set();
    if (waitingAtPickup) return;
    if (hasPos) fetchRoute(true);
    const id = setInterval(() => fetchRoute(), REFRESH_MS); // traffic-aware ETA refresh
    return () => clearInterval(id);
  }, [leg, waitingAtPickup, hasPos, fetchRoute]);

  // ---- Progress along the route ----
  const cum = useMemo(() => (route ? cumulative(route.path) : []), [route]);
  const segRef = useRef(0);
  useEffect(() => { segRef.current = 0; }, [route]);
  const progress = useMemo(() => (route && pos ? locate(route.path, cum, pos, segRef.current) : null), [route, cum, pos]);
  useEffect(() => { if (progress) segRef.current = progress.seg; }, [progress]);

  // Driving vs standing still (arrow pulse): moved ≥ 10 m within the last 8 s of GPS samples.
  const samples = useRef<{ p: LatLng; t: number }[]>([]);
  const [moving, setMoving] = useState(false);
  // Speed-dependent zoom: out when accelerating, back in when slowing (more in on the motorway).
  const speedRef = useRef<number | null>(null);
  const [navZoom, setNavZoom] = useState(NAV_ZOOM_MAX);
  const remainingRef = useRef<number | null>(null); // metres left to the point (set below each render)
  useEffect(() => {
    if (!pos) return;
    const now = Date.now();
    samples.current = [...samples.current.filter((s) => now - s.t <= 8000), { p: pos, t: now }];
    const first = samples.current[0];
    setMoving(distM(first.p, pos) >= 10);
    // Speed over the sample window (≥ 2 s apart) → smoothed → camera zoom (2026-11-17).
    const dt = (now - first.t) / 1000;
    if (dt >= 2) {
      speedRef.current = smoothSpeed(speedRef.current, (distM(first.p, pos) / dt) * 3.6);
      setNavZoom((z) => nextNavZoom(z, navZoomTarget(speedRef.current ?? 0, remainingRef.current)));
    }
  }, [pos]);
  useEffect(() => {
    // No new fixes for a while → the car is standing (GPS often stops reporting when still).
    if (!moving) return;
    const id = setTimeout(() => { setMoving(false); speedRef.current = 0; setNavZoom(navZoomTarget(0, remainingRef.current)); }, 10000);
    return () => clearTimeout(id);
  }, [moving, pos]);
  // Direction of travel from movement when off the route line (or no route yet).
  const lastPosRef = useRef<LatLng | null>(null);
  useEffect(() => {
    if (!pos) return;
    const prev = lastPosRef.current;
    if (!prev) { lastPosRef.current = pos; return; }
    if (distM(prev, pos) >= 8) { const h = bearingDeg(prev, pos); moveHeading.current = h; setTravelHeading(h); lastPosRef.current = pos; }
  }, [pos]);

  // Off route for two consecutive fixes → reroute.
  const offCount = useRef(0);
  useEffect(() => {
    if (!progress) return;
    offCount.current = progress.offRouteM > OFF_ROUTE_M ? offCount.current + 1 : 0;
    if (offCount.current >= 2) { offCount.current = 0; fetchRoute(); }
  }, [progress, fetchRoute]);

  const remainingM = route && progress ? Math.max(0, route.distanceM - progress.alongM) : route?.distanceM ?? (pos ? distM(pos, target) : null);
  remainingRef.current = remainingM;
  const remainingSec = route && remainingM != null && route.distanceM > 0 ? Math.round(route.durationSec * (remainingM / route.distanceM)) : null;
  const upcoming = route && progress ? nextStep(route.steps, cum, progress.alongM) : null;
  const atTarget = !waitingAtPickup && pos != null && distM(pos, target) < 50;
  const rerouting = !!progress && progress.offRouteM > OFF_ROUTE_M;

  function distLabel(m: number) {
    const r = roundNavDistance(m);
    return r.unit === 'km' ? t('driver.navigation.km', { n: fmtNum(r.value) }) : t('driver.navigation.m', { n: r.value });
  }
  function fmtNum(n: number) { return new Intl.NumberFormat(INTL_TAG[locale], { maximumFractionDigits: 1 }).format(n); }

  // ---- Voice prompts ----
  const say = useCallback((text: string) => {
    if (muted || typeof window === 'undefined' || !window.speechSynthesis || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = INTL_TAG[locale];
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, [muted, locale]);
  useEffect(() => {
    if (!upcoming || !upcoming.step.text) return;
    // Departure is announced once as-is; manoeuvres get "In 250 m, turn left…" then just the instruction.
    if (upcoming.index === 0) { if (!spoken.current.has('depart')) { spoken.current.add('depart'); say(upcoming.step.text); } return; }
    const band = promptBand(upcoming.inM);
    if (band == null) return;
    const key = `${route?.fetchedAt}:${upcoming.index}:${band}`;
    const stepKey = `${upcoming.index}:${band}:${upcoming.step.text}`; // same instruction after a reroute: don't repeat
    if (spoken.current.has(key) || spoken.current.has(stepKey)) return;
    spoken.current.add(key); spoken.current.add(stepKey);
    say(band <= 40 ? upcoming.step.text : `${t('driver.navigation.inDistance', { dist: distLabel(upcoming.inM) })}, ${upcoming.step.text}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming?.index, upcoming && promptBand(upcoming.inM), route?.fetchedAt, say]);
  useEffect(() => {
    if (!atTarget) return;
    const key = `arrive:${leg}`;
    if (spoken.current.has(key)) return;
    spoken.current.add(key);
    say(leg === 'pickup' ? t('driver.navigation.arrivedPickup') : leg === 'stop' ? t('driver.navigation.arrivedStop') : t('driver.navigation.arrivedDestination'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atTarget, leg, say]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);


  // ---- Map ----
  const heading = progress && progress.offRouteM < 30 ? progress.bearing : travelHeading ?? 0;
  const camPoint = progress && progress.offRouteM < 30 ? progress.snapped : pos;
  // Aim the camera ~110 m ahead so the car sits in the lower part of the map and the road ahead shows.
  // The look-ahead grows with the zoom-out, so the car stays in the same spot on screen.
  const camCenter = camPoint ? offsetPoint(camPoint, heading, 110 * 2 ** (NAV_ZOOM_MAX - navZoom)) : null;
  const follow = following && camCenter && !waitingAtPickup ? { lat: camCenter.lat, lng: camCenter.lng, heading, zoom: navZoom, tilt: 45 } : null;
  const markers: MapMarker[] = [];
  // The own car points along the route/travel heading (same heading the camera uses).
  // On an order the own position is a navigation arrow (pulses while standing still).
  if (pos) markers.push({ id: 'me', lat: pos.lat, lng: pos.lng, kind: 'vehicle', self: true, nav: true, moving, heading, label: t('driver.map.you') });
  // Only the CURRENT target is on the map (2026-11-15): on the way to / waiting at the pickup the
  // driver sees just the pickup point — not the whole trip (the map would zoom out to fit it).
  if (leg === 'pickup') markers.push({ id: 'pk', lat: trip.pickup.lat, lng: trip.pickup.lng, kind: 'pickup', label: t('driver.map.pickup') });
  if (leg === 'stop' && stop) markers.push({ id: 'st', lat: stop.lat, lng: stop.lng, kind: 'stop', label: t('driver.map.stop') });
  if (leg === 'dropoff') markers.push({ id: 'dp', lat: trip.dropoff.lat, lng: trip.dropoff.lng, kind: 'dropoff', label: t('driver.map.destination') });
  const paxLoc = leg === 'pickup' ? trip.passengerLocation ?? null : null;
  if (paxLoc) markers.push({ id: 'pax', lat: paxLoc.lat, lng: paxLoc.lng, kind: 'person', label: trip.passengerName });
  const paxFromPickupM = paxLoc ? Math.round(metersBetween(paxLoc, trip.pickup)) : null;
  const routeLine = useMemo(() => (route ? route.path.slice(Math.max(0, (progress?.seg ?? 0))).map(([la, ln]) => [ln, la] as [number, number]) : []), [route, progress?.seg]);
  const externalHref = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;

  // ---- Paid waiting meter at the stop (no grace; added to the main fare) ----
  let stopNode: React.ReactNode = null;
  if (atStop && stop) {
    if (stop.waitStartedAt) {
      const secs = Math.max(0, Math.floor((nowMs - new Date(stop.waitStartedAt).getTime()) / 1000));
      const cents = meterWaitingCents(new Date(stop.waitStartedAt), new Date(nowMs));
      stopNode = (
        <div>
          <div className="flex items-center justify-between gap-2"><span className="text-warn">⏱ {t('driver.stop.paidWaiting')}</span><span className="font-mono text-lg text-warn">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} · {fmt.money(cents)}</span></div>
          <div className="mt-0.5 text-xs text-muted">{t('driver.stop.rateNote', { rate: fmt.money(meterWaitingRatePerHourCents(new Date(nowMs))) })}</div>
        </div>
      );
    } else {
      stopNode = <span className="text-muted">{t('driver.stop.atStopHint')}</span>;
    }
  }

  // ---- Waiting timer at pickup ----
  let waitingNode: React.ReactNode = null;
  if (trip.status === 'ARRIVED' && trip.waiting) {
    const elapsed = Math.max(0, Math.floor((nowMs - new Date(trip.waiting.arrivedAt).getTime()) / 1000));
    const freeLeft = Math.max(0, trip.waiting.graceSeconds - elapsed);
    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    waitingNode = freeLeft > 0
      ? (() => { const [before, after] = t('driver.trip.freeWaitingLeft', { time: '\u0000' }).split('\u0000'); return <span>{before}<span className="font-mono text-accent">{mmss(freeLeft)}</span>{after}</span>; })()
      : <span className="text-warn">{trip.waiting.paidRateCentsPerMin > 0 ? t('driver.trip.freeWaitingElapsedPaid', { rate: fmt.money(trip.waiting.paidRateCentsPerMin) }) : t('driver.trip.freeWaitingElapsedFree')}</span>;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page" data-testid="driver-nav">
      {/* No manoeuvre banner and no notice strip on top (2026-11-19): the map uses the whole screen;
          turn-by-turn stays in the voice prompts. Only the status-bar safe area is kept. */}
      <div className="shrink-0 bg-page" style={{ height: 'env(safe-area-inset-top)' }} />

      {/* Map */}
      <div className="relative min-h-0 flex-1" data-nav-zoom={navZoom}>
        {/* Turn hint (2026-11-19): back, but quiet — a small dark see-through card in the top-left
            corner instead of the bright full-width bar. */}
        <div className="pointer-events-auto absolute start-3 top-3 z-10 max-w-[70%] rounded-[14px] border border-white/[0.08] bg-[#10191C]/30 px-3 py-2 text-ink [text-shadow:0_1px_3px_rgba(0,0,0,.85)] nav-hint-card" aria-live="polite" data-testid="nav-hint">
        {atStop && stop ? (
          <div><div className="text-[15px] font-bold">{t('driver.stop.atStop')}</div><div className="truncate text-[12px] text-muted">{stop.label}</div></div>
        ) : waitingAtPickup ? (
          <div><div className="text-[15px] font-bold">{t('driver.navigation.waitingFor', { name: trip.passengerName })}</div><div className="truncate text-[12px] text-muted">{trip.pickup.label}</div></div>
        ) : atTarget ? (
          <div><div className="text-[15px] font-bold">{leg === 'pickup' ? t('driver.navigation.arrivedPickup') : leg === 'stop' ? t('driver.navigation.arrivedStop') : t('driver.navigation.arrivedDestination')}</div><div className="truncate text-[12px] text-muted">{target.label}</div></div>
        ) : !pos ? (
          <div className="text-[14px] font-semibold">{t('driver.navigation.needGps')}</div>
        ) : routeState === 'unavailable' ? (
          <div className="flex items-center justify-between gap-3"><span className="text-[13px] font-semibold">{t('driver.navigation.unavailable')}</span><a href={externalHref} target="_blank" rel="noreferrer" className="shrink-0 rounded-[10px] border border-edge px-2.5 py-1.5 text-[12px] font-semibold text-accent">{t('driver.navigation.openExternal')}</a></div>
        ) : rerouting ? (
          <div className="text-[15px] font-bold">{t('driver.navigation.rerouting')}</div>
        ) : upcoming ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl leading-none text-accent" aria-hidden>{maneuverIcon(upcoming.step.maneuver)}</span>
            <div className="min-w-0">
              <div className="text-[17px] font-bold leading-tight">{distLabel(upcoming.inM)}</div>
              <div className="truncate text-[12px] text-muted" data-testid="nav-instruction">{upcoming.step.text}</div>
            </div>
          </div>
        ) : routeState === 'loading' ? (
          <div className="text-[14px] font-semibold">{t('driver.navigation.loading')}</div>
        ) : (
          <div className="text-[15px] font-bold">{t('driver.navigation.continueTo', { place: target.label })}</div>
        )}
        </div>
        {/* keepInView (2026-11-19): whenever the follow camera is off, the car + the point (+ the road
            left) stay framed and the map closes in step by step as the car gets nearer — never a one-off
            zoom-out that stays put. */}
        <AutoMapView markers={markers} route={routeLine} center={pos ?? target} zoom={15} interactive className="h-full w-full" keepInView
          follow={follow} onFollowBreak={() => setFollowing(false)} idleReturnMs={4000} onIdleReturn={() => setFollowing(true)} fitPadding={wide ? { top: 60, right: 50, bottom: 60, left: 470 } : { top: 60, right: 50, bottom: panelOpen ? 520 : 330, left: 50 }} />
        <div className="absolute end-3 top-3 flex flex-col gap-2">
          <button onClick={toggleMute} className="flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-page/90 text-lg" aria-label={muted ? t('driver.navigation.unmute') : t('driver.navigation.mute')} aria-pressed={muted}>{muted ? '🔇' : '🔊'}</button>
        </div>
      </div>

      {/* Overlay over the map: recenter, then the stage action (its own floating bar), then the info sheet. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col sm:bottom-4 sm:start-4 sm:end-auto sm:w-[420px]" data-testid="nav-overlay">
        {!following && !waitingAtPickup && pos && (
          <button onClick={() => setFollowing(true)} className="pointer-events-auto mx-auto mb-2 rounded-full border border-accent bg-page/95 px-4 py-2 text-sm font-semibold text-accent">{t('driver.navigation.recenter')}</button>
        )}
        {/* Bottom-right column (2026-11-15): chat two icons above Google Maps; both 20 % smaller (58 px). */}
        <div className={`pointer-events-none ${canRelease ? "mb-[130px]" : "mb-[182px]"} flex flex-col items-end gap-0 px-3`}>
          <button type="button" onClick={() => setChatOpen(true)} aria-label={t('driver.navigation.chat')} title={t('driver.navigation.chat')}
            className="pointer-events-auto relative flex h-[58px] w-[58px] items-center justify-center text-[40px] [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]">
            💬
            {chatUnread > 0 && <span className="absolute -end-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-[#10191C]">{chatUnread > 9 ? '9+' : chatUnread}</span>}
          </button>
          <div className="h-[58px]" aria-hidden />
          <a href={externalHref} target="_blank" rel="noreferrer" aria-label={t('driver.navigation.googleMaps')} title={t('driver.navigation.googleMaps')}
            className="pointer-events-auto flex h-[58px] w-[58px] items-center justify-center [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]">
            <svg viewBox="0 0 24 24" width="48" height="48" aria-hidden>
              <path d="M12 2.2c-3.9 0-7 3-7 6.9 0 5.1 7 12.7 7 12.7s7-7.6 7-12.7c0-3.9-3.1-6.9-7-6.9z" fill="#34A853" />
              <path d="M12 2.2c-2.2 0-4.1 1-5.4 2.5L12 10.1l5.4-5.4C16.1 3.2 14.2 2.2 12 2.2z" fill="#4285F4" />
              <path d="M6.6 4.7A6.9 6.9 0 0 0 5 9.1c0 1.3.4 2.7 1 4l6-6z" fill="#EA4335" />
              <path d="M17.4 4.7 12 10.1l6 3c.6-1.4 1-2.7 1-4 0-1.7-.6-3.2-1.6-4.4z" fill="#FBBC04" />
              <circle cx="12" cy="9.1" r="2.6" fill="#fff" />
            </svg>
          </a>
        </div>
      {/* ☰ right above the stage button (2026-11-18): rides up and down with the sheet. */}
      {canRelease && (
        <div className="pointer-events-none flex justify-end px-3 pb-2">
          <button type="button" onClick={() => setMenuOpen(true)} data-testid="nav-menu" aria-label={t('driver.navigation.menu')} title={t('driver.navigation.menu')}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-page/90 text-ink shadow-lg">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M5 7h14M5 12h14M5 17h14" /></svg>
          </button>
        </div>
      )}
      {/* Action bar: the one action for this stage — separate, above the info sheet, always visible. */}
      <div className="pointer-events-auto space-y-2 px-3 pb-2" data-testid="nav-actions">
          {trip.status === 'ASSIGNED' && <button className={STAGE_BTN} onClick={() => props.onTripAction('status', { to: 'EN_ROUTE' })}><EdgeShine />{t('driver.trip.onTheWay')}</button>}
          {trip.status === 'EN_ROUTE' && <button className={STAGE_BTN} onClick={() => props.onTripAction('arrive', {})}><EdgeShine />{t('driver.trip.arrived')}</button>}
          {/* Start: one tap, or the passenger's 4-digit code when they switched one on (optional since 2026-11-16). */}
          {trip.status === 'ARRIVED' && !trip.startCodeRequired && <button className={STAGE_BTN} onClick={() => props.onTripAction('start', {})}><EdgeShine />{t('driver.trip.startTrip')}</button>}
          {trip.status === 'ARRIVED' && trip.startCodeRequired && (
            <div className="flex gap-2 rounded-[14px] bg-page/95 p-2 shadow-lg">
              <input inputMode="numeric" maxLength={4} aria-label={t('driver.trip.startCodePlaceholder')} placeholder={t('driver.trip.startCodePlaceholder')} value={startCode} onChange={(e) => setStartCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className="min-w-0 flex-1 rounded-[12px] border border-edge bg-page px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em]" />
              <button className="relative h-[53px] shrink-0 rounded-full bg-accent px-5 text-[16px] font-bold text-[#0d1608] disabled:opacity-50" disabled={startCode.length !== 4} onClick={() => props.onTripAction('start', { code: startCode })}><EdgeShine />{t('driver.trip.startTrip')}</button>
            </div>
          )}
          {leg === 'stop' && !atStop && <button className={STAGE_BTN} onClick={() => props.onTripAction('stop', { action: 'arrived' })}><EdgeShine />{t('driver.stop.arrived')}</button>}
          {atStop && (
            <>
              {!stop?.waitStartedAt && <button className="relative mx-auto block h-[53px] w-[65%] rounded-full border border-warn/60 bg-page/95 text-[16px] font-bold text-warn shadow-lg" onClick={() => props.onTripAction('stop', { action: 'wait' })}><EdgeShine />⏱ {t('driver.stop.startWaiting')}</button>}
              <button className={STAGE_BTN} onClick={() => props.onTripAction('stop', { action: 'continue' })}><EdgeShine />{t('driver.stop.continue')}</button>
            </>
          )}
          {/* Swipe, not tap (2026-11-18): dark red, slide left → right to finish. */}
          {trip.status === 'IN_PROGRESS' && leg === 'dropoff' && (
            <div className="mx-auto w-[65%]">
              <SwipeButton small label={t('driver.trip.completeTrip')} onDone={() => setAsk('complete')} testId="swipe-complete"
                bgColor="#7A1E1E" className="bg-[#7A1E1E] text-white" knobClassName="text-white" />
            </div>
          )}
      </div>
      {/* Info sheet: collapses to the summary line (handle tap or swipe). */}
      <div className="pointer-events-auto rounded-t-[18px] border-t border-edge bg-elevated sm:rounded-[18px] sm:border shadow-[0_-6px_20px_rgba(0,0,0,0.35)]" ref={sheetDrag.panelRef} style={{ paddingBottom: 'env(safe-area-inset-bottom)', ...sheetDrag.style }} data-testid="nav-sheet">
        <button type="button" aria-expanded={panelOpen} aria-label={panelOpen ? t('booking.sheet.collapse') : t('booking.sheet.expand')}
          onClick={() => { if (!swiped.current) setPanelOpen((o) => !o); swiped.current = false; }}
          onPointerDown={(e) => { swipeY.current = e.clientY; }}
          onPointerUp={(e) => { if (swipeY.current == null) return; const dy = e.clientY - swipeY.current; swipeY.current = null; if (Math.abs(dy) > 25) { swiped.current = true; setPanelOpen(dy < 0); } }}
          className="flex w-full touch-none justify-center pb-1 pt-2"><span className="h-1.5 w-12 rounded-full bg-edge-strong" /></button>
        <div ref={panelBodyRef} className={`${panelOpen ? 'max-h-[45vh] overflow-y-auto overscroll-contain' : (gps.active ? 'max-h-[150px]' : 'max-h-[176px]') + ' overflow-hidden'} px-4 pb-2 transition-[max-height] duration-300`}>
        {/* Collapsed: a one-line GPS warning instead of the full box (no half-cut box in the peek). */}
        {!gps.active && !panelOpen && (
          <button type="button" onClick={props.onStartGps} className="mb-1 block text-start text-sm font-semibold text-warn">{t('driver.navigation.gpsOffShort')}</button>
        )}
        {!gps.active && panelOpen && (
          <div className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 p-3 text-sm">
            <div className="font-semibold text-warn">{t('driver.navigation.gpsOffTitle')}</div>
            {gps.error && gps.error !== 'acquiring' && <div className="mt-1 text-xs text-danger">{t(`driver.gps.${gps.error as 'denied' | 'unsupported' | 'unavailable'}`)}</div>}
            <button className="btn-primary mt-2 min-h-[44px] w-full" onClick={props.onStartGps}>{t('driver.gps.start')}</button>
          </div>
        )}

        {!waitingAtPickup && (
          <div className="flex items-baseline gap-3" data-testid="nav-summary">
            {/* Twice the old size (2026-11-15) — readable at a glance from the phone holder. */}
            <span className="text-[44px] font-bold leading-none text-accent">{remainingSec != null ? t('driver.navigation.min', { n: Math.max(1, Math.round(remainingSec / 60)) }) : '—'}</span>
            <span className="text-[28px] font-semibold leading-none text-ink">{remainingM != null ? distLabel(remainingM) : ''}</span>
            {remainingSec != null && clock > 0 && <span className="ms-auto text-2xl font-semibold leading-none text-muted">{t('driver.navigation.arriveAt', { time: fmt.time(new Date(clock + remainingSec * 1000)) })}</span>}
          </div>
        )}
        {/* Address only — no «К подаче:» label (2026-11-15); the map shows which point it is. */}
        <div className={`mt-2 text-[26px] font-semibold leading-tight ${panelOpen ? '' : 'line-clamp-2'}`}>{leg === 'dropoff' && <Postcode code={trip.dropoff.postcode} className="!ms-0 me-2 -translate-y-[2px] !text-[18px] !leading-[26px]" />}{target.label}</div>
        {paxLoc && paxFromPickupM != null && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-[#7FB6FF]">
            <span aria-hidden="true">🧍</span>
            {paxFromPickupM <= 30 ? t('driver.navigation.paxAtPickup') : t('driver.navigation.paxFromPickup', { m: paxFromPickupM < 1000 ? `${paxFromPickupM} ${t('driver.home.gpsM')}` : `${(paxFromPickupM / 1000).toFixed(1)} km` })}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 text-lg">
          <span className="font-medium">{trip.passengerName}</span>
          {trip.passengerRating && trip.passengerRating.count > 0 && <span className="text-accent">★ {trip.passengerRating.average.toFixed(1)}</span>}
          {/* Payment left of the class (2026-11-15): cash green, card red — only once the ride has started (2026-11-18). */}
          {trip.status === 'IN_PROGRESS' && <span className={`ms-auto rounded-md border px-2 py-0.5 text-sm font-bold ${trip.payment === 'CARD' ? 'border-danger/60 text-danger' : 'border-[#34C759]/60 text-[#34C759]'}`}>{trip.payment === 'CARD' ? 'card' : 'cash'}</span>}
          <span className={`text-muted ${trip.status === 'IN_PROGRESS' ? '' : 'ms-auto'}`}>{t(`common.vClass.${trip.vClass}` as MsgKey)}</span>
        </div>
        {waitingNode && <div className="mt-2 rounded-[12px] border border-edge bg-page p-3 text-sm">{waitingNode}</div>}
        {stop && leg === 'pickup' && <div className="mt-1 text-sm"><span className="text-muted">{t('driver.stop.via')}</span> <span className="font-medium">{stop.label}</span></div>}
        {stopNode && <div className="mt-2 rounded-[12px] border border-edge bg-page p-3 text-sm">{stopNode}</div>}

        {/* No «Подробнее» section (2026-11-18). The passenger's comment and flight stay visible. */}
        {trip.note && <div className="mt-2 text-sm text-warn">{t('driver.trip.note', { note: trip.note })}</div>}
        {trip.flightNumber && <div className="mt-1 font-mono text-sm">✈ {t('driver.scheduled.flight', { flight: formatFlight(trip.flightNumber) })}</div>}
        </div>
      </div>
      </div>

      {/* Chat over the map (2026-11-15) — kept mounted so new messages are counted on the map button. */}
      <div className={chatOpen ? 'fixed inset-0 z-[60] flex flex-col justify-end bg-black/50' : 'hidden'} onClick={(e) => { if (e.target === e.currentTarget) setChatOpen(false); }}>
        <div className="rounded-t-[18px] bg-page p-2" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          <ChatPanel key={trip.bookingId} listUrl={`/driver/bookings/${trip.bookingId}/messages`} postUrl={`/driver/bookings/${trip.bookingId}/messages`} pushUrl="/driver/push" me="DRIVER" peerLabel="passenger" large
            expandedOverride={chatOpen} onUnread={setChatUnread} callHref={trip.passengerPhone ? `tel:${trip.passengerPhone}` : null} onClose={() => setChatOpen(false)} />
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setMenuOpen(false); }} data-testid="nav-menu-sheet">
          <div className="space-y-2 rounded-t-[18px] bg-elevated p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <button className="relative mx-auto block h-[53px] w-[65%] min-w-[260px] rounded-full border border-danger/50 bg-page px-3 text-[15px] font-bold text-danger" onClick={() => { setMenuOpen(false); setAsk('release'); }}><EdgeShine />{t('driver.trip.release')}</button>
            <button className="relative mx-auto block h-[53px] w-[65%] rounded-full border border-edge bg-page text-[16px] font-bold text-ink" onClick={() => setMenuOpen(false)}><EdgeShine />{t('common.cancel')}</button>
          </div>
        </div>
      )}
      {ask === 'complete' && (
        <FarePreviewSheet bookingId={trip.bookingId} passengerName={trip.passengerName}
          onConfirm={() => { setAsk(null); props.onTripAction('complete', {}, { stopGps: true }); }} onCancel={() => setAsk(null)} />
      )}
      {ask === 'release' && (
        <ConfirmSheet title={t('driver.trip.releaseTitle')} body={t('driver.trip.releaseBody')} confirmLabel={t('driver.trip.releaseConfirm')} danger
          onConfirm={() => { setAsk(null); props.onTripAction('cancel', {}); }} onCancel={() => setAsk(null)} cancelLabel={t('driver.trip.keepRide')} />
      )}
    </div>
  );
}

function metersBetween(a: LatLng, b: LatLng): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
