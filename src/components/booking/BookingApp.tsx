'use client';

import { useKeyboardViewport } from '@/components/useKeyboardViewport';
import { useHideClipped } from '@/components/useHideClipped';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AutoMapView, { MapMarker } from '@/components/AutoMapView';
import { Logo } from '@/components/Brand';
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
import { nicosiaInputValue } from '@/lib/timezone';
import { api, ApiRequestError, uuid } from '@/lib/api-client';
import { useT, MsgKey, translate } from '@/i18n/I18nProvider';
import { NotifyPrompt } from '@/components/NotifyPrompt';
import { ShareBookingOptions, type ShareOpts } from '@/components/share/ShareBookingOptions';
import { isShareRoute } from '@/lib/share';

interface PublicConfig {
  demoMode: boolean;
  timezone: string;
  classes: { key: 'COMFORT' | 'XL'; label: string; maxPassengers: number }[];
  schedule: { minMinutes: number; maxDays: number };
  operatorName: string | null;
  share?: { discountPct: number; defaultMaxExtraMin: number; defaultWaitMin: number };
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
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleOffsetMin, setScheduleOffsetMin] = useState<number | undefined>(undefined);
  const [ambiguous, setAmbiguous] = useState<string[] | null>(null);
  const [vClass, setVClass] = useState<'COMFORT' | 'XL'>('COMFORT');
  const [shareOpts, setShareOpts] = useState<ShareOpts>({ on: false, adults: 1, children: 0, bags: 1, maxExtra: 15, wait: 15 });
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
  const [passenger, setPassenger] = useState<{ phone: string | null; name?: string; email?: string | null } | null>(null);
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
    api<{ phone: string | null; name?: string; email?: string | null }>('/passenger/me')
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
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        setMyLoc({ lat, lng });
        if (pickupRef.current || pickupTextRef.current.trim() !== '') return; // passenger already acting
        // The stored label travels with the booking to the driver → language-neutral English; the
        // passenger sees their own language in the field.
        let label: string | null = null;
        try {
          const r = await api<{ place: { label: string } | null }>(`/places/reverse?lat=${lat}&lng=${lng}`, { timeoutMs: 6000 });
          if (r.place?.label) label = r.place.label;
        } catch { /* keep the generic label */ }
        if (cancelled || pickupRef.current || pickupTextRef.current.trim() !== '') return; // re-check after await
        setPickup({ lat, lng, label: label ?? translate('en', 'booking.currentLocation') });
        setPickupText(label ?? t('booking.currentLocation'));
        setAutoPickup(true);
        autoPickupSaved.current = { sel: { lat, lng, label: label ?? translate('en', 'booking.currentLocation') }, text: label ?? t('booking.currentLocation') };
      },
      () => { /* denied / unavailable → keep the island view + manual selection */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        h = Math.round(box.getBoundingClientRect().top - sheet.getBoundingClientRect().top + padTop + routeBox.offsetHeight + 14 + footer);
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

  // No «you are here» person on the passenger's maps (2026-11-17): only the IL-Y pickup logo.
  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (pickup) m.push({ id: 'p', lat: pickup.lat, lng: pickup.lng, kind: 'pickup', label: pickup.label });
    if (stop && hasStop) m.push({ id: 's', lat: stop.lat, lng: stop.lng, kind: 'stop', label: stop.label });
    if (dropoff) m.push({ id: 'd', lat: dropoff.lat, lng: dropoff.lng, kind: 'dropoff', label: dropoff.label });
    return m;
  }, [pickup, dropoff, stop, hasStop]);

  // The stop counts only once it has been chosen (an empty stop row is ignored).
  const viaStop = hasStop && stop ? stop : null;
  // Ride-share «Попутчик» (Task 022): airport / intercity only, no intermediate stop. When it is on,
  // the real people / bags count matters (seats and boot are shared), so they are sent and priced.
  const shareAllowed = !!(cfg?.share && pickup && dropoff && !viaStop && isShareRoute(pickup, dropoff));
  const shareOn = shareAllowed && shareOpts.on;
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
  interface QuoteBody { quoteId: string; priceType: string; totalCents: number; rangeLowCents: number; rangeHighCents: number; night: boolean; holiday: boolean; routeAvailable: boolean; airport?: boolean; lines: { code: string; label: string; cents: number }[]; }
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
    if (passenger && !name.trim()) e.name = t('booking.validation.name');
    // Email-only accounts have no verified phone: the contact number is entered per booking.
    if (passenger && !passenger.phone && !/^\+?[\d\s()-]{7,20}$/.test(phone.trim())) e.phone = t('booking.validation.phone');
    if (when === 'SCHEDULE' && !scheduledAt) e.scheduledAt = t('booking.validation.scheduledAt');
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
    if (!passenger) { pendingReview.current = true; setShowLogin(true); return; }
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
        scheduleOffsetMin: when === 'SCHEDULE' ? effOffset : undefined,
        vClass,
        passengerCount: effPax,
        luggageCount: effBags,
        quoteId: (freshQuote ?? quote)?.quoteId,
        passengerName: name.trim() || passenger?.name || 'Passenger',
        phone: passenger?.phone || phone.trim(),
        note: effNote || undefined,
        ...(shareOn ? { shareOptIn: true, shareMaxExtraMin: shareOpts.maxExtra, childCount: shareOpts.children, ...(when === 'SCHEDULE' ? { shareWaitMin: shareOpts.wait } : {}) } : {}),
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

  const classes = cfg?.classes ?? [
    { key: 'COMFORT' as const, label: 'Comfort', maxPassengers: 4 },
    { key: 'XL' as const, label: 'XL', maxPassengers: 6 },
  ];

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
                    <span className={`block font-semibold tabular-nums ${selected ? 'text-accent' : 'text-ink'}`}>{fmtRange(q)}</span>
                  </>
                ) : <span className="text-xs text-muted">{quoting ? t('booking.form.pricing') : '—'}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {errors.pax && <p className="mt-1 text-xs text-danger">{errors.pax}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={kbBox}>
      {resuming && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-page text-muted" data-testid="resuming-ride">{t('common.loading')}</div>}
      <NotifyPrompt pushUrl="/passenger/push" active={!!passenger} />
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
          canAddStop={!hasStop}
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
      <header className="z-20 flex items-center justify-between border-b border-edge bg-page/90 px-4 py-2 backdrop-blur sm:px-6" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
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
      <InstallPrompt app="passenger" className="z-20 mx-3 mt-2 sm:hidden" />

      <div className="relative flex-1">
        <div className="absolute inset-0">
          {/* The full-screen picker is its own map; unmount this background map while it's
              open (frees the WebGL context and avoids two simultaneous map instances). */}
          {picker ? (
            <div className="h-full w-full bg-page" />
          ) : (
            <AutoMapView markers={markers} route={route?.line} fitRoute fleet={fleet} fleetLikeSelf focus={pickup && dropoff ? null : myLoc} focusZoom={pickup && dropoff ? undefined : 15.49 /* 2026-11-17: 30 % further out than 16 (16 + log2 0.7) */} center={myLoc ?? { lat: 34.92, lng: 33.2 }} zoom={myLoc ? 14 : 9} interactive fitPadding={fitPadding} recenterTick={recenterTick} onUserMove={() => setMapMoved(true)} className="h-full w-full" />
          )}
        </div>

        {mapMoved && myLoc && !picker && (
          <button type="button" aria-label={t('booking.picker.myLocation')} title={t('booking.picker.myLocation')}
            onClick={() => { setMapMoved(false); setRecenterTick((n) => n + 1); }}
            className="absolute bottom-6 end-6 z-20 hidden h-10 items-center gap-2 rounded-full border border-white/15 bg-[#10191C]/95 px-3.5 text-[13px] text-white shadow-lg sm:flex">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden className="shrink-0"><circle cx="12" cy="12" r="6" /><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /></svg><span>{t('booking.picker.myLocation')}</span>
          </button>
        )}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end sm:block">
          <div ref={sheetBoxRef} className="flex h-full w-full flex-col justify-end sm:absolute sm:start-4 sm:top-4 sm:block sm:h-[calc(100%-2rem)] sm:w-[380px]">
            {mapMoved && myLoc && !picker && (
              <div className="flex shrink-0 justify-end px-3 pb-3 sm:hidden">
                <button type="button" data-testid="map-my-location" aria-label={t('booking.picker.myLocation')} title={t('booking.picker.myLocation')}
                  onClick={() => { setMapMoved(false); setRecenterTick((n) => n + 1); }}
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
              {step === 'form' && (!collapsed || peekRoute) && (addrOpen || dropoff || dropoffText) && (
                <button type="button" aria-label={t('booking.form.resetRoute')} title={t('booking.form.resetRoute')} onClick={resetRoute}
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
                    {!peekRoute && addrOpen && <p className="label">{t('booking.form.eyebrow')}</p>}
                    {!peekRoute && <h1 className={!addrOpen ? 'mb-2 text-lg font-bold leading-6' : 'mb-4 mt-1 text-2xl font-bold'}>{t('booking.form.title')}</h1>}

                    {flash && <p role="status" className="mb-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{flash}</p>}
                    {banner && <p className="mb-3 rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{banner}</p>}

                    {/* Addresses (2026-11-15): one box like the route editor — no «Откуда/Куда» labels, a dot per
                        point (lime ring = from, amber square = stop, lime disc = to) joined by a line. Tapping a
                        row opens the route editor; «На карте» per row; ≡ drags a row to reorder the route. */}
                    {(() => {
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
                                      <button type="button" data-testid="schedule-chip" role="switch" aria-checked={when === 'SCHEDULE'}
                                        aria-label={t('booking.form.schedule')} title={t('booking.form.schedule')}
                                        onClick={() => {
                                          // A switch (2026-11-17): tap again to go back to «now».
                                          if (when === 'SCHEDULE') { setWhen('NOW'); setScheduledAt(''); setScheduleOffsetMin(undefined); setAmbiguous(null); }
                                          else { setWhen('SCHEDULE'); setCollapsed(false); }
                                        }}
                                        className={`flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[13px] font-medium transition-colors ${when === 'SCHEDULE' ? 'border-accent bg-accent text-[#0d1608]' : 'border-edge-strong text-ink hover:border-accent/60'}`}>
                                        {/* The pill itself is the switch (2026-11-17): lime = on, outline = off. */}
                                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                                        {when === 'SCHEDULE' && scheduledAt ? scheduledAt.slice(11, 16) : t('booking.form.schedule')}
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
                          {/* Quick picks under «Пункт назначения» (2026-11-17): saved Home / Work / School and the
                              last three destinations — one tap sets the destination and goes on to the price. */}
                          {!addrOpen && passenger && !dropoff && (
                            <div className="mt-1.5" data-testid="quick-picks">
                              <div className="flex gap-2">
                                {([['home', '🏠', places.home], ['work', '💼', places.work]] as const).map(([k, ic, pl]) => (
                                  pl ? (
                                    <button key={k} type="button" data-testid={`quick-${k}`} title={`${pl.label} · ${t('booking.form.holdToEdit')}`} {...holdProps(k === 'home' ? 'HOME' : 'WORK')}
                                      onClick={() => { if (held.current) { held.current = false; return; } pickQuick(pl); }}
                                      className="flex h-8 min-w-0 flex-1 select-none items-center justify-center gap-1 rounded-full border border-edge-strong px-2 text-[13px] text-ink [-webkit-touch-callout:none] hover:border-accent/60">
                                      <span aria-hidden>{ic}</span><span className="truncate">{t(`booking.form.${k}`)}</span>
                                    </button>
                                  ) : (
                                    <button key={k} type="button" data-testid={`quick-${k}`} onClick={() => setSavedSheet({ type: 'set', kind: k === 'home' ? 'HOME' : 'WORK' })}
                                      className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-dashed border-edge px-2 text-[13px] text-muted hover:border-accent/60">
                                      <span aria-hidden className="text-accent">＋</span><span className="truncate">{t(`booking.form.${k}`)}</span>
                                    </button>
                                  )
                                ))}
                                {/* «Ещё» (2026-11-17): the full list — every saved place, recent trips and search. */}
                                <button type="button" data-testid="quick-more" onClick={() => setSavedSheet({ type: 'list' })}
                                  className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-edge-strong px-2 text-[13px] text-ink hover:border-accent/60">
                                  <span aria-hidden className="text-muted">•••</span><span className="truncate">{t('booking.form.more')}</span>
                                </button>
                              </div>
                              {destinations.length > 0 && (
                                <ul className="mt-1">
                                  {destinations.slice(0, 3).map((d, i) => (
                                    <li key={`${d.label}-${i}`}>
                                      <button type="button" data-testid="quick-recent" onClick={() => pickQuick(d)}
                                        className={`flex h-9 w-full items-center gap-2.5 text-start ${i ? 'border-t border-white/[0.06]' : ''}`}>
                                        <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted">
                                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{d.label}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                          {addrOpen && !hasStop && (
                            <button type="button" className="chip mt-2 hover:border-accent/50" onClick={() => { setHasStop(true); openEditor('s'); }}>＋ {t('booking.form.addStop')}</button>
                          )}
                        </div>
                      );
                    })()}


                    {/* No «Сейчас / Запланировать» switch (2026-11-17): a ride is «now» unless the clock pill
                        in the address box is used; its panel has a way back to «now». */}
                    <div className="mt-3">
                      {when === 'SCHEDULE' && (
                        <div className="rounded-[12px] border border-accent/40 bg-accent/5 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-accent">🕒 {t('booking.form.schedule')}</span>
                            {/* No «Ехать сейчас» here (2026-11-17): the «Запланировать» pill above switches it off. */}
                          </div>
                          <input type="datetime-local" className={`field block w-full min-w-0 max-w-full appearance-none ${errors.scheduledAt ? 'border-danger' : ''}`} value={scheduledAt} min={scheduleMin} onChange={(e) => { setScheduledAt(e.target.value); setScheduleOffsetMin(undefined); setAmbiguous(null); }} />
                          <p className="mt-1 text-xs text-muted">{withSlot(t('booking.form.timezoneNote'), 'tz', <strong>{cfg?.timezone ?? 'Europe/Nicosia'}</strong>)}</p>
                          {errors.scheduledAt && <p className="mt-1 text-xs text-danger">{errors.scheduledAt}</p>}
                          {/* Pre-booking note: flight number, meeting point and bags are written here for the driver. */}
                          <div className="mt-3 space-y-3 rounded-[12px] border border-edge bg-elevated px-3 py-2.5">
                            <div>
                              <label className="label" htmlFor="bk-note">{t('booking.options.noteLabel')}</label>
                              <textarea id="bk-note" className="field mt-1 min-h-[44px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder={t('booking.options.notePlaceholder')} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* No trip-info box (time / km / tariff note) on the form any more (2026-11-16) — only an
                        error line if the price could not be calculated. */}
                    {pickup && dropoff && !quote && quoteErr && (
                      <div className="mt-3 text-xs text-warn">{t('booking.trip.quoteFailed', { error: quoteErr })}</div>
                    )}

                    {passenger && (
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
                      <p className="mt-1 text-sm text-muted">{t('booking.prebooked.when', { when: (doneAt ?? '').replace('T', ' ') })}</p>
                      <p className="mt-2 text-sm text-muted">{t('booking.prebooked.body')}</p>
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
                        {when !== 'NOW' && <Row label={t('booking.review.when')} value={`${scheduledAt.replace('T', ' ')} · ${cfg?.timezone}`} />}
                        {!quote && <Row label={t('booking.review.fare')} value={t('booking.review.fareByMeter')} />}
                      </div>
                    )}
                    {classPicker}
                    {shareAllowed && cfg?.share && (
                      <ShareBookingOptions value={shareOpts} onChange={setShareOpts} pct={cfg.share.discountPct} maxPeople={maxPax} prebook={when === 'SCHEDULE'} />
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
