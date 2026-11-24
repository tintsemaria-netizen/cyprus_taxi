'use client';

import { PASSENGER_GUEST } from '@/lib/features';
import { FixedTop } from '@/components/FixedTop';
import { useKeyboardViewport } from '@/components/useKeyboardViewport';
import { useHideClipped } from '@/components/useHideClipped';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { Logo } from '@/components/Brand';
import { BRAND_PIN_SVG, BRAND_PIN_SVG_RED } from '@/components/carMarker';
import { pinPoint } from '@/components/mapFit';
import { haversineMeters } from '@/lib/geo';
import { onCyprusIsland } from '@/lib/cyprus-island';
import { areaBlock, loadNoGo, territoryAt, territoryNear, spotLabel, allTerritories, dropTerritoryAt, dropLabel } from '@/lib/area-client';
import { InstallPrompt } from '@/components/InstallPrompt';
import type { Selected } from './PlacesInput';
import { setNearHint } from '@/lib/nearHint';
import SavedPlacesSheet, { type SavedMode, type SavedPlaces } from './SavedPlacesSheet';
import { RouteEditor, type RouteSlot } from './RouteEditor';
import AutoMapPicker from './AutoMapPicker';
import { PassengerLoginModal } from './PassengerLoginModal';
import { AccountMenu } from './AccountMenu';
import { recordVisit } from '@/lib/navTrail';
import { BackArrow } from '@/components/BackArrow';
import { nicosiaInputValue, nicosiaWallTimeToUtc } from '@/lib/timezone';
import { api, ApiRequestError, uuid } from '@/lib/api-client';
import { useT, MsgKey, translate } from '@/i18n/I18nProvider';
import { NotifyPrompt } from '@/components/NotifyPrompt';
import { RedBubble } from '@/components/RedBubble';
import { ShareBookingOptions, type ShareOpts } from '@/components/share/ShareBookingOptions';
import { isShareRoute, shareZone, sharedCents } from '@/lib/share';
import { useRefreshOnReturn } from '@/components/useRefreshOnReturn';

interface PublicConfig {
  demoMode: boolean;
  timezone: string;
  classes: { key: 'COMFORT' | 'XL'; label: string; maxPassengers: number }[];
  schedule: { minMinutes: number; maxDays: number; shareMinMinutes?: number; shareSlotMinutes?: number; shareTimeMode?: 'DEPART' | 'ARRIVE' };
  operatorName: string | null;
  share?: { discountPct: number; defaultMaxExtraMin: number; defaultWaitMin: number; termsVersion?: string; termsMaxExtraMin?: number; noShowFeeCents?: number };
}

const CLASS_META: Record<string, { seatsLabel: MsgKey; blurb: MsgKey }> = {
  COMFORT: { seatsLabel: 'booking.classes.COMFORT.seats', blurb: 'booking.classes.COMFORT.blurb' },
  XL: { seatsLabel: 'booking.classes.XL.seats', blurb: 'booking.classes.XL.blurb' },
};

// Render a translated sentence with one `{slot}` replaced by a React node (keeps styled
// values inside a single translatable string, since word order differs between languages).
function withSlot(template: string, slot: string, node: React.ReactNode): React.ReactNode {
  const [before, after = ''] = template.split(`{${slot}}`);
  return <>{before}{node}{after}</>;
}

const PEEK_PX = 170;

/** Zoom at which a ring is fully visible around point c (the pin stays in the middle): the map's visible part
 *  above the bottom sheet is about 60 % of the screen height. 512-px tiles (MapLibre; the Google view converts). */
function fitZoom(c: { lat: number; lng: number }, ring: [number, number][]): number {
  if (typeof window === 'undefined' || !ring.length) return 15;
  const k = Math.cos((c.lat * Math.PI) / 180);
  let dx = 1, dy = 1; // metres from the pin to the farthest edge
  for (const [la, ln] of ring) { dx = Math.max(dx, Math.abs(ln - c.lng) * 111320 * k); dy = Math.max(dy, Math.abs(la - c.lat) * 110540); }
  const halfW = window.innerWidth / 2 - 28, halfH = window.innerHeight * 0.3 - 30;
  const mpp = Math.max(dx / halfW, dy / halfH);
  return Math.log2((78271.5 * k) / mpp);
}

export default function BookingApp() {
  const kbBox = useKeyboardViewport(); // keep the header below the status bar while typing (iOS)
  const router = useRouter();
  const { t, tp, fmt, tError } = useT();
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [pickup, setPickup] = useState<Selected | null>(null);
  const [pickupText, setPickupText] = useState('');
  const [dropoff, setDropoff] = useState<Selected | null>(null);
  const [dropoffText, setDropoffText] = useState('');
  const [when, setWhen] = useState<'NOW' | 'SCHEDULE'>('NOW');
  // «Поехать с этим попутчиком» from the share board (2026-11-22): /?join=<rideId> opens the pre-booking with the
  // co-rider switched on and that ride's day / arrival window; after my ride is booked the proposal goes to them.
  const [join, setJoin] = useState<{ id: string; at: string; from: string; to: string; arrive: { from: string; by: string } | null } | null>(null);
  const [joinResult, setJoinResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  // «Быть на месте с … до …» (2026-11-22, operator): the passenger gives an ARRIVAL window; the
  // pickup time is worked out from the road time (+ a margin for traffic) and shown to them.
  // Pre-booking = «Быть на месте с … до …» only (2026-11-22, operator: no «Подача в / Быть на месте» tabs —
  // one window, like the ride-share box). The pickup is computed from the window.
  const [arriveMode, setArriveMode] = useState(true);
  // Plain pre-booking: «Во сколько подать машину?» — day + one time (Cyprus wall clock).
  const [pickDay, setPickDay] = useState('');
  const [pickT, setPickT] = useState('');
  const [arriveDay, setArriveDay] = useState('');
  const [arriveFromT, setArriveFromT] = useState('');
  const [arriveToT, setArriveToT] = useState('');
  // «Попутчик» departure hour (2026-11-24, operator): «13:00» → the car comes 13:00–13:15.
  const [departT, setDepartT] = useState('');
  // The order he chose to ride with in the hour list (its booking id) — proposed right after booking (2026-11-25).
  const [joinPick, setJoinPick] = useState<string | null>(null);
  const [arriveSlots, setArriveSlots] = useState<{ at: string; orders: { id: string; people: number; myArrive: string | null; why?: 'ROOM' | 'TIME' }[] }[] | null>(null);
  const [scheduleOffsetMin, setScheduleOffsetMin] = useState<number | undefined>(undefined);
  const [ambiguous, setAmbiguous] = useState<string[] | null>(null);
  const [vClass, setVClass] = useState<'COMFORT' | 'XL'>('COMFORT');
  const [shareOpts, setShareOpts] = useState<ShareOpts>({ on: false, adults: 1, children: 0, bags: 1, maxExtra: 15, wait: 15, early: 15 });
  const [pax, setPax] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'form' | 'review' | 'scheduled'>('form');
  // The booking panel floats over the map and can be collapsed to a slim bar (2026-11-14).
  const [collapsed, setCollapsed] = useState(false);
  const [peekPx, setPeekPx] = useState(PEEK_PX); // measured below (see contentRef)
  useEffect(() => { if (step !== 'form') setCollapsed(false); }, [step]);
  // After a pre-booking (2026-11-13) the passenger stays here and can order again right away.
  const [doneAt, setDoneAt] = useState<string | null>(null);
  // Pre-booking reminder on the home page (2026-11-13): the signed-in passenger's next scheduled
  // ride when its pickup is within the hour (the same moment a push reminder is sent).
  const [soonRide, setSoonRide] = useState<{ id: string; at: string; pickup: string; dropoff: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  // One-time notice handed over by another page (e.g. "Your account has been deleted").
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    try { const f = sessionStorage.getItem('il-y-flash'); if (f) { setFlash(f); sessionStorage.removeItem('il-y-flash'); } } catch { /* storage blocked */ }
  }, []);
  // «Заказать ещё раз» from a canceled ride (2026-11-16): the tracking page leaves the same route +
  // class in sessionStorage; prefill it here and go straight to the class/order step once priced.
  const repeatPending = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('il-y-repeat'); if (!raw) return;
      sessionStorage.removeItem('il-y-repeat');
      const r = JSON.parse(raw) as { p: Selected; d: Selected; s?: Selected | null; c?: 'COMFORT' | 'XL' };
      if (!r?.p || !r?.d) return;
      setPickup(r.p); setPickupText(r.p.label); setDropoff(r.d); setDropoffText(r.d.label);
      if (r.s) { setStop(r.s); setStopText(r.s.label); setHasStop(true); }
      if (r.c === 'XL' || r.c === 'COMFORT') setVClass(r.c);
      repeatPending.current = true;
    } catch { /* storage blocked / bad data: normal empty form */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<'pickup' | 'dropoff' | 'stop' | null>(null);
  // One optional stop + the address list UX (2026-11-15).
  const [stop, setStop] = useState<Selected | null>(null);
  const [stopText, setStopText] = useState('');
  const [hasStop, setHasStop] = useState(false);
  const [addrOpen, setAddrOpen] = useState(false); // «Откуда» shown once «Куда» is touched
  const addrOpenState = addrOpen;
  // Full-screen route editor (2026-11-15): tapping an address field opens it. A hidden proxy input
  // is focused synchronously inside the tap so iOS opens the keyboard and keeps it while focus
  // moves to the editor's field.
  const [editor, setEditor] = useState<RouteSlot | null>(null);
  const proxyRef = useRef<HTMLInputElement | null>(null);
  function openEditor(slot: RouteSlot) {
    proxyRef.current?.focus({ preventScroll: true });
    setAddrOpen(true);
    setEditor(slot);
  }
  useEffect(() => { if (dropoff || stop || hasStop) setAddrOpen(true); }, [dropoff, stop, hasStop]);
  // Start screen = one «Куда» row; both rows only once an address is chosen. Closing the route
  // editor without choosing anything goes back to the single row (2026-11-17).
  useEffect(() => { if (!editor && !dropoff && !stop && !hasStop && !dropoffText) setAddrOpen(false); }, [editor, dropoff, stop, hasStop, dropoffText]);
  type Slot = 'p' | 's' | 'd';
  const slots: Slot[] = hasStop ? ['p', 's', 'd'] : ['p', 'd'];
  function slotGet(s: Slot) {
    if (s === 'p') return { sel: pickup, text: pickupText, setSel: setPickup, setText: setPickupText };
    if (s === 's') return { sel: stop, text: stopText, setSel: setStop, setText: setStopText };
    return { sel: dropoff, text: dropoffText, setSel: setDropoff, setText: setDropoffText };
  }
  // Drag a row by its ≡ handle to reorder the route: the values move, the roles stay by position
  // (first = from, middle = stop, last = to).
  const rowEls = useRef<(HTMLDivElement | null)[]>([]);
  const [rowDrag, setRowDrag] = useState<{ index: number; startY: number; dy: number; mids: number[] } | null>(null);
  // × in the top-right corner: back to the initial state — only «Куда», pickup = auto location.
  // Leave the pre-booking window (2026-11-20): the ✕ at its top-right — back to «now» and the start screen.
  function exitSchedule() {
    setArriveFromT(''); setArriveToT('');
    setJoin(null);
    setWhen('NOW'); setScheduledAt(''); setScheduleOffsetMin(undefined); setAmbiguous(null); setNote('');
    resetRoute();
    if (isMobile) setCollapsed(true); // the small start sheet, as before «Запланировать»
  }
  function resetRoute() {
    setDropoff(null); setDropoffText('');
    setStop(null); setStopText(''); setHasStop(false);
    const saved = autoPickupSaved.current;
    if (saved) { setPickup(saved.sel); setPickupText(saved.text); setAutoPickup(true); }
    else { setPickup(null); setPickupText(''); setAutoPickup(false); }
    setErrors({});
    setAddrOpen(false);
  }
  function onDragStart(e: React.PointerEvent, index: number) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const mids = slots.map((_, i) => { const r = rowEls.current[i]?.getBoundingClientRect(); return r ? r.top + r.height / 2 : 0; });
    setRowDrag({ index, startY: e.clientY, dy: 0, mids });
  }
  function onDragMove(e: React.PointerEvent) {
    setRowDrag((d) => (d ? { ...d, dy: e.clientY - d.startY } : d));
  }
  function onDragEnd() {
    const d = rowDrag;
    setRowDrag(null);
    if (!d || Math.abs(d.dy) < 8) return;
    const y = d.mids[d.index] + d.dy;
    let to = 0;
    d.mids.forEach((m, i) => { if (Math.abs(m - y) < Math.abs(d.mids[to] - y)) to = i; });
    reorderRoute(d.index, to);
  }
  // Move the point at `from` to position `to` (values move, roles stay by position).
  function reorderRoute(from: number, to: number) {
    if (from === to) return;
    const vals = slots.map((s) => { const v = slotGet(s); return { sel: v.sel, text: v.text }; });
    const [moved] = vals.splice(from, 1);
    vals.splice(to, 0, moved);
    slots.forEach((s, i) => { const v = slotGet(s); v.setSel(vals[i].sel); v.setText(vals[i].text); });
    setAutoPickup(false);
  }
  // Two points: ⇅ swaps start and destination (2026-11-15). With a stop the rows are dragged by ≡.
  function swapRoute() {
    const a = { sel: pickup, text: pickupText }, b = { sel: dropoff, text: dropoffText };
    setPickup(b.sel); setPickupText(b.text); setDropoff(a.sel); setDropoffText(a.text); setAutoPickup(false);
  }
  // Passenger's detected location (for centring the map + defaulting the pickup).
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  // Address search ranks places near the passenger first (2026-11-18).
  useEffect(() => { setNearHint(myLoc ?? pickup); }, [myLoc, pickup]);
  // «My location» button (2026-11-17): appears once the passenger drags the map away.
  const [mapMoved, setMapMoved] = useState(false);
  const [recenterTick, setRecenterTick] = useState(0);
  const [autoPickup, setAutoPickup] = useState(false); // pickup was auto-set from geolocation
  // The auto-detected pickup, kept so the × reset can restore it (2026-11-15).
  const autoPickupSaved = useRef<{ sel: Selected; text: string } | null>(null);
  // Task 014: passenger account + mandatory login before booking + destination history.
  const [passenger, setPassenger] = useState<{ phone: string | null; name?: string; email?: string | null; guest?: boolean } | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [destinations, setDestinations] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [places, setPlaces] = useState<SavedPlaces>({ home: null, work: null, school: null, custom: [] });
  // Saved places sheet (2026-11-18): set Home/Work from the start screen; «Ещё» = the passenger's own places.
  const [savedSheet, setSavedSheet] = useState<SavedMode | null>(null);
  const reloadPlaces = useCallback(() => { api<SavedPlaces>('/passenger/places').then(setPlaces).catch(() => {}); }, []);
  // Hold a set Home/Work pill to change it (a tap rides there).
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const holdProps = (kind: 'HOME' | 'WORK') => ({
    onPointerDown: () => { held.current = false; if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = setTimeout(() => { held.current = true; navigator.vibrate?.(15); setSavedSheet({ type: 'set', kind }); }, 550); },
    onPointerUp: () => { if (holdTimer.current) clearTimeout(holdTimer.current); },
    onPointerLeave: () => { if (holdTimer.current) clearTimeout(holdTimer.current); },
    onPointerCancel: () => { if (holdTimer.current) clearTimeout(holdTimer.current); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const pendingSubmit = useRef<number | undefined>(undefined);
  const pendingSubmitActive = useRef(false);
  const pendingReview = useRef(false);

  // Live mirrors so the async geolocation callback never overwrites a pickup the
  // passenger has already started choosing (typed text or picked a point).
  const pickupRef = useRef<Selected | null>(pickup);
  pickupRef.current = pickup;
  const pickupTextRef = useRef<string>(pickupText);
  pickupTextRef.current = pickupText;

  // Idempotency key persists across retries of the SAME payload; it is only
  // regenerated when the meaningful payload changes (SPEC §3.7).
  const idemKey = useRef<string>('');
  const idemPayloadSig = useRef<string>('');

  const [cfgError, setCfgError] = useState(false);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [scheduleTick, setScheduleTick] = useState(0);

  const loadConfig = useCallback(() => {
    setCfgLoading(true);
    setCfgError(false);
    api<PublicConfig>('/public/config', { timeoutMs: 8000 })
      .then((c) => { setCfg(c); setCfgError(false); })
      .catch(() => setCfgError(true))
      .finally(() => setCfgLoading(false));
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  // Home is the first step of the in-app back trail (src/lib/navTrail.ts).
  useEffect(() => {
    recordVisit();
    const onShow = () => recordVisit();
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  // Restore passenger session (if any) → prefill contact + load destination history.
  const loadPassenger = useCallback(() => {
    api<{ phone: string | null; name?: string; email?: string | null; guest?: boolean }>('/passenger/me')
      .then((p) => {
        setPassenger(p);
        setPhone((cur) => cur || p.phone || '');
        if (p.name) setName((cur) => cur || p.name!);
        api<{ destinations: { label: string; lat: number; lng: number }[] }>('/passenger/destinations').then((d) => setDestinations(d.destinations)).catch(() => {});
        api<SavedPlaces>('/passenger/places').then(setPlaces).catch(() => {});
      })
      .catch(() => { setPassenger(null); setPlaces({ home: null, work: null, custom: [] }); });
  }, []);
  useEffect(() => { loadPassenger(); }, [loadPassenger]);

  // Reopening the app during a ride goes straight back to that ride (2026-11-17). Once per app
  // launch only (sessionStorage is cleared when the app is fully closed), so going to the home
  // screen on purpose from the tracking screen still works.
  const [resuming, setResuming] = useState(false);
  useEffect(() => {
    if (!passenger) return;
    try { if (sessionStorage.getItem('il-y-resume-checked')) return; sessionStorage.setItem('il-y-resume-checked', '1'); } catch { return; }
    api<{ ride: { id: string } | null }>('/passenger/active').then(async (r) => {
      if (!r.ride) return;
      setResuming(true);
      try {
        const g = await api<{ token: string }>(`/passenger/rides/${r.ride.id}/track`, { method: 'POST' });
        await api('/tracking/exchange', { method: 'POST', body: { token: g.token } });
        router.replace('/track');
      } catch { setResuming(false); }
    }).catch(() => { /* stay on the home screen */ });
  }, [passenger, router]);

  // On first load, detect the passenger's position: centre the map on it and default the
  // pickup there (reverse-geocoded label). Never overwrite a pickup the passenger has
  // already started choosing — they can still change it via the map or the address box.
  //
  // 2026-11-21 (operator): an installed app on a phone is usually RESUMED, not reloaded — the old
  // position stayed on the map after driving 80 km. So it is detected again whenever the app comes
  // back to the screen after more than a minute away, and an auto-set pickup the passenger has not
  // touched (no destination yet) moves to the new position.
  const dropoffRef = useRef<Selected | null>(dropoff); dropoffRef.current = dropoff;
  const autoPickupRef = useRef(autoPickup); autoPickupRef.current = autoPickup;
  const [locateTick, setLocateTick] = useState(0);
  useRefreshOnReturn(() => setLocateTick((n) => n + 1), 60_000);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    const again = locateTick > 0;
    // The untouched auto pickup may be replaced; anything the passenger chose or typed is kept.
    const untouched = () => !dropoffRef.current && autoPickupRef.current && !!autoPickupSaved.current
      && pickupRef.current?.lat === autoPickupSaved.current.sel.lat && pickupRef.current?.lng === autoPickupSaved.current.sel.lng;
    // 2026-11-24 22:39 (operator): came back to the app at the marina, the logo still stood at Paphos airport. A
    // pickup the passenger set himself also moves to where he is now when he is far from it (> 500 m) and no
    // destination is chosen yet — that pickup was for a place he has left.
    const replaceable = (pos: { lat: number; lng: number }) => untouched()
      || (!dropoffRef.current && !!pickupRef.current && haversineMeters(pickupRef.current, pos) > 500);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        // Abroad / at sea (2026-11-24): no «my location» on the map and no pickup there — the island view stays.
        if (!onCyprusIsland({ lat, lng })) return;
        setMyLoc({ lat, lng });
        if (again && !replaceable({ lat, lng })) return;
        if (!again && (pickupRef.current || pickupTextRef.current.trim() !== '')) return; // passenger already acting
        // The stored label travels with the booking to the driver → language-neutral English; the
        // passenger sees their own language in the field.
        let label: string | null = null;
        try {
          const r = await api<{ place: { label: string } | null }>(`/places/reverse?lat=${lat}&lng=${lng}`, { timeoutMs: 6000 });
          if (r.place?.label) label = r.place.label;
        } catch { /* keep the generic label */ }
        if (cancelled || (again ? !replaceable({ lat, lng }) : (pickupRef.current || pickupTextRef.current.trim() !== ''))) return; // re-check after await
        setPickup({ lat, lng, label: label ?? translate('en', 'booking.currentLocation') });
        setPickupText(label ?? t('booking.currentLocation'));
        setAutoPickup(true);
        autoPickupSaved.current = { sel: { lat, lng, label: label ?? translate('en', 'booking.currentLocation') }, text: label ?? t('booking.currentLocation') };
      },
      () => { /* denied / unavailable → keep the island view + manual selection */ },
      // On return: a fresh fix (maximumAge 0) — a cached one is exactly the old place.
      again ? { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } : { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateTick]);

  // Keep the schedule minimum fresh (in Cyprus wall time) while scheduling is open.
  useEffect(() => {
    if (when !== 'SCHEDULE') return;
    const t = setInterval(() => setScheduleTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [when]);

  // Fit the overview map into the VISIBLE area (clear of the bottom sheet on mobile /
  // the left panel on desktop) so it never frames empty sea behind the form.
  const [vp, setVp] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const upd = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    upd();
    window.addEventListener('resize', upd);
    window.addEventListener('orientationchange', upd);
    return () => { window.removeEventListener('resize', upd); window.removeEventListener('orientationchange', upd); };
  }, []);
  // The map is always the page background (2026-11-14); the booking panel floats over it.
  // Live on-duty cars shown on the booking map (anonymized positions), polled while it is shown.
  const [fleet, setFleet] = useState<{ lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' }[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ vehicles: { lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' }[] }>('/public/fleet', { timeoutMs: 8000 })
        .then((r) => { if (alive) setFleet(r.vehicles); })
        .catch(() => { /* keep last known; transient */ });
    };
    load();
    const t = setInterval(load, 12000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Review step on mobile (2026-11-16): the sheet is only as tall as its content (class cards +
  // order button), and the route is framed in the map above it — measured, not guessed.
  const [reviewH, setReviewH] = useState(0);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || step !== 'review') { setReviewH(0); return; }
    const ro = new ResizeObserver(() => setReviewH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);
  const fitPadding = useMemo(
    () => (vp.w < 640 && step === 'review' && reviewH
      ? { top: 24, right: 32, bottom: reviewH + 24, left: 32 }
      : vp.w < 640
      // Mobile: the booking sheet covers most of the screen, so fit the island into
      // the small visible band at the top (large bottom padding).
      ? { top: 16, right: 24, bottom: collapsed ? peekPx + 24 : Math.round(vp.h * 0.62), left: 24 }
      : collapsed ? { top: 110, right: 60, bottom: 40, left: 40 } : { top: 40, right: 60, bottom: 40, left: 420 }),
    [vp, collapsed, peekPx, step, reviewH],
  );

  // Mobile bottom sheet drag (2026-11-14): full screen when open, a strip stays when collapsed.
  const isMobile = vp.w < 640;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetBoxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ y: number; h: number; max: number; moved: boolean } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  function onSheetDown(e: React.PointerEvent<HTMLDivElement>) {
    const h = sheetRef.current?.getBoundingClientRect().height ?? peekPx;
    const max = sheetBoxRef.current?.getBoundingClientRect().height ?? vp.h;
    drag.current = { y: e.clientY, h, max, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onSheetMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setDragH(Math.min(d.max, Math.max(peekPx * 0.7, d.h - dy)));
  }
  function onSheetUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) setCollapsed((c) => !c); // a tap on the handle toggles
    else {
      const h = d.h - (e.clientY - d.y);
      const goingUp = e.clientY < d.y;
      // Snap in the direction of the swipe once it passes a small threshold.
      setCollapsed(goingUp ? h < peekPx + 40 : h < d.max - 40);
    }
    setDragH(null);
  }
  // Swipe on the sheet body too (2026-11-14), not only the handle: collapsed → any vertical swipe
  // moves the sheet; expanded → a downward pull while the form is scrolled to the top collapses it,
  // otherwise the form scrolls normally. Native listeners: preventDefault needs passive: false.
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Collapsed peek height = up to the bottom of the «Куда» field + a margin, measured (2026-11-15):
  // a fixed 170 px cut the field off on phones without a bottom safe area, and the half-visible
  // field was then hidden entirely (useHideClipped) — the passenger could not tap it.
  // With a complete route (2026-11-15) the collapsed sheet shows the route box (both addresses)
  // and the order button with the price instead of «Куда едем?» — measured the same way.
  const routeReady = !!pickup && !!dropoff;
  const peekRoute = isMobile && collapsed && routeReady && step === 'form';
  const peekSched = peekRoute && when === 'SCHEDULE';
  const footerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = contentRef.current, sheet = sheetRef.current;
    if (!isMobile || !box || !sheet) return;
    const measure = () => {
      if (box.scrollTop > 0) return;
      let h: number;
      const routeBox = routeReady ? (box.querySelector('[data-route-box]') as HTMLElement | null) : null;
      if (routeBox) {
        const padTop = parseFloat(getComputedStyle(box).paddingTop) || 0;
        const f = footerRef.current;
        const footer = f ? f.offsetHeight - (parseFloat(getComputedStyle(f).paddingBottom) || 0) + 12 : 76;
        // To the box's real bottom (2026-11-24): in a pre-booking the «Запланировать» heading sits above it, and
        // «top + height» cut the box off — useHideClipped then hid it and only the ⇅ arrow was left.
        void padTop;
        h = Math.round(routeBox.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top + 14 + footer);
      } else {
        // No full route yet (2026-11-17): the whole address box must show — one «Куда» row at the
        // start, both rows once an address is being entered (was: only the first input → rows cut).
        const addr = (box.querySelector('[data-route-box]') ?? box.querySelector('input[readonly][aria-label]')) as HTMLElement | null;
        if (!addr) return;
        // …plus the quick picks under it (saved places + last trips, 2026-11-17).
        const qp = box.querySelector('[data-testid="quick-picks"]') as HTMLElement | null;
        const bottom = Math.max(addr.getBoundingClientRect().bottom, qp ? qp.getBoundingClientRect().bottom : 0);
        h = Math.round(bottom - sheet.getBoundingClientRect().top + 8);
      }
      const next = Math.max(110, Math.min(Math.round(window.innerHeight * 0.6), h));
      setPeekPx((p) => (Math.abs(p - next) > 2 ? next : p));
    };
    measure();
    const first = box.firstElementChild;
    const ro = new ResizeObserver(measure);
    if (first) ro.observe(first);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [isMobile, step, routeReady, addrOpen, hasStop, destinations.length, places, passenger]);
  useHideClipped(contentRef, isMobile && (collapsed || dragH != null));
  useEffect(() => {
    const el = contentRef.current;
    if (!isMobile || !el) return;
    let s: { y: number; h: number; max: number; mode: 'drag' | 'scroll' | null } | null = null;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { s = null; return; }
      s = { y: e.touches[0].clientY, h: sheetRef.current?.getBoundingClientRect().height ?? peekPx, max: sheetBoxRef.current?.getBoundingClientRect().height ?? window.innerHeight, mode: null };
    };
    const onMove = (e: TouchEvent) => {
      if (!s) return;
      const dy = e.touches[0].clientY - s.y;
      if (s.mode === null) {
        if (Math.abs(dy) < 8) return;
        s.mode = collapsed || (dy > 0 && el.scrollTop <= 0) ? 'drag' : 'scroll';
        s.y = e.touches[0].clientY - Math.sign(dy) * 8;
      }
      if (s.mode !== 'drag') return;
      e.preventDefault();
      const d = e.touches[0].clientY - s.y;
      setDragH(Math.min(s.max, Math.max(peekPx * 0.7, s.h - d)));
    };
    const onEnd = (e: TouchEvent) => {
      const cur = s;
      s = null;
      if (!cur || cur.mode !== 'drag') return;
      const y = e.changedTouches[0]?.clientY ?? cur.y;
      const h = cur.h - (y - cur.y);
      setCollapsed(y < cur.y ? h < peekPx + 40 : h < cur.max - 40);
      setDragH(null);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [isMobile, collapsed, step]);
  // Phones open with the sheet collapsed so the map is visible; tablets/desktop keep the panel open.
  useEffect(() => { if (window.innerWidth < 640) setCollapsed(true); }, []);

  // Where the map camera centres before a route is shown: the pickup (or the detected position), at
  // street zoom. A pickup made by moving the map keeps the zoom the passenger chose, so a later
  // re-centre (the sheet opening) stays put instead of jumping back or zooming.
  const [noGoReady, setNoGoReady] = useState(0);
  useEffect(() => { void loadNoGo().then(() => setNoGoReady((n) => n + 1)); }, []);
  // Landing on a point (2026-11-24 21:46, operator): at once, smoothly, and 50 % closer than the zoom it was at.
  // Landing on a point always ends at the same close zoom (2026-11-24 22:11, operator's screenshot), whatever
  // the zoom before.
  const SPOT_ZOOM = 19;
  const SPOT_GLIDE_MS = 1500; // 2026-11-24 22:26, operator: «слишком быстро приближает»
  // On a territory's pickup point (2026-11-24 20:45, operator) the logo is a MAP MARKER standing in the point's
  // silhouette (exactly — the centre overlay was ~20 px off on Google), and zooming happens where the fingers
  // are, not around the logo: a zoom gesture does not move the pickup. Only a pan re-picks the map centre.
  const zoomRef = useRef<number | null>(null);
  // Zoom for the current point: landing zooms in 50 % (2026-11-24, operator); switching points keeps it.
  const spotZoom = useRef<number | null>(null);
  const landedKey = useRef<string | null>(null);
  const [landing, setLanding] = useState(false);
  const landTimer = useRef<number | null>(null);
  // Landing on a point (2026-11-24 21:46, operator: at once, no jerks, 50 % closer): the logo stays in the
  // middle while the camera glides the point under it and zooms in there; when the glide ends the logo becomes a
  // map marker standing in the point's silhouette (so zooming afterwards happens where the fingers are).
  const slidePin = (_from: { lat: number; lng: number }, to: { lat: number; lng: number }, zoom: number) => {
    landedKey.current = `${to.lat},${to.lng}`;
    setCamFocus({ lat: to.lat, lng: to.lng }); setCamZoom(zoom); zoomRef.current = zoom;
    setRecenterTick((n) => n + 1);
    setLanding(true);
    if (landTimer.current) window.clearTimeout(landTimer.current);
    // The logo turns into the map marker only when the map says the glide reached the point (a timer alone ran
    // out before a slow phone's glide ended → the jerk the operator saw); the timer is only a fallback.
    landTimer.current = window.setTimeout(() => setLanding(false), SPOT_GLIDE_MS + 1500);
  };

  const HOME_ZOOM = 15.49; // 2026-11-17: 30 % further out than 16 (16 + log2 0.7)
  const dragPick = useRef<{ lat: number; lng: number } | null>(null);
  const [camFocus, setCamFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [camZoom, setCamZoom] = useState(HOME_ZOOM);
  useEffect(() => {
    const p = pickup ?? myLoc;
    if (!p) return;
    if (pickup && dragPick.current && dragPick.current.lat === pickup.lat && dragPick.current.lng === pickup.lng) return;
    // On a pickup point of a territory (airport, port …): ONE point — the logo jumps onto it and the map zooms in
    // (operator 2026-11-24 20:08); SEVERAL — zoom out so the whole rounded territory stays on screen around the
    // chosen point, so switching points does not lose it.
    const tz = pickup ? territoryAt(pickup) : null;
    if (pickup && tz && tz.on >= 0 && centerModeRef.current) {
      // Landing on a point (2026-11-24 21:46, operator): at once and smoothly the camera brings the point under
      // the logo and zooms in 50 % there, while the logo marker slides with the SAME timing and easing — so on the
      // screen it stays where the finger left it and ends exactly in the silhouette. Once per landing: re-runs of
      // this effect (a new GPS fix, the zones loading) must not zoom in again.
      const key = `${pickup.lat},${pickup.lng}`;
      if (landedKey.current !== key) {
        landedKey.current = key;
        const z = spotZoom.current ?? SPOT_ZOOM;
        spotZoom.current = null;
        setCamFocus({ lat: pickup.lat, lng: pickup.lng }); setCamZoom(z); zoomRef.current = z;
        setRecenterTick((n) => n + 1); // glide, not a jump
        setLanding(true);
        if (landTimer.current) window.clearTimeout(landTimer.current);
        landTimer.current = window.setTimeout(() => setLanding(false), SPOT_GLIDE_MS + 1500);
      }
      return;
    }
    landedKey.current = null; spotZoom.current = null;
    setCamFocus({ lat: p.lat, lng: p.lng }); setCamZoom(HOME_ZOOM); zoomRef.current = HOME_ZOOM;
  }, [pickup?.lat, pickup?.lng, myLoc?.lat, myLoc?.lng, noGoReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pinLift, setPinLift] = useState(false);
  const pickSeq = useRef(0);
  async function pickAt(lat: number, lng: number, fromDrag: boolean) {
    const seq = ++pickSeq.current;
    dragPick.current = fromDrag ? { lat, lng } : null;
    setPickup({ lat, lng, label: translate('en', 'booking.currentLocation') }); setPickupText('…'); setAutoPickup(false);
    let label: string | null = null;
    try { const r = await api<{ place: { label: string } | null }>(`/places/reverse?lat=${lat}&lng=${lng}`, { timeoutMs: 6000 }); label = r.place?.label ?? null; } catch { /* generic label */ }
    if (seq !== pickSeq.current) return; // the map was moved again meanwhile
    setPickup({ lat, lng, label: label ?? translate('en', 'booking.currentLocation') });
    setPickupText(label ?? t('booking.currentLocation'));
  }
  // The pin let go in the sea / abroad (2026-11-24, operator): no pickup there — the logo turns red while
  // the map glides back to the last pickup, then lime again. No text (operator: «убери надпись»).
  const [offIsland, setOffIsland] = useState(false);
  // Pickup territories (2026-11-24, operator: airports, ports …): a pickup inside goes to the nearest of the
  // territory's points; the passenger may pick another one. The rounded territory and its points are on the map.
  const terr = useMemo(() => (pickup ? territoryAt(pickup) : null), [pickup?.lat, pickup?.lng, noGoReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseSpot = (i: number, zoomIn = true) => {
    if (!terr) return;
    const sp = terr.t.points[i], label = spotLabel(terr.t, i);
    const start = pickupRef.current;
    if (start && centerModeRef.current) slidePin(start, sp, zoomIn ? SPOT_ZOOM : (zoomRef.current ?? SPOT_ZOOM));
    pickSeq.current++; // a reverse-geocode still running must not overwrite the point's name
    dragPick.current = null;
    setPickup({ lat: sp.lat, lng: sp.lng, label });
    setPickupText(label);
  };
  useEffect(() => {
    if (terr && terr.on < 0) chooseSpot(terr.nearest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terr]);
  // Drop-off points (2026-11-24, operator): a destination inside a territory that has them goes to the nearest
  // one; the passenger may choose another with the chips. The server snaps the same way.
  const dropTerr = useMemo(() => (dropoff ? dropTerritoryAt(dropoff) : null), [dropoff?.lat, dropoff?.lng, noGoReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseDrop = (i: number) => {
    if (!dropTerr) return;
    const sp = (dropTerr.t.dropPoints ?? [])[i]; if (!sp) return;
    const label = dropLabel(dropTerr.t, i);
    setDropoff({ lat: sp.lat, lng: sp.lng, label }); setDropoffText(label);
  };
  useEffect(() => {
    if (dropTerr && dropTerr.on < 0) chooseDrop(dropTerr.nearest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropTerr]);
  const offTimer = useRef<number | null>(null);
  function onCenterPick(p: { lat: number; lng: number; zoom: number }) {
    setPinLift(false);
    if (!centerModeRef.current) return;
    const zoomed = zoomRef.current != null && Math.abs(p.zoom - zoomRef.current) > 0.05;
    zoomRef.current = p.zoom;
    // A logo let go on / next to a pickup territory goes to its point — checked BEFORE the sea check: at island
    // zoom the airport's circle touches the sea and a drop on it was treated as «in the sea» (2026-11-24 22:49).
    // «Next to»: 30 px on the screen, at most 1.5 km.
    const mpp = (156543 * Math.cos((p.lat * Math.PI) / 180)) / 2 ** p.zoom;
    const tz = territoryNear(p, Math.min(1500, 30 * mpp));
    // Zooming while on a point only looks around — as long as the middle stays on that territory.
    if (zoomed && onSpotRef.current && tz && terrRef.current && tz.t === terrRef.current.t) return;
    if (!tz && areaBlock(p)) { // off the island or in a «Запретная зона» (2026-11-24)
      setOffIsland(true);
      // A short buzz with the red, shaking logo (operator 2026-11-24). Android browsers vibrate; iPhone
      // Safari has no vibration for web pages — there only the logo shakes (the native app can buzz later).
      try { navigator.vibrate?.([70, 50, 70]); } catch { /* not supported */ }
      if (offTimer.current) window.clearTimeout(offTimer.current);
      offTimer.current = window.setTimeout(() => setOffIsland(false), 1100);
      setRecenterTick((n) => n + 1);
      return;
    }
    setOffIsland(false);
    if (tz) { // let go inside a pickup territory: the logo slides straight to the nearest point
      const i = tz.nearest, sp = tz.t.points[i], label = spotLabel(tz.t, i);
      slidePin(p, sp, SPOT_ZOOM);
      pickSeq.current++; dragPick.current = null;
      setPickup({ lat: sp.lat, lng: sp.lng, label }); setPickupText(label); setAutoPickup(false);
      return;
    }
    const cur = pickupRef.current;
    if (cur && Math.abs(cur.lat - p.lat) < 0.00003 && Math.abs(cur.lng - p.lng) < 0.00003) return; // ~3 m: not moved
    setCamFocus({ lat: p.lat, lng: p.lng }); setCamZoom(p.zoom);
    void pickAt(p.lat, p.lng, true);
  }
  // The logo must stay on the pickup (2026-11-24, operator: «закрыл приложение, вернулся — логотип ушёл наверх»):
  // after the app comes back, and when the sheet opens/closes (the logo moves to the middle of the visible map),
  // the camera re-centres on the pickup once the layout has settled.
  const recenterSoon = useRef<number | null>(null);
  const recenterOnPickup = () => {
    if (recenterSoon.current) window.clearTimeout(recenterSoon.current);
    recenterSoon.current = window.setTimeout(() => { if (centerModeRef.current && pickupRef.current) setRecenterTick((n) => n + 1); }, 350);
  };
  useRefreshOnReturn(recenterOnPickup, 0);
  const padSig = `${fitPadding.top},${fitPadding.bottom},${fitPadding.left},${fitPadding.right}`;
  useEffect(() => { recenterOnPickup(); }, [padSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // Centre pin (2026-11-23, operator): on the home screen (no destination yet) the IL-Y logo stays in the
  // middle of the map and the map moves under it; where the finger lets go is the pickup.
  const centerMode = step === 'form' && !dropoff && !picker && !!(pickup || myLoc);
  const onSpot = centerMode && !!terr && terr.on >= 0;
  const onSpotRef = useRef(onSpot); onSpotRef.current = onSpot;
  const terrRef = useRef(terr); terrRef.current = terr;
  // The overlay stays 300 ms after the landing: the map marker takes a moment to appear and the logo must not
  // blink out in between (both stand on the same pixel).
  const [landTail, setLandTail] = useState(false);
  useEffect(() => { if (landing) return; setLandTail(true); const id = window.setTimeout(() => setLandTail(false), 300); return () => window.clearTimeout(id); }, [landing]);
  const pinOverlay = centerMode && (!onSpot || landing || landTail);
  // No «you are here» person on the passenger's maps (2026-11-17): only the IL-Y pickup logo.
  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (pickup && (!centerMode || (onSpot && !landing))) m.push({ id: 'p', lat: pickup.lat, lng: pickup.lng, kind: 'pickup', label: pickup.label, ...(onSpot ? { noFit: true } : {}) });
    if (stop && hasStop) m.push({ id: 's', lat: stop.lat, lng: stop.lng, kind: 'stop', label: stop.label });
    if (dropoff) m.push({ id: 'd', lat: dropoff.lat, lng: dropoff.lng, kind: 'dropoff', label: dropoff.label });
    return m;
  }, [pickup, dropoff, stop, hasStop, centerMode, onSpot, landing]);
  // Every pickup territory is on the passenger map all the time (2026-11-24, operator), with its points as
  // silhouettes; the chosen one carries its name.
  const terrList = useMemo(() => allTerritories(), [noGoReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // The faint point logos only while the pickup is being chosen; once a route is shown they are not needed
  // (2026-11-24 23:18, operator). The territory outline stays.
  const showSpots = !dropoff;
  const mapMarkers = useMemo<MapMarker[]>(() => [
    ...markers,
    ...(!showSpots ? [] : terrList).flatMap((t, ti) => t.points.map((sp, i) => {
      const active = !!terr && terr.t === t && terr.on === i;
      return { id: `spot-${ti}-${i}`, lat: sp.lat, lng: sp.lng, kind: 'spot' as const, label: active ? sp.name || t.name : '', active, noFit: true };
    })),
  ], [markers, terr, terrList, showSpots]);
  const mapAreas = useMemo(() => terrList.map((t, ti) => ({ id: `terr-${ti}-${t.name}`, polygon: t.polygon, color: '#4C9AFF' })), [terrList]);
  const centerModeRef = useRef(centerMode); centerModeRef.current = centerMode;
  // The pin overlay stands on the same point a padded focus centres on.
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const [mapBox, setMapBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = mapBoxRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setMapBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // The stop counts only once it has been chosen (an empty stop row is ignored).
  const viaStop = hasStop && stop ? stop : null;
  // Ride-share «Попутчик» (Task 022): airport / intercity only, no intermediate stop. When it is on,
  // the real people / bags count matters (seats and boot are shared), so they are sent and priced.
  const shareAllowed = !!(cfg?.share && pickup && dropoff && !viaStop && isShareRoute(pickup, dropoff));
  // Pre-booking: a co-rider and a stop exclude each other (operator 2026-11-23) — the other button shows a small red note.
  const shareRouteOk = !!(cfg?.share && pickup && dropoff && isShareRoute(pickup, dropoff));
  const [stopWarn, setStopWarn] = useState(false);
  useEffect(() => { if (!stopWarn) return; const id = setTimeout(() => setStopWarn(false), 4000); return () => clearTimeout(id); }, [stopWarn]);
  const shareOn = shareAllowed && shareOpts.on;
  // Pre-booking time (2026-11-23, operator): the «быть на месте с … до …» window only with «Попутчик»;
  // a plain pre-booking asks one thing — what time the car should come.
  const arriveOn = arriveMode && shareOn;
  // Admin «Настройки» (2026-11-25): departure hours, or the saved «Образец ПП: время прибытия».
  const departMode = (cfg?.schedule.shareTimeMode ?? 'DEPART') === 'DEPART';
  const effPax = shareOn ? shareOpts.adults + shareOpts.children : 1;
  const effBags = shareOn ? shareOpts.bags : 0;
  // Real driving route (distance + trip duration + geometry) between the two stops.
  // Debounced, aborted on change, stale-guarded — NOT recomputed on every render.
  const [route, setRoute] = useState<{ line: [number, number][]; km: number | null; min: number | null; unavailable?: boolean } | null>(null);
  useEffect(() => {
    if (!pickup || !dropoff) { setRoute(null); return; }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await api<{ available?: boolean; path?: [number, number][]; distanceKm?: number; etaMinutes?: number; reason?: string }>(
          '/routes/estimate',
          { method: 'POST', body: { from: { lat: pickup.lat, lng: pickup.lng }, to: { lat: dropoff.lat, lng: dropoff.lng }, ...(viaStop ? { via: { lat: viaStop.lat, lng: viaStop.lng } } : {}) }, signal: controller.signal, timeoutMs: 9000 },
        );
        if (r.available === false) { setRoute({ line: [], km: null, min: null, unavailable: true }); return; }
        setRoute({
          line: (r.path ?? []).map(([lat, lng]) => [lng, lat] as [number, number]),
          km: r.distanceKm ?? null,
          min: r.etaMinutes ?? null,
        });
      } catch {
        setRoute(null); // transient/cancelled — clear stale geometry, keep the form
      }
    }, 400);
    return () => { clearTimeout(t); controller.abort(); };
  }, [pickup, dropoff, viaStop]);

  // Fare estimate (server-issued quote) — recomputed when the trip inputs change.
  // Only the ±15 % range is shown, no single «≈» figure (2026-11-16). An upfront fare (low = high) shows one price.
  const fmtRange = (q: { rangeLowCents: number; rangeHighCents: number }) =>
    q.rangeLowCents === q.rangeHighCents ? fmt.money(q.rangeLowCents, 'EUR') : `${fmt.money(q.rangeLowCents, 'EUR')}–${fmt.money(q.rangeHighCents, 'EUR')}`;
  // A Nicosia wall time («2026-11-24T11:30») shown in the passenger's language and clock (24.11.2026, 11:30).
  const wallText = (v: string) => { const r = v ? nicosiaWallTimeToUtc(v) : null; return r?.ok ? fmt.dateTime(r.utc) : v.replace('T', ' '); };
  interface QuoteBody { quoteId: string; priceType: string; totalCents: number; rangeLowCents: number; rangeHighCents: number; night: boolean; holiday: boolean; routeAvailable: boolean; airport?: boolean; minCents?: number | null; minZone?: string | null; lines: { code: string; label: string; cents: number }[]; }
  // Every class is quoted in parallel so the passenger can compare prices before choosing
  // (2026-10-01 audit). `quote` is the selected class's quote (used for booking + review).
  const [quotes, setQuotes] = useState<Partial<Record<'COMFORT' | 'XL', QuoteBody>>>({});
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [noRoute, setNoRoute] = useState(false); // no car can reach a point → no ordering (2026-11-17)
  const [quoting, setQuoting] = useState(false);
  // Quotes live 2 minutes on the server (Task 012 §6.3). Keep them fresh while the passenger
  // looks at the form (2026-11-15: «Оценка стоимости устарела» after a pause), and re-quote +
  // retry once on submit if one still expired.
  const quotesAt = useRef(0);
  const [quoteTick, setQuoteTick] = useState(0);
  useEffect(() => {
    if (!pickup || !dropoff) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - quotesAt.current > 90_000) setQuoteTick((n) => n + 1);
    }, 10_000);
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - quotesAt.current > 90_000) setQuoteTick((n) => n + 1); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [pickup, dropoff]);
  const quoteBody = (key: 'COMFORT' | 'XL', max: number) => ({
    pickup: { lat: pickup!.lat, lng: pickup!.lng }, dropoff: { lat: dropoff!.lat, lng: dropoff!.lng }, ...(viaStop ? { stop: { lat: viaStop.lat, lng: viaStop.lng } } : {}), vClass: key, passengerCount: Math.min(effPax, max), luggageCount: effBags,
    // Price a scheduled ride for its journey time (day/night/holiday + traffic).
    ...(when === 'SCHEDULE' && scheduledAt ? { scheduledAt, scheduleOffsetMin } : {}),
  });
  const classKeys = (cfg?.classes ?? [{ key: 'COMFORT' as const, maxPassengers: 4 }, { key: 'XL' as const, maxPassengers: 6 }]).map((c) => `${c.key}:${c.maxPassengers}`).join(',');
  useEffect(() => {
    if (!pickup || !dropoff) { setQuotes({}); setQuoteErr(null); setNoRoute(false); return; }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setQuoteErr(null); setNoRoute(false); setQuoting(true);
      const list = classKeys.split(',').map((k) => { const [key, max] = k.split(':'); return { key: key as 'COMFORT' | 'XL', max: Number(max) }; });
      const results = await Promise.all(list.map(async (c) => {
        try {
          const q = await api<QuoteBody>('/quote', {
            method: 'POST',
            body: quoteBody(c.key, c.max),
            signal: controller.signal, timeoutMs: 9000,
          });
          return [c.key, q] as const;
        } catch (e) {
          if (e instanceof ApiRequestError) {
            // A point a car can't reach (2026-11-17): the server found the nearest street → move the
            // point there (label kept) and the quote runs again from it. Otherwise: block ordering.
            const snapped = (e.body as { snapped?: Partial<Record<'pickup' | 'dropoff' | 'stop', { lat: number; lng: number }>> }).snapped;
            if (e.body.code === 'NO_ROUTE' && snapped) return [c.key, { snapped }] as const;
            setQuoteErr(tError(e)); if (e.body.code === 'NO_ROUTE') setNoRoute(true);
          }
          return [c.key, null] as const;
        }
      }));
      if (controller.signal.aborted) return;
      const snap = results.map(([, q]) => (q && 'snapped' in q ? q.snapped : null)).find(Boolean);
      if (snap) {
        if (snap.pickup && pickup) setPickup({ ...pickup, lat: snap.pickup.lat, lng: snap.pickup.lng });
        if (snap.dropoff && dropoff) setDropoff({ ...dropoff, lat: snap.dropoff.lat, lng: snap.dropoff.lng });
        if (snap.stop && stop) setStop({ ...stop, lat: snap.stop.lat, lng: snap.stop.lng });
        setQuoting(false);
        return; // the changed points start a new quote
      }
      const next: Partial<Record<'COMFORT' | 'XL', QuoteBody>> = {};
      for (const [k, q] of results) if (q && !('snapped' in q)) next[k] = q as QuoteBody;
      setQuotes(next); setQuoting(false); quotesAt.current = Date.now();
    }, 500);
    return () => { clearTimeout(t); controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, dropoff, viaStop, pax, when, scheduledAt, scheduleOffsetMin, classKeys, tError, quoteTick, effPax, effBags]);
  const quote: QuoteBody | null = quotes[vClass] ?? null;

  // Pre-booking (2026-11-13): only a note for the driver — flight number, meeting point, bags.
  // No passenger/bag steppers: every ride is sent as 1 passenger, 0 bags (the car class covers size).
  const effNote = when === 'SCHEDULE' ? note.trim() : '';
  const maxPax = cfg?.classes.find((c) => c.key === vClass)?.maxPassengers ?? (vClass === 'XL' ? 6 : 4);

  function payloadSignature(offset = scheduleOffsetMin): string {
    return JSON.stringify({ pickup, dropoff, when, scheduledAt, scheduleOffsetMin: offset, vClass, pax: effPax, bags: effBags, name: name.trim(), phone: phone.trim(), note: effNote, share: shareOn ? shareOpts : null });
  }

  useEffect(() => {
    if (!passenger) { setSoonRide(null); return; }
    let alive = true;
    const load = () => api<{ prebookings: { id: string; at: string; pickup: string; dropoff: string; soon: boolean }[] }>('/passenger/prebookings')
      .then((r) => { if (alive) setSoonRide(r.prebookings.find((b) => b.soon) ?? null); })
      .catch(() => { /* keep last */ });
    load(); const iv = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, [passenger]);

  async function openRide(id: string) {
    try {
      const r = await api<{ token: string }>(`/passenger/rides/${id}/track`, { method: 'POST' });
      await api('/tracking/exchange', { method: 'POST', body: { token: r.token } });
      router.push('/track');
    } catch { router.push('/prebookings'); }
  }

  // Fresh form for the next order (keeps the signed-in passenger).
  function orderAnother() {
    setPickup(null); setPickupText(''); setDropoff(null); setDropoffText('');
    setNote(''); setWhen('NOW'); setScheduledAt(''); setScheduleOffsetMin(undefined);
    setErrors({}); setBanner(null); idemKey.current = ''; setDoneAt(null); setStep('form');
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!pickup) e.pickup = t('booking.validation.pickup');
    if (!dropoff) e.dropoff = t('booking.validation.dropoff');
    else if (noRoute) e.dropoff = t('errors.NO_ROUTE' as MsgKey);
    if (passenger && !passenger.guest && !name.trim()) e.name = t('booking.validation.name');
    // Email-only accounts have no verified phone: the contact number is entered per booking.
    if (passenger && !passenger.guest && !passenger.phone && !/^\+?[\d\s()-]{7,20}$/.test(phone.trim())) e.phone = t('booking.validation.phone');
    if (when === 'SCHEDULE' && arriveOn && departMode) {
      if (!departT) e.scheduledAt = t('booking.slots.pick');
      else if (route?.min == null) e.scheduledAt = t('booking.arrive.needRoute');
    } else if (when === 'SCHEDULE' && arriveOn) {
      const w = arriveWindow();
      if (!w) e.scheduledAt = t('booking.arrive.needTimes');
      else if (w.width < 15 || w.width > 180) e.scheduledAt = t('booking.arrive.badWidth');
      else if (route?.min == null) e.scheduledAt = t('booking.arrive.needRoute');
    } else if (when === 'SCHEDULE' && !scheduledAt) e.scheduledAt = t('booking.validation.scheduledAt');
    else if (when === 'SCHEDULE' && scheduledAt < scheduleMin) e.scheduledAt = t('booking.pickupAt.tooSoon', { n: cfg?.schedule.minMinutes ?? 30 });
    if (!e.scheduledAt && shareTooSoon) e.scheduledAt = t('share.booking.tooSoon', { h: shareMinH });
    if (effPax < 1 || effPax > maxPax) e.pax = tp('booking.validation.paxRange', maxPax);
    setErrors(e);
    // Open a collapsed sheet so the highlighted field is reachable (ErrorFocus scrolls to it).
    if (Object.keys(e).length && collapsed) setCollapsed(false);
    return Object.keys(e).length === 0;
  }

  // Resume "Request a ride" once sign-in completes (runs with the fresh `passenger`).
  useEffect(() => {
    if (passenger && pendingReview.current) { pendingReview.current = false; toReview(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passenger]);

  useEffect(() => {
    if (!repeatPending.current || step !== 'form' || !passenger || !quotes[vClass]) return;
    repeatPending.current = false;
    toReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, passenger, step, vClass]);
  // Quick pick (saved place / recent destination): set the destination, then go to the price step
  // as soon as it is priced (same path as «Заказать ещё раз»).
  function pickQuick(pl: Selected) {
    setDropoff({ label: pl.label, lat: pl.lat, lng: pl.lng });
    setDropoffText(pl.label);
    repeatPending.current = true;
  }
  function toReview() {
    if (!validate()) return;
    // Contact details come from the signed-in account, so sign in before the review step.
    // Guest ordering (PASSENGER_GUEST): no sign-in — the order itself creates a guest account.
    if (!passenger && !PASSENGER_GUEST) { pendingReview.current = true; setShowLogin(true); return; }
    // Keep the same idempotency key when the payload is unchanged since last time.
    const sig = payloadSignature();
    if (!idemKey.current || sig !== idemPayloadSig.current) {
      idemKey.current = uuid();
      idemPayloadSig.current = sig;
    }
    setBanner(null);
    setStep('review');
  }

  async function submit(offsetOverride?: number, freshQuote?: QuoteBody) {
    if (!pickup || !dropoff) return;
    const effOffset = offsetOverride ?? scheduleOffsetMin;
    // If the payload changed since the key was minted (e.g. the user just chose a
    // DST occurrence), refresh the key so an edited payload isn't a key conflict.
    const sig = payloadSignature(effOffset);
    if (sig !== idemPayloadSig.current) {
      idemKey.current = uuid();
      idemPayloadSig.current = sig;
    }
    setSubmitting(true);
    setBanner(null);
    try {
      const payload = {
        pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
        ...(viaStop ? { stop: { lat: viaStop.lat, lng: viaStop.lng, label: viaStop.label } } : {}),
        when,
        // Send the raw wall-clock string; the server interprets it as Europe/Nicosia.
        scheduledAt: when === 'SCHEDULE' ? scheduledAt : undefined,
        ...(when === 'SCHEDULE' && arriveOn && arriveDay && arriveFromT && arriveToT ? { arriveFrom: `${arriveDay}T${arriveFromT}`, arriveBy: `${arriveDay}T${arriveToT}` } : {}),
        scheduleOffsetMin: when === 'SCHEDULE' ? effOffset : undefined,
        vClass,
        passengerCount: effPax,
        luggageCount: effBags,
        quoteId: (freshQuote ?? quote)?.quoteId,
        passengerName: name.trim() || passenger?.name || 'Passenger',
        phone: passenger?.phone || phone.trim(),
        note: effNote || undefined,
        ...(shareOn ? { shareOptIn: true, shareMaxExtraMin: when === 'SCHEDULE' && !pickRange ? shareOpts.maxExtra : (cfg?.share?.termsMaxExtraMin ?? 15), // NOW: 15 min for everyone (2026-11-24)
          // The terms shown at booking (TZ 2026-11-23): paired automatically, inside this pickup interval.
          ...(when === 'SCHEDULE' && pickRange && cfg?.share?.termsVersion ? { shareTerms: cfg.share.termsVersion, sharePickupFrom: pickRange.from } : {}), childCount: shareOpts.children, ...(when === 'SCHEDULE' ? { shareWaitMin: shareOpts.wait, shareEarlyMin: shareOpts.early ?? 0 } : {}) } : {}),
      };
      const res = await api<{ tracking: { token: string } }>('/bookings', {
        method: 'POST',
        body: payload,
        headers: { 'Idempotency-Key': idemKey.current },
      });
      await api('/tracking/exchange', { method: 'POST', body: { token: res.tracking.token } });
      if (when === 'SCHEDULE') {
        // Pre-booking: confirm here instead of jumping to tracking, so another ride can be ordered.
        setDoneAt(scheduledAt); setStep('scheduled'); setSubmitting(false);
        // Operator 2026-11-23: after a co-rider pre-booking the board opens at once — choose a co-rider yourself.
        // Chosen in the hour list (2026-11-25): ride with that order — proposed at once, no board.
        if (shareOn && joinPick && departMode) {
          const myId = (res as unknown as { bookingId?: string }).bookingId;
          setJoinResult(null);
          if (myId) api('/passenger/share-board', { method: 'POST', body: { myBookingId: myId, otherBookingId: joinPick, fromHours: true } })
            .then(() => setJoinResult({ ok: true, text: t('share.board.joinSent') }))
            .catch((e) => setJoinResult({ ok: false, text: t('share.board.joinFailed', { reason: e instanceof ApiRequestError ? tError(e) : t('common.networkError') }) }));
          setJoinPick(null);
          return;
        }
        if (shareOn && !join) { router.push(`/share-board?booked=${encodeURIComponent((res as unknown as { reference?: string }).reference ?? '')}`); return; }
        if (join && shareOn) {
          const myId = (res as unknown as { bookingId?: string }).bookingId;
          setJoinResult(null);
          if (myId) api('/passenger/share-board', { method: 'POST', body: { myBookingId: myId, otherBookingId: join.id } })
            .then(() => setJoinResult({ ok: true, text: t('share.board.joinSent') }))
            .catch((e) => setJoinResult({ ok: false, text: t('share.board.joinFailed', { reason: e instanceof ApiRequestError ? tError(e) : t('common.networkError') }) }));
          setJoin(null);
        }
        return;
      }
      router.push('/track');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.body.code === 'LOGIN_REQUIRED') {
          // Mandatory passenger login/registration (Task 014): open the modal, then resume.
          pendingSubmit.current = effOffset;
          pendingSubmitActive.current = true;
          setShowLogin(true);
          setSubmitting(false);
          return;
        }
        if (!freshQuote && quote && (err.body.code === 'QUOTE_EXPIRED' || err.body.code === 'QUOTE_MISMATCH' || err.body.code === 'QUOTE_NOT_FOUND')) {
          // The estimate went stale: get a new one. Same price → book silently with it;
          // a different price → show it and let the passenger confirm (never charge an unseen price).
          try {
            const max = cfg?.classes.find((c) => c.key === vClass)?.maxPassengers ?? (vClass === 'XL' ? 6 : 4);
            const fresh = await api<QuoteBody>('/quote', { method: 'POST', body: quoteBody(vClass as 'COMFORT' | 'XL', max), timeoutMs: 9000 });
            setQuotes((prev) => ({ ...prev, [vClass]: fresh })); quotesAt.current = Date.now();
            if (fresh.totalCents === quote.totalCents) return submit(effOffset, fresh);
            setBanner(t('booking.form.priceUpdated', { price: fmtRange(fresh) }));
          } catch { setBanner(tError(err)); }
          setSubmitting(false);
          return;
        }
        if (err.body.code === 'SCHEDULE_AMBIGUOUS') {
          // Keep the user on review and let them pick which occurrence they meant.
          const opts = (err.body as unknown as { scheduleOptions?: string[] }).scheduleOptions || [];
          setAmbiguous(opts.length ? opts : ['180', '120']);
          setBanner(tError(err));
          setSubmitting(false);
          return;
        }
        if (err.body.fieldErrors && Object.keys(err.body.fieldErrors).length) {
          setErrors(err.body.fieldErrors);
          setStep('form');
        }
        setBanner(err.body.message ? tError(err) : t('booking.review.bookingFailed'));
      } else {
        setBanner(t('booking.review.networkSafe'));
      }
      setSubmitting(false);
    }
  }

  function onPickerConfirm(sel: Selected) {
    // Update ONLY the field being edited; all other inputs are preserved.
    if (picker === 'pickup') {
      setPickup(sel);
      setPickupText(sel.label);
      setAutoPickup(false); // passenger chose a pickup explicitly
    } else if (picker === 'dropoff') {
      setDropoff(sel);
      setDropoffText(sel.label);
    } else if (picker === 'stop') {
      setStop(sel);
      setStopText(sel.label);
    }
    setPicker(null);
  }

  // Minimum scheduled time expressed in Europe/Nicosia wall time (matches the server),
  // regardless of the visitor's own timezone. Refreshes as time advances (scheduleTick).
  const scheduleMin = useMemo(() => {
    return nicosiaInputValue(new Date(Date.now() + (cfg?.schedule.minMinutes ?? 30) * 60000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, scheduleTick]);

  // Arrival window → pickup times (Cyprus wall clock). Margin for traffic: 10 min.
  const ARRIVE_MARGIN_MIN = 10;
  function arriveWindow(): { from: number; to: number; width: number } | null {
    const m1 = /^(\d{2}):(\d{2})$/.exec(arriveFromT), m2 = /^(\d{2}):(\d{2})$/.exec(arriveToT);
    if (!arriveDay || !m1 || !m2) return null;
    const from = +m1[1] * 60 + +m1[2], to = +m2[1] * 60 + +m2[2];
    return { from, to, width: to - from };
  }
  const wall = (minOfDay: number) => {
    const d = new Date(Date.UTC(+arriveDay.slice(0, 4), +arriveDay.slice(5, 7) - 1, +arriveDay.slice(8, 10), 0, minOfDay));
    return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM, still Cyprus wall time
  };
  const DEPART_SPAN = 15;
  const minOf = (x: string) => { const m = /^(\d{2}):(\d{2})$/.exec(x); return m ? +m[1] * 60 + +m[2] : null; };
  const arriveCalc = (() => {
    // Departure hour (2026-11-24): pickup between the hour and +15 min.
    if (when === 'SCHEDULE' && arriveOn && departMode && departT && minOf(departT) != null) {
      const m = minOf(departT)!;
      return { leaveFrom: wall(m), leaveBy: wall(m + DEPART_SPAN), drive: Math.ceil(route?.min ?? 0) };
    }
    const w = arriveWindow();
    if (when !== 'SCHEDULE' || !arriveOn || !w || w.width < 15 || w.width > 180 || route?.min == null) return null;
    const drive = Math.ceil(route.min) + ARRIVE_MARGIN_MIN;
    return { leaveFrom: wall(w.from - drive), leaveBy: wall(w.to - drive), drive };
  })();
  // «Попутчик −30%» pickup interval (TZ 2026-11-23): by default the whole computed «Подача с … до …»;
  // «Изменить» narrows it or picks one exact time. Only with a co-rider, only inside the computed interval.
  const [pickNarrow, setPickNarrow] = useState<{ mode: 'all' | 'range' | 'exact'; from: string; to: string }>({ mode: 'all', from: '', to: '' });
  const [pickEdit, setPickEdit] = useState(false);
  useEffect(() => { setPickNarrow({ mode: 'all', from: '', to: '' }); }, [arriveCalc?.leaveFrom, arriveCalc?.leaveBy]);
  const hhmm = /^\d{2}:\d{2}$/;
  const pickRange = (() => {
    if (!arriveCalc) return null;
    const lo = arriveCalc.leaveFrom.slice(11, 16), hi = arriveCalc.leaveBy.slice(11, 16), day = arriveCalc.leaveBy.slice(0, 11);
    const inside = (x: string) => hhmm.test(x) && x >= lo && x <= hi;
    if (pickNarrow.mode === 'exact' && inside(pickNarrow.from)) return { from: day + pickNarrow.from, to: day + pickNarrow.from, exact: true, bad: false };
    if (pickNarrow.mode === 'range' && inside(pickNarrow.from) && inside(pickNarrow.to) && pickNarrow.from <= pickNarrow.to) return { from: day + pickNarrow.from, to: day + pickNarrow.to, exact: pickNarrow.from === pickNarrow.to, bad: false };
    const typed = pickNarrow.mode !== 'all' && (pickNarrow.from !== '' || pickNarrow.to !== '');
    return { from: arriveCalc.leaveFrom, to: arriveCalc.leaveBy, exact: false, bad: typed };
  })();
  // The pickup sent with the order = the LATEST departure of the interval; a co-rider may make it earlier.
  const pickupTarget = arriveCalc ? (shareOn && pickRange ? pickRange.to : arriveCalc.leaveBy) : null;
  useEffect(() => {
    if (arriveOn && pickupTarget && scheduledAt !== pickupTarget) { setScheduledAt(pickupTarget); setScheduleOffsetMin(undefined); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arriveOn, pickupTarget]);

  const classes = cfg?.classes ?? [
    { key: 'COMFORT' as const, label: 'Comfort', maxPassengers: 4 },
    { key: 'XL' as const, label: 'XL', maxPassengers: 6 },
  ];

  // «Быть на месте с … до …» inputs (2026-11-22). With «Попутчик» on in a pre-booking (operator: «у клиента по
  // заказу ПП нету раздела от и до, всё ещё гибкость») they REPLACE the flexibility choice and sit in the
  // ride-share box; otherwise they are the «Быть на месте» mode of the pre-booking panel.
  const shareArrive = when === 'SCHEDULE' && !!cfg?.share && shareOpts.on && shareAllowed;
  // Co-rider pre-booking at least N h ahead (operator 2026-11-22: 3 h, admin «Настройки»).
  const shareMinWall = nicosiaInputValue(new Date(Date.now() + (cfg?.schedule.shareMinMinutes ?? 180) * 60000));
  const shareMinH = Math.round(((cfg?.schedule.shareMinMinutes ?? 180) / 60) * 10) / 10;
  // No 3-hour rule in the departure-hour mode (2026-11-25): he sees who rides when and picks what he can make.
  const shareTooSoon = !departMode && when === 'SCHEDULE' && shareOn && !!scheduledAt && scheduledAt < shareMinWall;
  useEffect(() => {
    if (when === 'SCHEDULE' && !arriveDay) setArriveDay(scheduleMin.slice(0, 10));
    if (when === 'SCHEDULE' && !pickDay) setPickDay(scheduleMin.slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when]);
  useEffect(() => {
    const id = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('join') : null;
    if (!id || !cfg) return;
    window.history.replaceState(null, '', window.location.pathname); // a reload does not join again
    api<{ id: string; at: string; from: string; to: string; arrive: { from: string; by: string } | null }>(`/passenger/share-board?ride=${encodeURIComponent(id)}`)
      .then((r) => {
        setJoin(r);
        setWhen('SCHEDULE'); setCollapsed(false);
        setShareOpts((o) => ({ ...o, on: true }));
        const wallOf = (iso: string) => nicosiaInputValue(new Date(iso));
        setArriveMode(true);
        if ((cfg?.schedule.shareTimeMode ?? 'DEPART') === 'DEPART') {
          // Joining a ride on the board: the departure hour it sits in (2026-11-24).
          const w = wallOf(r.at), step = cfg?.schedule.shareSlotMinutes ?? 60, m = +w.slice(11, 13) * 60 + +w.slice(14, 16);
          const h = Math.floor(m / step) * step;
          setArriveDay(w.slice(0, 10)); setDepartT(`${String(Math.floor(h / 60)).padStart(2, '0')}:${String(h % 60).padStart(2, '0')}`);
        } else if (r.arrive) { const f = wallOf(r.arrive.from), b = wallOf(r.arrive.by); setArriveDay(f.slice(0, 10)); setArriveFromT(f.slice(11, 16)); setArriveToT(b.slice(11, 16)); }
        else setArriveDay(wallOf(r.at).slice(0, 10));
      })
      .catch(() => setFlash(t('share.board.joinFailed', { reason: t('errors.BOOKING_GONE') })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!cfg]);
  useEffect(() => {
    if (when !== 'SCHEDULE' || arriveOn) return;
    const v = pickDay && /^\d{2}:\d{2}$/.test(pickT) ? `${pickDay}T${pickT}` : '';
    if (v !== scheduledAt) { setScheduledAt(v); setScheduleOffsetMin(undefined); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when, arriveOn, pickDay, pickT]);
  const arriveBadWidth = (() => { const w = arriveWindow(); return !!w && (w.width < 15 || w.width > 180); })();
  // «Попутчик −30%» terms inside the co-rider box (TZ 2026-11-23): automatic pairing, arrival + pickup interval,
  // +15 min limit, «Изменить» to narrow it or pick an exact time. Prices are on the class step, next to «Заказать».
  const clk = (wallStr: string) => fmt.clock(wallStr.slice(11, 16));
  // Departure-hour mode (operator 2026-11-25): no conditions text — the hour list shows who and when; only
  // «Подача 13:00–13:15» once an hour is chosen.
  // (an empty element still hides the «how flexible» choice in the co-rider box)
  const shareTermsBox = departMode ? <></> : (
    <div className="rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2.5" data-testid="share-terms">
      <p className="text-[13px] font-semibold text-accent">{t('share.terms.auto')}</p>
      {/* Simple (operator 2026-11-23): the window, the 15-minute limit and the board — no pickup editor. */}
      {arriveCalc ? (
        <p className="mt-1 text-[15px] font-bold leading-snug" data-testid="share-terms-times">{(departMode ? t('booking.slots.pickupSpan', { from: fmt.clock(arriveCalc.leaveFrom.slice(11)), to: fmt.clock(arriveCalc.leaveBy.slice(11)) }) : t('share.terms.arrive', { af: fmt.clock(arriveFromT), at: fmt.clock(arriveToT) }))}</p>
      ) : departMode ? null /* no hint line here (operator 2026-11-25): the hour list below says it */ : <p className="mt-1 text-xs text-muted">{t('share.terms.needWindow')}</p>}
      <p className="mt-1 text-xs">{t('share.terms.extra', { n: cfg?.share?.termsMaxExtraMin ?? 15 })}</p>
      <p className="mt-1 text-xs">{t('share.terms.board')}</p>
      <p className="mt-1.5 text-xs text-muted" data-testid="share-min-note">{t('share.booking.minNote', { h: shareMinH })}</p>
    </div>
  );
  const pickupBox = (
    <div data-testid="pickup-time">
      {!pickT && <p className="mb-2 rounded-[10px] border border-accent/50 bg-accent/15 px-3 py-2 text-[13px] font-medium text-ink" data-testid="pickup-hint">{t('booking.pickupAt.hint')}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-2">
        <label className="block min-w-0">
          <span className="label">{t('booking.arrive.day')}</span>
          <input type="date" className="field mt-1 block w-full min-w-0 max-w-full appearance-none !min-h-[44px] !px-2 !py-2 text-center text-base" value={pickDay} min={scheduleMin.slice(0, 10)} onChange={(e) => setPickDay(e.target.value)} data-testid="pickup-day" />
        </label>
        <TimeBox label={t('booking.pickupAt.time')} testid="pickup-at" value={pickT} onChange={setPickT} bad={!!errors.scheduledAt} />
      </div>
      {errors.scheduledAt && <p className="mt-1 text-xs text-danger">{errors.scheduledAt}</p>}
    </div>
  );
  // «Попутчик» departure hours (2026-11-24, operator): the passenger picks an hour (1 h by default, admin
  // setting); the car comes within 15 min of it. Under each hour: orders already there, people in each, and
  // when he would arrive riding with each one — so he sees who suits his flight.
  const slotPax = Math.max(1, effPax);
  const slotsFor = departMode && arriveOn && when === 'SCHEDULE' && arriveDay && pickup && dropoff ? `${arriveDay}|${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}|${slotPax}|${effBags}|${vClass}` : '';
  useEffect(() => {
    if (!slotsFor || !pickup || !dropoff) { setArriveSlots(null); return; }
    let gone = false;
    api<{ slots: { at: string; orders: { id: string; people: number; myArrive: string | null; why?: 'ROOM' | 'TIME' }[] }[] }>(`/share/slots?day=${arriveDay}&pLat=${pickup.lat}&pLng=${pickup.lng}&dLat=${dropoff.lat}&dLng=${dropoff.lng}&pax=${slotPax}&bags=${effBags}&vClass=${vClass}`)
      .then((r) => { if (!gone) setArriveSlots(r.slots); }).catch(() => { if (!gone) setArriveSlots([]); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsFor]);
  const slotTooSoon = (at: string) => { const m = minOf(at); return m == null || wall(m) < scheduleMin; };
  const slotBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = slotBoxRef.current; if (!box || !arriveSlots) return;
    const el = (box.querySelector('[aria-pressed="true"]') ?? box.querySelector('button:not([disabled])')) as HTMLElement | null;
    if (el) box.scrollTop = el.offsetTop - box.offsetTop - 4;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arriveSlots]);
  // Alone: the hour + the drive (+ the 15-minute pickup span at worst).
  const aloneAt = (at: string) => { const m = minOf(at); return m == null || route?.min == null ? null : wall(m + DEPART_SPAN + Math.ceil(route.min)).slice(11, 16); };
  const slotList = (
    <div className="mt-2" data-testid="arrive-slots">
      <p className="mb-1.5 text-[13px] font-medium text-ink">{t('booking.slots.titleDepart')}</p>
      <div ref={slotBoxRef} className="relative max-h-[300px] space-y-1.5 overflow-y-auto overscroll-contain rounded-[12px] pe-1">
        {!arriveSlots ? <p className="text-xs text-muted">{t('common.loading')}</p> : arriveSlots.map((x) => {
          const late = slotTooSoon(x.at);
          const on = departT === x.at;
          const alone = aloneAt(x.at);
          return (
            <div key={x.at} className={`rounded-[10px] border ${on ? 'border-accent bg-accent/15' : 'border-edge bg-elevated'} ${late ? 'opacity-40' : ''}`}>
              {/* The hour alone (or let the system pair him) — tap the hour. */}
              <button type="button" disabled={late} onClick={() => { setDepartT(x.at); setJoinPick(null); }} data-testid={`slot-${x.at}`} aria-pressed={on && !joinPick}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-start">
                <span className="text-[16px] font-bold tabular-nums">{fmt.clock(x.at)}</span>
                <span className="text-end text-xs text-muted">{late ? t('booking.slots.tooSoon') : alone ? t('booking.slots.alone', { at: fmt.clock(alone) }) : x.orders.length ? tp('booking.slots.orders', x.orders.length) : t('booking.slots.none')}</span>
              </button>
              {/* Each order in this hour: ride with it — only if he can (time, detour, room). */}
              {!late && x.orders.length > 0 && (
                <div className="space-y-1 px-2 pb-2">
                  {x.orders.map((o) => {
                    const picked = joinPick === o.id;
                    return (
                      <button key={o.id} type="button" disabled={!o.myArrive} onClick={() => { setDepartT(x.at); setJoinPick(o.id); }} data-testid={`slot-order-${o.id}`} aria-pressed={picked}
                        className={`flex w-full items-center justify-between gap-2 rounded-[8px] border px-2.5 py-2 text-start text-xs ${picked ? 'border-accent bg-accent text-[#10191C]' : o.myArrive ? 'border-accent/40 text-accent' : 'border-edge text-muted'}`}>
                        <span>👥 {t('booking.slots.people', { n: o.people })} — {o.myArrive ? t('booking.slots.withArrive', { at: fmt.clock(nicosiaInputValue(new Date(o.myArrive)).slice(11, 16)) }) : o.why === 'ROOM' ? t('booking.slots.noRoom') : t('booking.slots.noTime')}</span>
                        {o.myArrive && <span className="shrink-0 font-semibold">{picked ? '✓' : t('booking.slots.ride')}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {arriveCalc && (
        <div className="mt-2 rounded-[10px] border border-accent/50 bg-accent/15 px-3 py-2 text-[13px] font-medium text-ink" data-testid="arrive-leave">
          <p className="text-[15px] font-bold">{t('booking.slots.pickupSpan', { from: fmt.clock(arriveCalc.leaveFrom.slice(11)), to: fmt.clock(arriveCalc.leaveBy.slice(11)) })}</p>
          {joinPick && <p className="mt-0.5 font-semibold text-accent" data-testid="share-terms-with">👥 {t('booking.slots.withChosen')}</p>}
        </div>
      )}
    </div>
  );
  // «Образец ПП: время прибытия» (until 2026-11-24, kept as an admin choice 2026-11-25).
  const arriveBoxSample = (
    <div data-testid="arrive-window">
      {/* The hint sits ABOVE the date field until both times are set (2026-11-22, operator). */}
      {!arriveWindow() && <p className="mb-2 rounded-[10px] border border-accent/50 bg-accent/15 px-3 py-2 text-[13px] font-medium text-ink" data-testid="arrive-hint">{t('booking.arrive.hint')}</p>}
      <input type="date" className="field block w-full min-w-0 max-w-full appearance-none" value={arriveDay} min={scheduleMin.slice(0, 10)} onChange={(e) => setArriveDay(e.target.value)} aria-label={t('booking.arrive.day')} />
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <TimeBox label={t('booking.arrive.from')} testid="arrive-from" value={arriveFromT} onChange={setArriveFromT} bad={!!errors.scheduledAt} />
        <TimeBox label={t('booking.arrive.to')} testid="arrive-to" value={arriveToT} onChange={setArriveToT} bad={!!errors.scheduledAt} />
      </div>
      {arriveWindow() && (
        <p className={`mt-2 rounded-[10px] border px-3 py-2 text-[13px] font-medium text-ink ${arriveBadWidth ? 'border-warn/50 bg-warn/15' : 'border-accent/50 bg-accent/15'}`} data-testid="arrive-leave">
          {arriveBadWidth ? t('booking.arrive.badWidth') : arriveCalc
            ? t('booking.arrive.leave', { from: fmt.clock(arriveCalc.leaveFrom.slice(11)), to: fmt.clock(arriveCalc.leaveBy.slice(11)), n: arriveCalc.drive })
            : t('booking.arrive.needRoute')}
        </p>
      )}
      {errors.scheduledAt && <p className="mt-1 text-xs text-danger">{errors.scheduledAt}</p>}
    </div>
  );
  const arriveBox = !departMode ? arriveBoxSample : (
    <div data-testid="arrive-window">
      <input type="date" className="field block w-full min-w-0 max-w-full appearance-none" value={arriveDay} min={scheduleMin.slice(0, 10)} onChange={(e) => setArriveDay(e.target.value)} aria-label={t('booking.arrive.day')} />
      {/* Departure hours instead of «быть на месте с … до …» (2026-11-24). */}
      {slotList}
      {errors.scheduledAt && <p className="mt-1 text-xs text-danger">{errors.scheduledAt}</p>}
    </div>
  );

  // Car class choice (2026-11-15): moved from the address form to the final step before ordering.
  // Each class has its own picture (sedan / minibus) and «up to N people».
  const classPicker = (
    <div className="mt-4">
      <p className="label mb-2" id="ride-class-label">{t('booking.form.chooseRide')}</p>
      <div className="space-y-2" role="radiogroup" aria-labelledby="ride-class-label">
        {classes.map((c) => {
          const q = quotes[c.key as 'COMFORT' | 'XL'];
          const selected = vClass === c.key;
          return (
            <button key={c.key} type="button" role="radio" aria-checked={selected}
              onClick={() => { setVClass(c.key); if (pax > c.maxPassengers) setPax(c.maxPassengers); }}
              className={`flex w-full items-center gap-3 rounded-[14px] border px-3 py-3 text-start transition ${selected ? 'border-accent bg-accent/10' : 'border-edge bg-elevated hover:border-accent/40'}`}>
              <CarClassIcon kind={c.key === 'XL' ? 'minibus' : 'sedan'} active={selected} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t(`common.vClass.${c.key}`)}</span>
                <span className="block text-xs text-muted">{t('booking.form.upToPeople', { n: c.maxPassengers })}</span>
              </span>
              <span className="shrink-0 text-end">
                {q ? (
                  <>
                    {shareOn && when === 'SCHEDULE' && cfg?.share
                      // Co-rider pre-booking: the price with a co-rider, no range; the full one below (TZ review 2026-11-23).
                      ? <span className={`block font-semibold tabular-nums ${selected ? 'text-accent' : 'text-ink'}`}>{fmt.money(sharedCents(q.totalCents, cfg.share.discountPct), 'EUR')}</span>
                      : <span className={`block font-semibold tabular-nums ${selected ? 'text-accent' : 'text-ink'}`}>{fmtRange(q)}</span>}
                  </>
                ) : <span className="text-xs text-muted">{quoting ? t('booking.form.pricing') : '—'}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {/* Pre-booking minimum in Nicosia (2026-11-22): at least €20, above that the meter counts. */}
      {/* «Попутчик −30%» prices before «Заказать» (TZ 2026-11-23): both sums, and that without a pair, on a
          cancel or the co-rider's no-show this passenger pays their full price; the no-show fee. */}
      {(() => {
        const q = quotes[vClass as 'COMFORT' | 'XL'];
        if (!(shareOn && when === 'SCHEDULE' && q && cfg?.share)) return null;
        return (
          <div className="mt-2 rounded-[10px] border border-accent/50 bg-accent/10 px-3 py-2 text-[13px] text-ink" data-testid="share-prices">
            {/* Two sums, no range (TZ review 2026-11-23): what they pay with a co-rider and without one. */}
            <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{t('share.terms.withPair')}</span><span className="text-base font-bold text-accent tabular-nums" data-testid="price-shared">{fmt.money(sharedCents(q.totalCents, cfg.share.discountPct), 'EUR')}</span></div>
            <p className="text-xs text-muted">{t('share.terms.withPairWhen')}</p>
            <div className="mt-1.5 flex items-baseline justify-between gap-2"><span className="font-semibold">{t('share.terms.noPair')}</span><span className="text-base font-bold tabular-nums" data-testid="price-full">{q.priceType === 'REGULATED_FIXED' ? '' : '≈ '}{fmt.money(q.totalCents, 'EUR')}</span></div>
            <p className="text-xs text-muted">{q.priceType === 'REGULATED_FIXED' ? '' : `${t('share.terms.meter')} · `}{t('share.terms.noPairWhen')}</p>
            <p className="mt-1.5 text-xs text-muted">{t('share.terms.noShow', { fee: fmt.money(Math.min(cfg.share.noShowFeeCents ?? 1000, sharedCents(q.totalCents, cfg.share.discountPct)), 'EUR') })}</p>
          </div>
        );
      })()}
      {(() => { const q = quotes[vClass as 'COMFORT' | 'XL']; return q?.minCents ? <p className="mt-2 rounded-[10px] border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink" data-testid="prebook-min">{t('booking.form.prebookMin', { amount: fmt.money(q.minCents, 'EUR'), zone: q.minZone ?? '' })}</p> : null; })()}
      {errors.pax && <p className="mt-1 text-xs text-danger">{errors.pax}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-page" style={kbBox}>
      {resuming && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-page text-muted" data-testid="resuming-ride">{t('common.loading')}</div>}
      <NotifyPrompt pushUrl="/passenger/push" active />
      <input ref={proxyRef} aria-hidden tabIndex={-1} readOnly={false} className="pointer-events-none fixed start-0 top-0 h-px w-px opacity-0" style={{ fontSize: 16 }} />
      {savedSheet && (
        <SavedPlacesSheet mode={savedSheet} places={places} onSaved={reloadPlaces} onClose={() => setSavedSheet(null)}
          onGo={(pl) => { setSavedSheet(null); pickQuick(pl); }} />
      )}
      {editor && (
        <RouteEditor
          rows={slots.map((s) => { const v = slotGet(s); return { slot: s, sel: v.sel, text: v.text }; })}
          initial={editor}
          origin={myLoc ?? (pickup ? { lat: pickup.lat, lng: pickup.lng } : null)}
          recent={destinations}
          home={places.home}
          work={places.work}
          school={places.school ?? null}
          custom={places.custom ?? []}
          canAddStop={!hasStop && !(when === 'SCHEDULE' && shareOn)}
          onText={(s, x) => { slotGet(s).setText(x); if (s === 'p' && autoPickup) setAutoPickup(false); }}
          onSelect={(s, sel) => { slotGet(s).setSel(sel); if (s === 'p') setAutoPickup(false); }}
          onAddStop={() => setHasStop(true)}
          onRemoveStop={() => { setHasStop(false); setStop(null); setStopText(''); }}
          onSwap={swapRoute}
          onReorder={reorderRoute}
          onPickOnMap={(s) => { setEditor(null); setPicker(s === 'p' ? 'pickup' : s === 's' ? 'stop' : 'dropoff'); }}
          onClose={() => { setEditor(null); (document.activeElement as HTMLElement | null)?.blur(); }}
        />
      )}
      {cfgError && (
        <div className="flex items-center justify-center gap-3 bg-warn/15 border-b border-warn/30 px-3 py-1.5 text-xs sm:text-xs text-warn">
          <span>{t('booking.config.loadFailed')}</span>
          <button className="rounded border border-warn/40 px-2 py-0.5 hover:bg-warn/10" onClick={loadConfig} disabled={cfgLoading}>
            {cfgLoading ? t('booking.config.retrying') : t('common.retry')}
          </button>
        </div>
      )}
      <FixedTop top={kbBox?.top}>
      <header className="flex items-center justify-between border-b border-edge bg-page px-4 py-2 sm:px-6" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        {/* Back arrow only where there is a step behind (2026-11-17): class choice → the form. */}
        <div className="flex items-center gap-1">
          {step === 'review' && <BackArrow className="-ms-2" onBack={() => setStep('form')} />}
          <Logo className="h-10" />
        </div>
        <div className="flex items-center gap-2">
          {/* Segmented nav styled exactly like the Now / Schedule control. When signed in the
              trailing "Login" tab is dropped in favour of the account avatar (below). */}
          <nav className="hidden gap-2 rounded-[12px] border border-edge bg-elevated p-1 sm:flex">
            {[
              { href: '/', label: t('common.book'), active: true },
              { href: '/rides', label: t('booking.nav.rides'), active: false },
              { href: '/privacy', label: t('booking.nav.privacy'), active: false },
              ...(passenger ? [] : [{ href: '/login', label: t('booking.nav.login'), active: false }]),
            ].map((n) => (
              <a key={n.href} href={n.href} className={`rounded-[9px] px-3 py-2 text-sm font-medium transition ${n.active ? 'bg-accent text-[#0d1608]' : 'text-muted hover:text-ink'}`}>
                {n.label}
              </a>
            ))}
          </nav>
          {passenger ? (
            <AccountMenu passenger={passenger} onLoggedOut={() => setPassenger(null)} />
          ) : (
            <a href="/login" className="btn-ghost !min-h-0 !py-1.5 text-base sm:hidden">{t('booking.nav.login')}</a>
          )}
        </div>
      </header>
      </FixedTop>
      <InstallPrompt app="passenger" className="z-20 mx-3 mt-2 sm:hidden" />

      <div className="relative flex-1">
        <div ref={mapBoxRef} className="absolute inset-0">
          {/* The full-screen picker is its own map; unmount this background map while it's
              open (frees the WebGL context and avoids two simultaneous map instances). */}
          {picker ? (
            <div className="h-full w-full bg-page" />
          ) : (
            <AutoMapView markers={mapMarkers} areas={mapAreas} route={route?.line} fitRoute fleet={fleet} fleetLikeSelf focus={pickup && dropoff ? null : camFocus} focusZoom={pickup && dropoff ? undefined : camZoom} center={myLoc ?? { lat: 34.92, lng: 33.2 }} zoom={myLoc ? 14 : 9} interactive fitPadding={fitPadding} recenterTick={recenterTick} holdCamera={onSpot && !landing} onGlideEnd={() => { if (landTimer.current) window.clearTimeout(landTimer.current); setLanding(false); }} glideMs={landing ? SPOT_GLIDE_MS : undefined} onUserMove={() => { setMapMoved(true); if (centerModeRef.current) setPinLift(true); }} onCenterPick={onCenterPick} className="h-full w-full" />
          )}
          {step === 'form' && (terr || dropTerr) && (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-[6] mx-auto max-w-sm space-y-2">
              {terr && (
            <div className="pointer-events-auto rounded-[14px] border border-[#4C9AFF] bg-elevated/95 px-3 py-2 text-[13px] leading-snug text-ink shadow-lg" data-testid="pickup-territory">
              <div className="font-medium">📍 {t(terr.t.points.length > 1 ? 'booking.pickupPoints' : 'booking.pickupPoint', { name: terr.t.name })}</div>
              {terr.t.points.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {terr.t.points.map((sp, i) => (
                    <button key={i} type="button" onClick={() => chooseSpot(i, false)} data-testid="pickup-spot"
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${terr.on === i ? 'border-[#4C9AFF] bg-[#4C9AFF] text-[#0b0f10]' : 'border-[#4C9AFF]/60 text-ink'}`}>
                      {sp.name || `${i + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
              )}
              {dropTerr && (dropTerr.t.dropPoints ?? []).length > 0 && (
                <div className="pointer-events-auto rounded-[14px] border border-[#FFC83D] bg-elevated/95 px-3 py-2 text-[13px] leading-snug text-ink shadow-lg" data-testid="drop-territory">
                  <div className="font-medium">🏁 {t((dropTerr.t.dropPoints ?? []).length > 1 ? 'booking.dropPoints' : 'booking.dropPoint', { name: dropTerr.t.name, point: (dropTerr.t.dropPoints ?? [])[Math.max(0, dropTerr.on)]?.name || dropTerr.t.name })}</div>
                  {(dropTerr.t.dropPoints ?? []).length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(dropTerr.t.dropPoints ?? []).map((sp, i) => (
                        <button key={i} type="button" onClick={() => chooseDrop(i)} data-testid="drop-spot"
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${dropTerr.on === i ? 'border-[#FFC83D] bg-[#FFC83D] text-[#0b0f10]' : 'border-[#FFC83D]/60 text-ink'}`}>
                          {sp.name || `${i + 1}`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {pinOverlay && mapBox.w > 0 && (() => {
            const pt = pinPoint(fitPadding, mapBox.w, mapBox.h);
            return (
              <div aria-hidden data-testid="center-pin" className="pointer-events-none absolute z-[5]" style={{ left: pt.x - 16, top: pt.y - 40, width: 32, height: 40 }}>
                <div className="h-full w-full transition-transform duration-150" style={{ transform: pinLift ? 'translateY(-10px)' : 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.55))' }}>
                  <div className={`h-full w-full ${offIsland ? 'ily-pin-shake' : ''}`} dangerouslySetInnerHTML={{ __html: offIsland ? BRAND_PIN_SVG_RED : BRAND_PIN_SVG }} data-red={offIsland ? '1' : undefined} />
                </div>
                <div className={`absolute left-1/2 top-full h-1.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40 transition-opacity ${pinLift ? 'opacity-100' : 'opacity-0'}`} />
              </div>
            );
          })()}
        </div>

        {mapMoved && myLoc && !picker && (
          <button type="button" aria-label={t('booking.picker.myLocation')} title={t('booking.picker.myLocation')}
            onClick={() => { setMapMoved(false); if (centerMode && myLoc) void pickAt(myLoc.lat, myLoc.lng, false); setRecenterTick((n) => n + 1); }}
            className="absolute bottom-6 end-6 z-20 hidden h-10 items-center gap-2 rounded-full border border-white/15 bg-[#10191C]/95 px-3.5 text-[13px] text-white shadow-lg sm:flex">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden className="shrink-0"><circle cx="12" cy="12" r="6" /><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /></svg><span>{t('booking.picker.myLocation')}</span>
          </button>
        )}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end sm:block">
          <div ref={sheetBoxRef} className="flex h-full w-full flex-col justify-end sm:absolute sm:start-4 sm:top-4 sm:block sm:h-[calc(100%-2rem)] sm:w-[380px]">
            {mapMoved && myLoc && !picker && (
              <div className="flex shrink-0 justify-end px-3 pb-3 sm:hidden">
                <button type="button" data-testid="map-my-location" aria-label={t('booking.picker.myLocation')} title={t('booking.picker.myLocation')}
                  onClick={() => { setMapMoved(false); if (centerMode && myLoc) void pickAt(myLoc.lat, myLoc.lng, false); setRecenterTick((n) => n + 1); }}
                  className="pointer-events-auto flex h-10 items-center gap-2 rounded-full border border-white/15 bg-[#10191C]/95 px-3.5 text-[13px] text-white shadow-lg">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden className="shrink-0"><circle cx="12" cy="12" r="6" /><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /></svg><span>{t('booking.picker.myLocation')}</span>
                </button>
              </div>
            )}
            <div
              ref={sheetRef}
              className={`card pointer-events-auto relative flex flex-col overflow-hidden sm:max-h-full ${isMobile ? 'rounded-b-none' : ''} ${isMobile && dragH == null ? 'transition-[height] duration-300 ease-out' : ''}`}
              style={isMobile ? (!collapsed && dragH == null ? { height: 'auto', maxHeight: '100%' } /* only as tall as its content (2026-11-17) */ : { height: dragH != null ? `${dragH}px` : collapsed ? `calc(${peekPx}px + env(safe-area-inset-bottom))` : '100%' }) : undefined}
              // Only a focused FORM FIELD expands a collapsed sheet. The handle itself is focusable, and
              // its focus after a tap re-expanded the sheet right after the tap collapsed it (2026-11-15).
              onFocusCapture={(e) => { if (isMobile && collapsed && (e.target as HTMLElement).matches('input:not([readonly]), textarea, select')) setCollapsed(false); }}
            >
              {/* Reset the route (2026-11-15): top-right corner, twice the old size. Also on the folded sheet
                  that shows the route (2026-11-17), so it never disappears while a route is set. */}
              {/* The pre-booking window's ✕ stays on the folded sheet too (2026-11-20). */}
              {step === 'form' && (((!collapsed || peekRoute) && (addrOpen || dropoff || dropoffText)) || when === 'SCHEDULE') && (
                <button type="button" aria-label={t('booking.form.resetRoute')} title={t('booking.form.resetRoute')} onClick={when === 'SCHEDULE' ? exitSchedule : resetRoute} data-testid="sheet-close"
                  className="absolute end-1.5 top-1.5 z-20 flex h-12 w-12 items-center justify-center rounded-full text-[36px] leading-none text-muted hover:bg-page/60 hover:text-ink">×</button>
              )}
              {isMobile ? (
                // Mobile bottom sheet: drag the handle up (full screen) or down (a strip stays visible).
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? t('booking.sheet.expand') : t('booking.sheet.collapse')}
                  onPointerDown={onSheetDown}
                  onPointerMove={onSheetMove}
                  onPointerUp={onSheetUp}
                  onPointerCancel={onSheetUp}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed((c) => !c); } }}
                  className="flex w-full shrink-0 cursor-grab touch-none select-none justify-center pb-2 pt-3"
                >
                  <span className="h-1.5 w-12 rounded-full bg-edge-strong" />
                </div>
              ) : (
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-expanded={!collapsed}
                aria-label={collapsed ? t('booking.sheet.expand') : t('booking.sheet.collapse')}
                className="flex w-full shrink-0 flex-col items-center gap-1 px-4 pb-1 pt-2 text-muted hover:text-ink"
              >
                <span className="h-1 w-10 rounded-full bg-edge-strong" />
                {collapsed ? (
                  <span className="flex w-full items-center justify-between gap-3 py-1.5 text-start">
                    <span className="min-w-0">
                      <span className="block text-base font-bold text-ink">{t('booking.form.title')}</span>
                      {pickup && dropoff && <span className="block truncate text-xs">{pickup.label} → {viaStop ? `${viaStop.label} → ` : ''}{dropoff.label}</span>}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-accent">{t('booking.sheet.expand')} ▲</span>
                  </span>
                ) : (
                  <span className="text-xs">{t('booking.sheet.collapse')} ▼</span>
                )}
              </button>
              )}
              {(isMobile || !collapsed) && (<>
              <div ref={contentRef} className={`min-h-0 flex-1 overscroll-contain p-4 sm:p-5 ${step === 'review' ? 'pt-0 sm:pt-1' : step === 'form' && !addrOpen ? 'pt-1' : ''} ${isMobile && collapsed ? 'overflow-hidden' : 'overflow-y-auto'}`} style={{ paddingBottom: step === 'form' ? '1rem' : 'max(1rem, env(safe-area-inset-bottom))' }}>
                {step === 'form' ? (
                  /* ---- FORM (inlined so inputs keep focus across renders) ---- */
                  <div>
                    {soonRide && (
                      <button type="button" onClick={() => openRide(soonRide.id)} className="mb-3 block w-full rounded-[12px] border-2 border-accent bg-accent/10 px-3 py-2.5 text-start">
                        <div className="flex items-center justify-between gap-2 text-sm font-semibold text-accent"><span>⏰ {t('rides.prebookings.reminderTitle')}</span><span>{t('rides.prebookings.open')} ›</span></div>
                        <div className="mt-0.5 text-sm text-ink">{t('rides.prebookings.reminderBody', { time: fmt.time(soonRide.at) })}</div>
                        <div className="truncate text-xs text-muted">{soonRide.pickup} → {soonRide.dropoff}</div>
                      </button>
                    )}
                    {/* Start screen kept as compact as possible (2026-11-17) so more of the map shows. */}
                    {/* Start screen (2026-11-18): no eyebrow line, smaller title — a lower sheet, more map. */}
                    {/* Pre-booking window (2026-11-20, operator): «Запланировать» heading, then the date & time on
                        top, then the full «Откуда / Куда» box — no «Куда едем?», no tiles, no recent trips. */}
                    {when === 'SCHEDULE' ? (
                      <div data-testid="schedule-panel">
                        {/* Collapsed (2026-11-24, operator chose variant 1): no heading — the route box shows like a normal ride. */}
                        <h1 className={`mb-3 pe-12 text-xl font-bold ${peekSched ? 'hidden' : ''}`}>🕒 {t('booking.form.schedule')}</h1>
                        {join && (
                          <div className="mb-3 rounded-[12px] border border-accent/50 bg-accent/10 px-3 py-2 text-[13px] text-ink" data-testid="join-banner">
                            👥 {t('share.board.joining', { from: t(`share.zones.${join.from}` as 'share.zones.LCA'), to: t(`share.zones.${join.to}` as 'share.zones.LCA'), when: join.arrive ? t('rides.prebookings.arrive', { from: fmt.time(join.arrive.from), to: fmt.time(join.arrive.by) }) : fmt.dateTime(join.at) })}
                            <button type="button" className="ms-2 text-xs text-muted underline" onClick={() => setJoin(null)}>{t('share.board.cancelJoin')}</button>
                            {pickup && dropoff && (shareZone(pickup) !== join.from || shareZone(dropoff) !== join.to) && <span className="mt-1 block font-semibold text-warn" data-testid="join-mismatch">{t('share.board.joinMismatch')}</span>}
                          </div>
                        )}
                        <div className="mb-3" />
                      </div>
                    ) : (
                      <>
                        {!peekRoute && addrOpen && <p className="label">{t('booking.form.eyebrow')}</p>}
                        {!peekRoute && <h1 className={!addrOpen ? 'mb-2 text-lg font-bold leading-6' : 'mb-4 mt-1 text-2xl font-bold'}>{t('booking.form.title')}</h1>}
                      </>
                    )}

                    {flash && <p role="status" className="mb-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{flash}</p>}
                    {banner && <p className="mb-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}

                    {/* Addresses (2026-11-15): one box like the route editor — no «Откуда/Куда» labels, a dot per
                        point (lime ring = from, amber square = stop, lime disc = to) joined by a line. Tapping a
                        row opens the route editor; «На карте» per row; ≡ drags a row to reorder the route. */}
                    {(() => {
                      const addrOpen = addrOpenState || when === 'SCHEDULE'; // the pre-booking window always shows both rows
                      const shown: Slot[] = addrOpen ? slots : ['d'];
                      const rowErr = (s: Slot) => (s === 'p' ? errors.pickup : s === 'd' ? errors.dropoff : errors.stop);
                      const anyErr = shown.map(rowErr).filter(Boolean) as string[];
                      return (
                        <div>
                          <div className="flex items-center gap-1.5">
                          <div data-route-box className={`relative min-w-0 flex-1 rounded-[14px] border bg-elevated px-3 ${anyErr.length ? 'border-danger' : 'border-edge-strong'}`}>
                            {shown.length > 1 && <span aria-hidden className="absolute start-[19px] w-[2px]" style={{ top: 26, height: (shown.length - 1) * 53, background: 'rgba(200,255,70,0.45)' }} />}
                            {shown.map((slot, i) => {
                              const v = slotGet(slot);
                              const dragging = rowDrag?.index === i;
                              const kind = !addrOpen ? 'd' : slot;
                              return (
                                <div key={slot} ref={(el) => { rowEls.current[i] = el; }}
                                  className={`relative flex ${addrOpen ? 'h-[52px]' : 'h-[44px]'} items-center gap-2.5 ${i ? 'border-t border-white/[0.08]' : ''} ${dragging ? 'z-20 rounded-[10px] bg-panel opacity-95' : ''}`}
                                  style={dragging && rowDrag ? { transform: `translateY(${rowDrag.dy}px)` } : undefined}>
                                  <span className="relative z-10 flex w-4 shrink-0 justify-center" aria-hidden>
                                    {kind === 'p' ? <span className="block h-3.5 w-3.5 rounded-full border-[3px] border-accent bg-elevated" />
                                      : kind === 's' ? <span className="block h-3 w-3 rounded-[3px] bg-[#FFC83D]" />
                                      : <span className="block h-3.5 w-3.5 rounded-full bg-accent" />}
                                  </span>
                                  <input
                                    readOnly
                                    value={v.text}
                                    placeholder={kind === 'p' ? t('booking.places.pickupPlaceholder') : kind === 's' ? t('booking.places.stopPlaceholder') : t('booking.places.destinationPlaceholder')}
                                    aria-label={kind === 'p' ? t('booking.places.pickupAria') : kind === 's' ? t('booking.places.stopAria') : t('booking.places.destinationAria')}
                                    aria-invalid={!!rowErr(slot)}
                                    onFocus={() => openEditor(slot)}
                                    onClick={() => openEditor(slot)}
                                    className={`h-full min-w-0 flex-1 cursor-pointer truncate bg-transparent ${addrOpen ? 'text-[16px]' : 'text-[15px]'} text-ink placeholder:text-muted`}
                                    style={{ outline: 'none', boxShadow: 'none', border: 0 }}
                                  />
                                  {/* No «pick on the map» button here (2026-11-17): it lives in the route editor
                                      that opens when you tap a field. */}
                                  {/* Schedule = a separate function (2026-11-17): a clock pill only on the start
                                      screen's single «Пункт назначения» row, parted by a divider; shows the time once set. */}
                                  {i === 0 && !addrOpen && (
                                    <>
                                      <span aria-hidden className="h-7 w-px shrink-0 bg-white/15" />
                                      <button type="button" data-testid="schedule-chip"
                                        aria-label={t('booking.form.schedule')} title={t('booking.form.schedule')}
                                        // Opens the pre-booking window (2026-11-20); its ✕ brings the start screen back.
                                        onClick={() => { setWhen('SCHEDULE'); setCollapsed(false); }}
                                        className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-edge-strong px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-accent/60">
                                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                                        {t('booking.form.schedule')}
                                      </button>
                                    </>
                                  )}
                                  {slot === 's' && (
                                    <button type="button" aria-label={t('booking.form.removeStop')} onClick={() => { setHasStop(false); setStop(null); setStopText(''); }}
                                      className="flex h-9 w-7 shrink-0 items-center justify-center rounded-[8px] text-lg text-muted hover:text-danger">×</button>
                                  )}
                                  {slot !== 's' && shown.includes('s') && <span className="w-7 shrink-0" aria-hidden /> /* keep the map icons in one column */}
                                  {addrOpen && shown.length > 2 && (
                                    <button type="button" aria-label={t('booking.form.dragToReorder')}
                                      onPointerDown={(e) => onDragStart(e, i)} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
                                      className="flex h-9 w-6 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-[8px] text-lg text-muted hover:bg-panel">≡</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {shown.length === 2 && (
                            <button type="button" onClick={swapRoute} aria-label={t('booking.route.swap')} title={t('booking.route.swap')}
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-white/5">
                              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 4v15M4.5 7.5 8 4l3.5 3.5M16 20V5M12.5 16.5 16 20l3.5-3.5" /></svg>
                            </button>
                          )}
                          </div>
                          {anyErr.map((e) => <p key={e} className="mt-1 text-xs text-danger">{e}</p>)}
                          {/* Quick picks under «Пункт назначения» (2026-11-17). 2026-11-20 (operator): no recent trips
                              here; Home / Work as bigger tiles, then every other saved place as a tile of the same
                              size (the row scrolls sideways when they do not fit), and a smaller «Ещё» that is
                              always there at the end — it never scrolls away however many places are saved. */}
                          {!addrOpen && passenger && !dropoff && (() => {
                            const custom = places.custom ?? [];
                            const fill = custom.length === 0; // only Home + Work: they share the row
                            const tile = `flex h-[58px] select-none flex-col items-center justify-center gap-0.5 rounded-[14px] px-2 text-[13px] [-webkit-touch-callout:none] ${fill ? 'min-w-0 flex-1' : 'w-[96px] shrink-0'}`;
                            return (
                            <div className="mt-2 flex gap-2" data-testid="quick-picks">
                              <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
                                {([['home', '🏠', places.home], ['work', '💼', places.work]] as const).map(([k, ic, pl]) => (
                                  pl ? (
                                    <button key={k} type="button" data-testid={`quick-${k}`} title={`${pl.label} · ${t('booking.form.holdToEdit')}`} {...holdProps(k === 'home' ? 'HOME' : 'WORK')}
                                      onClick={() => { if (held.current) { held.current = false; return; } pickQuick(pl); }}
                                      className={`${tile} border border-edge-strong bg-white/[0.04] text-ink hover:border-accent/60`}>
                                      <span aria-hidden className="text-[18px] leading-none">{ic}</span><span className="max-w-full truncate">{t(`booking.form.${k}`)}</span>
                                    </button>
                                  ) : (
                                    <button key={k} type="button" data-testid={`quick-${k}`} onClick={() => setSavedSheet({ type: 'set', kind: k === 'home' ? 'HOME' : 'WORK' })}
                                      className={`${tile} border border-dashed border-edge text-muted hover:border-accent/60`}>
                                      {/* Not saved yet: the same 🏠 / 💼 (2026-11-20, operator; no «+» badge), dashed frame. */}
                                      <span aria-hidden className="text-[18px] leading-none">{ic}</span>
                                      <span className="max-w-full truncate">{t(`booking.form.${k}`)}</span>
                                    </button>
                                  )
                                ))}
                                {custom.map((c) => (
                                  <button key={c.id} type="button" data-testid="quick-custom" title={c.label} onClick={() => pickQuick(c)}
                                    className={`${tile} border border-edge-strong bg-white/[0.04] text-ink hover:border-accent/60`}>
                                    <span aria-hidden className="text-[18px] leading-none">📍</span><span className="max-w-full truncate">{c.name}</span>
                                  </button>
                                ))}
                              </div>
                              {/* «Ещё»: the full list — every saved place, add / edit, recent trips and search. */}
                              <button type="button" data-testid="quick-more" onClick={() => setSavedSheet({ type: 'list' })}
                                className="flex h-[58px] w-[58px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[14px] border border-edge-strong text-[11px] text-ink hover:border-accent/60">
                                <span aria-hidden className="text-[14px] leading-none text-muted">•••</span><span className="max-w-full truncate px-1">{t('booking.form.more')}</span>
                              </button>
                            </div>
                            );
                          })()}
                          {addrOpen && !hasStop && (
                            <span className="relative inline-block">
                            <button type="button" className="chip mt-2 hover:border-accent/50" data-testid="add-stop" onClick={() => { if (when === 'SCHEDULE' && shareOn) { setStopWarn(true); return; } setHasStop(true); openEditor('s'); }}>＋ {t('booking.form.addStop')}</button>
                            {stopWarn && <RedBubble text={t('share.booking.stopBlocked')} testid="stop-blocked" />}
                            </span>
                          )}
                        </div>
                      );
                    })()}


                    {/* No «Сейчас / Запланировать» switch (2026-11-17): a ride is «now» unless the clock pill
                        in the address box is used; its panel has a way back to «now». */}
                    <div className="mt-3">
                      {/* «Попутчик» in the pre-booking window (2026-11-20, operator): always shown there — greyed with
                          the list of places until the route is one where ride-share works. */}
                      {when === 'SCHEDULE' && cfg?.share && (
                        <div className="-mt-4 mb-3">
                          <ShareBookingOptions value={shareOpts} onChange={setShareOpts} pct={cfg.share.discountPct} maxPeople={maxPax} prebook blockMsg={viaStop && shareRouteOk ? t('share.booking.shareBlocked') : null} arrive={shareOn ? shareTermsBox : undefined} disabled={!shareAllowed && !(viaStop && shareRouteOk)} />
                        </div>
                      )}
                      {/* Under the «Попутчик» switch: with a co-rider «Когда вам нужно быть на месте?» (window); without — «Во сколько подать машину?» (2026-11-23, operator). */}
                      {when === 'SCHEDULE' && (
                        <div className="mb-3 rounded-[12px] border border-edge bg-elevated px-3 py-2.5" data-testid="schedule-arrive">
                          <p className="label mb-1">{arriveOn ? (departMode ? t('booking.slots.label') : t('share.booking.arriveTitle')) : t('booking.pickupAt.title')}</p>
                          {arriveOn ? arriveBox : pickupBox}
                        </div>
                      )}
                      {when === 'SCHEDULE' && (
                        /* Pre-booking note: flight number, meeting point and bags are written here for the driver. */
                        <div className="rounded-[12px] border border-edge bg-elevated px-3 py-2.5">
                          <label className="label" htmlFor="bk-note">{t('booking.options.noteLabel')}</label>
                          <textarea id="bk-note" className="field mt-1 min-h-[44px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder={t('booking.options.notePlaceholder')} />
                        </div>
                      )}
                    </div>

                    {/* No trip-info box (time / km / tariff note) on the form any more (2026-11-16) — only an
                        error line if the price could not be calculated. */}
                    {pickup && dropoff && !quote && quoteErr && (
                      <div className="mt-3 text-xs text-warn">{t('booking.trip.quoteFailed', { error: quoteErr })}</div>
                    )}

                    {passenger && !passenger.guest && (
                      <div className="mt-4 rounded-[12px] border border-edge bg-elevated px-3 py-2.5">
                        <label className="label" htmlFor="bk-name">{t('booking.contact.driverAsksFor')}</label>
                        <input id="bk-name" className={`field mt-1 ${errors.name ? 'border-danger' : ''}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" placeholder={t('booking.contact.namePlaceholder')} />
                        {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
                        {passenger.phone ? (
                          <p className="mt-2 text-xs text-muted">{withSlot(t('booking.contact.callYou'), 'phone', <span className="text-ink">{passenger.phone}</span>)}</p>
                        ) : (
                          <>
                            <label className="label mt-3 block" htmlFor="bk-phone">{t('booking.contact.phoneLabel')}</label>
                            <input id="bk-phone" type="tel" className={`field mt-1 ${errors.phone ? 'border-danger' : ''}`} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={25} autoComplete="tel" inputMode="tel" placeholder="+357…" />
                            {errors.phone ? <p className="mt-1 text-xs text-danger">{errors.phone}</p> : <p className="mt-1 text-xs text-muted">{t('booking.contact.phoneHint')}</p>}
                          </>
                        )}
                      </div>
                    )}

                  </div>
                ) : (
                  /* ---- REVIEW / PRE-BOOKING DONE ---- */
                  step === 'scheduled' ? (
                    <div className="text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-2xl text-accent">✓</div>
                      <h2 className="mt-3 text-xl font-bold">{t('booking.prebooked.title')}</h2>
                      <p className="mt-1 text-sm text-muted">{t('booking.prebooked.when', { when: wallText(doneAt ?? '') })}</p>
                      <p className="mt-2 text-sm text-muted">{t('booking.prebooked.body')}</p>
                      {joinResult && <p role="status" data-testid="join-result" className={`mt-3 rounded-[12px] border px-3 py-2 text-sm ${joinResult.ok ? 'border-accent/40 bg-accent/10 text-accent' : 'border-warn/40 bg-warn/10 text-warn'}`}>{joinResult.text}</p>}
                      <div className="mt-5 space-y-2">
                        <button className="btn-primary w-full" onClick={orderAnother}>{t('booking.prebooked.another')}</button>
                        <div className="grid grid-cols-2 gap-2">
                          <a href="/rides" className="btn-ghost w-full">{t('booking.prebooked.myRides')}</a>
                          <a href="/track" className="btn-ghost w-full">{t('booking.prebooked.open')}</a>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div>
                    <button className="mb-1 text-sm text-muted hover:text-ink" onClick={() => setStep('form')}>{t('booking.review.edit')}</button>
                    {banner && <p className="my-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}
                    {/* Review = just the class choice and the order button (2026-11-16): the route is on the map
                        above the (now content-high) sheet. Only a scheduled time or a missing quote still gets a row. */}
                    {(when !== 'NOW' || !quote) && (
                      <div className="mt-1 space-y-3 text-sm">
                        {when !== 'NOW' && <Row label={t('booking.review.when')} value={wallText(scheduledAt)} />}
                        {!quote && <Row label={t('booking.review.fare')} value={t('booking.review.fareByMeter')} />}
                      </div>
                    )}
                    {classPicker}
                    {/* Pre-bookings set «Попутчик» in the pre-booking window itself (2026-11-20). */}
                    {shareAllowed && cfg?.share && when !== 'SCHEDULE' && (
                      <ShareBookingOptions value={shareOpts} onChange={setShareOpts} pct={cfg.share.discountPct} maxPeople={maxPax} />
                    )}
                    {ambiguous ? (
                      <div className="mt-4 rounded-[12px] border border-warn/40 bg-warn/10 p-3">
                        <p className="text-sm text-warn">{t('booking.review.ambiguousPrompt')}</p>
                        <div className="mt-2 grid gap-2">
                          {ambiguous.map((off) => {
                            const hrs = Number(off) / 60;
                            return (
                              <button
                                key={off}
                                className="btn-ghost w-full text-sm"
                                disabled={submitting}
                                onClick={() => { setScheduleOffsetMin(Number(off)); setAmbiguous(null); submit(Number(off)); }}
                              >
                                {t(hrs >= 3 ? 'booking.review.ambiguousEarlier' : 'booking.review.ambiguousLater', { time: scheduledAt.replace('T', ' '), offset: hrs })}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <button className="btn-primary mt-4 w-full" onClick={() => submit()} disabled={submitting}>{submitting ? t('booking.review.sending') : quote ? t('booking.cta.requestClass', { vClass: t(`common.vClass.${vClass}`) }) : t('booking.review.confirm')}</button>
                    )}
                  </div>
                  )
                )}
              </div>
              {step === 'form' && (!collapsed || peekRoute) && (
                // Sticky call to action: always visible without scrolling the form (2026-10-01 audit);
                // also in the collapsed sheet once the route is set (2026-11-15).
                <div ref={footerRef} className="shrink-0 border-t border-edge p-3 sm:p-4" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                  <button className="btn-primary w-full" onClick={toReview}>
                    {/* No price on the order buttons (2026-11-16): the ranges are on the class cards. */}
                    {t('booking.cta.request')}
                  </button>
                  {!passenger && pickup && dropoff && <p className="mt-2 text-center text-xs text-muted">{t('booking.cta.signInFirst')}</p>}
                </div>
              )}
              </>)}
            </div>
          </div>
        </div>
      </div>

      {picker && (
        <AutoMapPicker
          kind={picker}
          initial={picker === 'pickup' ? pickup : dropoff}
          fallback={picker === 'pickup' ? (dropoff ?? null) : (pickup ?? null)}
          onConfirm={onPickerConfirm}
          onCancel={() => setPicker(null)}
        />
      )}

      {showLogin && (
        <PassengerLoginModal
          // Signing in with Google leaves the page: keep the route + class so the form comes back filled (the same
          // hand-over «Заказать ещё раз» uses).
          onBeforeLeave={() => { try { if (pickup && dropoff) sessionStorage.setItem('il-y-repeat', JSON.stringify({ p: pickup, d: dropoff, s: hasStop ? stop : null, c: vClass })); } catch { /* storage blocked */ } }}
          onClose={() => { setShowLogin(false); pendingSubmitActive.current = false; pendingReview.current = false; }}
          onDone={(p) => {
            setShowLogin(false);
            setPassenger(p);
            setPhone((cur) => cur || p.phone || '');
            if (p.name) setName((cur) => cur || p.name!);
            loadPassenger();
            if (pendingSubmitActive.current) { pendingSubmitActive.current = false; submit(pendingSubmit.current); }

          }}
        />
      )}
    </div>
  );
}


function Row({ label, value, dot }: { label: string; value: string; dot?: 'accent' | 'ink' }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-edge/60 pb-2">
      <span className="flex items-center gap-2 text-muted">
        {dot && <span className={`inline-block h-2 w-2 rounded-full ${dot === 'accent' ? 'bg-accent' : 'bg-ink'}`} />}
        {label}
      </span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}

// Car class pictures (2026-11-15): own drawings — for Comfort a white sedan in a three-quarter view
// with a dark panoramic glass roof (the style the user picked), for XL a minibus side view.
function CarClassIcon({ kind, active }: { kind: 'sedan' | 'minibus'; active: boolean }) {
  const body = active ? '#C8FF46' : '#D9DFDC';
  const glass = '#1B2427';
  if (kind === 'sedan') {
    return (
      <svg viewBox="0 0 64 34" width="64" height="34" aria-hidden className="shrink-0">
        <ellipse cx="33" cy="30" rx="28" ry="2.6" fill="rgba(0,0,0,.35)" />
        <path d="M3.5 19.5C3.5 16.8 5 15.2 8 14.6L20 12.6C25 9.2 30.5 7.6 36.5 7.8C42.5 8 47.5 10.4 51.5 13.6L57.5 15.6C60.5 16.6 61.8 18.6 61.6 21.4L61.2 24.8C61 26.4 59.8 27.4 58.2 27.4H8.4C5.6 27.4 3.5 25.6 3.5 23Z" fill="#F3F5F6" />
        <path d="M3.6 21.5C14 22.6 30 23.2 61.4 22.4L61.2 24.8C61 26.4 59.8 27.4 58.2 27.4H8.4C5.6 27.4 3.5 25.6 3.5 23Z" fill="#DCE1E4" />
        <path d="M14.5 13.6C20 9.6 27.5 7.8 35.5 8.2C43 8.6 48.6 11.4 52.8 15C46 15.6 38 15.8 30 15.6C24 15.4 18.5 14.8 14.5 13.6Z" fill="#1C2633" />
        <path d="M17 13.2C23 10.6 29 9.6 35 9.8" stroke="#3A4A5C" strokeWidth=".7" fill="none" strokeLinecap="round" />
        <path d="M24.6 16.4 25.4 24.6M38 16.7 38.2 24.8" stroke="#C9CFD3" strokeWidth=".6" />
        <path d="M27.8 18.4h2.6M41 18.6h2.6" stroke="#B8BEC2" strokeWidth=".8" strokeLinecap="round" />
        <path d="M52.6 18.4C55.6 18.2 58.4 17.6 60.8 16.8" stroke={active ? '#C8FF46' : '#9EDCFF'} strokeWidth="1.1" strokeLinecap="round" fill="none" />
        <path d="M52.8 24.6C56 24.4 58.6 24 60.9 23.3" stroke="#262C31" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <path d="M3.9 16.6 6.6 16" stroke="#FF5A4E" strokeWidth="1.2" strokeLinecap="round" />
        {([[15.5, 26.2, 5], [48.5, 26.6, 5.2]] as const).map(([x, y, r]) => (
          <g key={x}><circle cx={x} cy={y} r={r} fill="#15191C" /><circle cx={x} cy={y} r={r * 0.52} fill="#3A4248" /><circle cx={x} cy={y} r=".9" fill="#8A9490" /></g>
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 30" width="64" height="30" aria-hidden className="shrink-0">
      <path d="M3 22.5V9.2C3 6.3 5.3 4 8.2 4h37.6c2 0 3.8 1 4.9 2.7l6.6 9.4 3 1.1c1 .4 1.7 1.3 1.7 2.4v2.9z" fill={body} />
      <path d="M8 8h7.5v6H8zM18 8h7.5v6H18zM28 8h7.5v6H28zM38 8h7c.9 0 1.6.4 2.1 1.1l3.4 4.9H38z" fill={glass} />
      <rect x="3" y="17.5" width="2.6" height="2" rx=".8" fill="#FF6B5A" />
      <rect x="58.4" y="18" width="2.8" height="1.6" rx=".8" fill="#FFF3B0" />
      {[14.5, 49].map((x) => (
        <g key={x}><circle cx={x} cy="22.5" r="5.2" fill="#0F1517" /><circle cx={x} cy="22.5" r="2.2" fill="#8A9490" /></g>
      ))}
    </svg>
  );
}

// Arrival-window time field (2026-11-22): fits its column on iPhone; a grey «00:00» until a time is chosen.
function TimeBox({ label, testid, value, onChange, bad }: { label: string; testid: string; value: string; onChange: (v: string) => void; bad: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <span className="relative mt-1 block">
        <input type="time" step={300} data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}
          className={`peer field block w-full min-w-0 max-w-full appearance-none !min-h-[44px] !px-2 !py-2 text-center text-base ${!value ? 'text-transparent focus:text-ink' : ''} ${bad ? 'border-danger' : ''}`} />
        {!value && <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-base text-muted/50 peer-focus:hidden" data-testid={`${testid}-empty`}>00:00</span>}
      </span>
    </label>
  );
}
