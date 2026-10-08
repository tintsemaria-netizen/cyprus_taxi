'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { ChatPanel } from '@/components/ChatPanel';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { api } from '@/lib/api-client';
import { formatFlight } from '@/lib/flight';
import { useT } from '@/i18n/I18nProvider';
import { INTL_TAG } from '@/i18n/config';
import { bearingDeg, cumulative, distM, locate, maneuverIcon, nextStep, offsetPoint, promptBand, roundNavDistance, type LatLng, type NavStep } from '@/lib/nav';

// Full-screen navigation for an accepted ride (replaces the tabbed driver UI while a trip is
// active): heading-up map following the car, turn-by-turn banner with optional voice, rerouting,
// and a compact sheet with the one action for the current stage. Route = real Google Routes data
// from /driver/navigation; with no router we say so and offer external navigation — never a fake line.

export interface NavTrip {
  bookingId: string; reference: string; status: string;
  pickup: { lat: number; lng: number; label: string }; dropoff: { lat: number; lng: number; label: string };
  passengerName: string; passengerPhone: string; note: string | null; flightNumber?: string | null; passengerCount: number; vClass: string;
  waiting: { arrivedAt: string; graceSeconds: number; paidRateCentsPerMin: number } | null;
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
  const { t, tp, fmt, locale } = useT();
  const leg: 'pickup' | 'dropoff' = trip.status === 'IN_PROGRESS' ? 'dropoff' : 'pickup';
  const target = leg === 'dropoff' ? trip.dropoff : trip.pickup;
  const waitingAtPickup = trip.status === 'ARRIVED';

  const [route, setRoute] = useState<NavRoute | null>(null);
  const [routeState, setRouteState] = useState<'loading' | 'ok' | 'unavailable'>('loading');
  const [following, setFollowing] = useState(true);
  const [details, setDetails] = useState(false);
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
    say(leg === 'pickup' ? t('driver.navigation.arrivedPickup') : t('driver.navigation.arrivedDestination'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atTarget, leg, say]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);


  // ---- Map ----
  const heading = progress && progress.offRouteM < 30 ? progress.bearing : travelHeading ?? 0;
  const camPoint = progress && progress.offRouteM < 30 ? progress.snapped : pos;
  // Aim the camera ~110 m ahead so the car sits in the lower part of the map and the road ahead shows.
  const camCenter = camPoint ? offsetPoint(camPoint, heading, 110) : null;
  const follow = following && camCenter && !waitingAtPickup ? { lat: camCenter.lat, lng: camCenter.lng, heading, zoom: 17, tilt: 45 } : null;
  const markers: MapMarker[] = [];
  if (pos) markers.push({ id: 'me', lat: pos.lat, lng: pos.lng, kind: 'vehicle', label: t('driver.map.you') });
  markers.push(leg === 'dropoff'
    ? { id: 'dp', lat: trip.dropoff.lat, lng: trip.dropoff.lng, kind: 'dropoff', label: t('driver.map.destination') }
    : { id: 'pk', lat: trip.pickup.lat, lng: trip.pickup.lng, kind: 'pickup', label: t('driver.map.pickup') });
  const routeLine = useMemo(() => (route ? route.path.slice(Math.max(0, (progress?.seg ?? 0))).map(([la, ln]) => [ln, la] as [number, number]) : []), [route, progress?.seg]);
  const externalHref = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;

  // ---- Waiting timer at pickup ----
  let waitingNode: React.ReactNode = null;
  if (waitingAtPickup && trip.waiting) {
    const elapsed = Math.max(0, Math.floor((nowMs - new Date(trip.waiting.arrivedAt).getTime()) / 1000));
    const freeLeft = Math.max(0, trip.waiting.graceSeconds - elapsed);
    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    waitingNode = freeLeft > 0
      ? (() => { const [before, after] = t('driver.trip.freeWaitingLeft', { time: '\u0000' }).split('\u0000'); return <span>{before}<span className="font-mono text-accent">{mmss(freeLeft)}</span>{after}</span>; })()
      : <span className="text-warn">{trip.waiting.paidRateCentsPerMin > 0 ? t('driver.trip.freeWaitingElapsedPaid', { rate: fmt.money(trip.waiting.paidRateCentsPerMin) }) : t('driver.trip.freeWaitingElapsedFree')}</span>;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page" data-testid="driver-nav">
      {/* Manoeuvre banner */}
      <div className="relative z-10 bg-accent px-4 pb-3 text-[#10191C]" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }} aria-live="polite">
        {waitingAtPickup ? (
          <div><div className="text-lg font-bold">{t('driver.navigation.waitingFor', { name: trip.passengerName })}</div><div className="text-sm">{trip.pickup.label}</div></div>
        ) : atTarget ? (
          <div><div className="text-lg font-bold">{leg === 'pickup' ? t('driver.navigation.arrivedPickup') : t('driver.navigation.arrivedDestination')}</div><div className="text-sm">{target.label}</div></div>
        ) : !pos ? (
          <div className="text-base font-semibold">{t('driver.navigation.needGps')}</div>
        ) : routeState === 'unavailable' ? (
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{t('driver.navigation.unavailable')}</span><a href={externalHref} target="_blank" rel="noreferrer" className="shrink-0 rounded-[10px] bg-[#10191C] px-3 py-2 text-sm font-semibold text-accent">{t('driver.navigation.openExternal')}</a></div>
        ) : rerouting ? (
          <div className="text-lg font-bold">{t('driver.navigation.rerouting')}</div>
        ) : upcoming ? (
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none" aria-hidden>{maneuverIcon(upcoming.step.maneuver)}</span>
            <div className="min-w-0">
              <div className="text-2xl font-bold leading-tight">{distLabel(upcoming.inM)}</div>
              <div className="truncate text-sm font-medium" data-testid="nav-instruction">{upcoming.step.text}</div>
            </div>
          </div>
        ) : routeState === 'loading' ? (
          <div className="text-base font-semibold">{t('driver.navigation.loading')}</div>
        ) : (
          <div className="text-lg font-bold">{t('driver.navigation.continueTo', { place: target.label })}</div>
        )}
      </div>
      {props.banner && <button onClick={props.onDismissBanner} className="relative z-10 border-b border-warn/40 bg-warn/15 px-4 py-2 text-left text-sm text-warn">{props.banner}</button>}

      {/* Map */}
      <div className="relative min-h-0 flex-1">
        <AutoMapView markers={markers} route={routeLine} center={pos ?? target} zoom={15} interactive className="h-full w-full"
          follow={follow} onFollowBreak={() => setFollowing(false)} fitPadding={{ top: 60, right: 50, bottom: 60, left: 50 }} />
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          <button onClick={toggleMute} className="flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-page/90 text-lg" aria-label={muted ? t('driver.navigation.unmute') : t('driver.navigation.mute')} aria-pressed={muted}>{muted ? '🔇' : '🔊'}</button>
        </div>
        {!following && !waitingAtPickup && pos && (
          <button onClick={() => setFollowing(true)} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-accent bg-page/95 px-4 py-2 text-sm font-semibold text-accent">{t('driver.navigation.recenter')}</button>
        )}
      </div>

      {/* Bottom sheet */}
      <div className="relative z-10 max-h-[60vh] overflow-y-auto rounded-t-[18px] border-t border-edge bg-elevated px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        {!gps.active && (
          <div className="mb-3 rounded-[12px] border border-warn/40 bg-warn/10 p-3 text-sm">
            <div className="font-semibold text-warn">{t('driver.navigation.gpsOffTitle')}</div>
            {gps.error && gps.error !== 'acquiring' && <div className="mt-1 text-xs text-danger">{t(`driver.gps.${gps.error as 'denied' | 'unsupported'}`)}</div>}
            <button className="btn-primary mt-2 min-h-[44px] w-full" onClick={props.onStartGps}>{t('driver.gps.start')}</button>
          </div>
        )}

        {!waitingAtPickup && (
          <div className="flex items-baseline gap-3" data-testid="nav-summary">
            <span className="text-2xl font-bold text-accent">{remainingSec != null ? t('driver.navigation.min', { n: Math.max(1, Math.round(remainingSec / 60)) }) : '—'}</span>
            <span className="text-sm text-muted">{remainingM != null ? distLabel(remainingM) : ''}</span>
            {remainingSec != null && clock > 0 && <span className="ml-auto text-sm text-muted">{t('driver.navigation.arriveAt', { time: fmt.time(new Date(clock + remainingSec * 1000)) })}</span>}
          </div>
        )}
        <div className="mt-1 text-sm">
          <span className="text-muted">{leg === 'pickup' ? t('driver.navigation.toPickup') : t('driver.navigation.toDestination')}</span>{' '}
          <span className="font-medium">{target.label}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm">
          <span className="font-medium">{trip.passengerName}</span>
          <span className="text-muted">· {t('driver.units.paxShort', { count: trip.passengerCount })} · {trip.vClass}</span>
          <span className="ml-auto font-mono text-xs text-muted">{trip.reference}</span>
        </div>
        {waitingNode && <div className="mt-2 rounded-[12px] border border-edge bg-page p-3 text-sm">{waitingNode}</div>}

        {/* The one action for this stage */}
        <div className="mt-3 space-y-2">
          {trip.status === 'ASSIGNED' && <button className="btn-primary min-h-[52px] w-full text-base" onClick={() => props.onTripAction('status', { to: 'EN_ROUTE' })}>{t('driver.trip.onTheWay')}</button>}
          {trip.status === 'EN_ROUTE' && <button className="btn-primary min-h-[52px] w-full text-base" onClick={() => props.onTripAction('arrive', {})}>{t('driver.trip.arrived')}</button>}
          {trip.status === 'ARRIVED' && (
            <div className="flex gap-2">
              <input inputMode="numeric" maxLength={4} aria-label={t('driver.trip.startCodePlaceholder')} placeholder={t('driver.trip.startCodePlaceholder')} value={startCode} onChange={(e) => setStartCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className="min-w-0 flex-1 rounded-[12px] border border-edge bg-page px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em]" />
              <button className="btn-primary min-h-[52px] shrink-0 px-4" disabled={startCode.length !== 4} onClick={() => props.onTripAction('start', { code: startCode })}>{t('driver.trip.startTrip')}</button>
            </div>
          )}
          {trip.status === 'IN_PROGRESS' && <button className="btn-primary min-h-[52px] w-full text-base" onClick={() => setAsk('complete')}>{t('driver.trip.completeTrip')}</button>}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <a href={`tel:${trip.passengerPhone}`} className="btn-ghost !min-h-[44px] !py-2 text-sm">{t('driver.trip.call')}</a>
          <a href={externalHref} target="_blank" rel="noreferrer" className="btn-ghost !min-h-[44px] !py-2 text-sm">{t('driver.navigation.googleMaps')}</a>
          <button className="btn-ghost !min-h-[44px] !py-2 text-sm" onClick={() => setDetails((d) => !d)} aria-expanded={details}>{details ? t('driver.navigation.hideDetails') : t('driver.navigation.details')}</button>
        </div>
        <div className="mt-2"><ChatPanel key={trip.bookingId} listUrl={`/driver/bookings/${trip.bookingId}/messages`} postUrl={`/driver/bookings/${trip.bookingId}/messages`} pushUrl="/driver/push" me="DRIVER" peerLabel="passenger" /></div>

        {details && (
          <div className="mt-3 space-y-2 rounded-[12px] border border-edge bg-page p-3 text-sm" data-testid="nav-details">
            <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-accent" /><span className="text-muted">{t('driver.trip.pickup')}</span><span className="ml-auto text-right font-medium">{trip.pickup.label}</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-ink" /><span className="text-muted">{t('driver.trip.destination')}</span><span className="ml-auto text-right font-medium">{trip.dropoff.label}</span></div>
            <div>{t('driver.offer.passengerLine', { name: trip.passengerName, passengers: tp('common.passengers', trip.passengerCount), vClass: trip.vClass })}</div>
            {trip.note && <div className="text-xs text-warn">{t('driver.trip.note', { note: trip.note })}</div>}
            {trip.flightNumber && <div className="font-mono text-xs">✈ {t('driver.scheduled.flight', { flight: formatFlight(trip.flightNumber) })}</div>}
            <p className="text-xs text-muted">{t('driver.trip.navigateWarning')}</p>
            {['ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(trip.status) && <button className="btn-ghost min-h-[44px] w-full border border-danger/40 !text-danger" onClick={() => setAsk('release')}>{t('driver.trip.release')}</button>}
          </div>
        )}
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
  );
}
