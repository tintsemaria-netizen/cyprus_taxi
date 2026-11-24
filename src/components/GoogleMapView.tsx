'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps, MAP_ID } from '@/lib/google-maps';
import { CYPRUS_BOUNDS } from '@/lib/config';
import type { MapMarker } from './MapView';
import { pinPoint, fitKeyOf, safePadding } from './mapFit';
import { vehicleMarkerEl, orientVehicle, steerVehicle, bearing, personMarkerEl, pickupPinEl, navArrowEl, numberedStopEl, spotEl } from './carMarker';
import { distanceM } from '@/lib/gpsFilter';
import { useIdleReturn } from './useIdleReturn';
import { useTwoFingerCamera } from './useTwoFingerCamera';
import { glidePath } from './routeGlide';
import { smoothRoute } from './routeSmooth';
import { compassEl, easeHeadingToNorth } from './mapCompass';
import { useT } from '@/i18n/I18nProvider';
import { currentTheme } from '@/lib/theme';

interface Props {
  markers?: MapMarker[];
  route?: [number, number][]; // [lng, lat]
  /** Frame the whole route line too, and re-frame when it changes (booking preview). */
  fitRoute?: boolean;
  /** Live trip (2026-11-18): keep the car, the stops and the route ahead in view, re-framing smoothly
   *  only when something leaves the view or the route got much shorter (no jumps on every GPS fix). */
  keepInView?: boolean;
  center?: { lat: number; lng: number };
  zoom?: number;
  /** Zoom for a single point / the focus point (default 16 = street level; 13 ≈ half a city). */
  focusZoom?: number;
  interactive?: boolean;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  className?: string;
  // Padding (px) so fitted content lands in the VISIBLE area (e.g. above a mobile
  // booking sheet or beside a desktop side panel).
  fitPadding?: { top: number; right: number; bottom: number; left: number };
  // Live on-duty cars to overlay (anonymized). Rendered but NOT included in the fit.
  fleet?: { lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' }[];
  /** Driver's map (2026-11-19): other cars drawn like the driver's own car, lighter and 35 % smaller. */
  fleetLikeSelf?: boolean;
  /** Route line width in px (default 7; driver navigation 8 = +15 %, 2026-11-19). */
  routeWidth?: number;
  /** Shaded areas, e.g. a pickup territory (2026-11-24): [lat, lng] rings. */
  areas?: { id: string; polygon: [number, number][]; color: string }[];
  // Zoom the map to this point (e.g. the passenger's detected location), padding-aware.
  focus?: { lat: number; lng: number } | null;
  // Navigation camera: keep this point centred, rotated to `heading` (heading-up), with tilt.
  // While set, the auto-fit/focus framing is suspended. Dragging the map calls onFollowBreak.
  follow?: { lat: number; lng: number; heading: number; zoom?: number; tilt?: number } | null;
  idleReturnMs?: number;
  /** Called when the map returns to its automatic view after idleReturnMs (e.g. resume follow). */
  onIdleReturn?: () => void;
  onFollowBreak?: () => void;
  /** Bump to bring the camera back to its automatic view (focus point / route) — «my location» button. */
  recenterTick?: number;
  /** Leave the camera where the passenger put it (a pickup point's logo is a map marker, 2026-11-24). */
  holdCamera?: boolean;
  /** Called when a re-centre glide (recenterTick) has reached its end. */
  onGlideEnd?: () => void;
  /** Duration of a re-centre glide (recenterTick), ms. Default 700. */
  glideMs?: number;
  /** The user dragged the map by hand. */
  onUserMove?: () => void;
  /** Centre-pin pick (2026-11-23): after the user moves the map by hand and it stops, the point under the
   *  centre pin (pinPoint of fitPadding). */
  onCenterPick?: (p: { lat: number; lng: number; zoom: number }) => void;
}

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };

// Frame a single point into the VISIBLE area (respecting fitPadding so it isn't hidden
// behind the booking sheet/side panel) at street-level zoom.
// Exact zoom with the point centred in the visible area (between the overlays), not a fitted
// box: fitBounds with a big box landed below the wanted zoom on narrow phones, so the map looked
// zoomed out / scaled instead of moving closer to the car (2026-11-16).
function centerPointAt(map: any, lat: number, lng: number, pad: any, zoom: number, animateMs = 0, onDone?: () => void) {
  const p = typeof pad === 'number' ? { top: pad, right: pad, bottom: pad, left: pad } : pad;
  const dx = ((p.right ?? 0) - (p.left ?? 0)) / 2, dy = ((p.bottom ?? 0) - (p.top ?? 0)) / 2;
  // One exact camera move (2026-11-24): the point lands between the overlays without a jump to the
  // middle and an animated pan back — after the centre-pin pick the map must not shift under the logo.
  const proj = map.getProjection?.(), g = (window as any).google?.maps;
  if (proj && g?.Point) {
    const w = proj.fromLatLngToPoint(new g.LatLng(lat, lng)), scale = 2 ** zoom;
    const c = proj.fromPointToLatLng(new g.Point(w.x + dx / scale, w.y + dy / scale));
    const cur = map.getCenter?.();
    const z0 = map.getZoom?.() ?? zoom;
    if (cur && Math.abs(z0 - zoom) < 1e-6 && Math.abs(cur.lat() - c.lat()) < 1e-7 && Math.abs(cur.lng() - c.lng()) < 1e-7) { onDone?.(); return; } // already there
    cancelAnimationFrame(map.__ilyCam ?? 0);
    if (!animateMs || !cur) { map.moveCamera({ center: { lat: c.lat(), lng: c.lng() }, zoom }); onDone?.(); return; }
    // Glide back (2026-11-24: the red logo «returns» from the sea instead of the map jumping).
    const from = { lat: cur.lat(), lng: cur.lng(), zoom: z0 }, to = { lat: c.lat(), lng: c.lng(), zoom }, t0 = performance.now();
    const step = (now: number) => {
      // Ease in and out: a long zoom-in starts gently instead of rushing in (2026-11-24, operator).
      const k = Math.min(1, (now - t0) / animateMs), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      map.moveCamera({ center: { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e }, zoom: from.zoom + (to.zoom - from.zoom) * e });
      if (k < 1) map.__ilyCam = requestAnimationFrame(step);
      else onDone?.();
    };
    map.__ilyCam = requestAnimationFrame(step);
    return;
  }
  map.moveCamera({ center: { lat, lng }, zoom });
  if (dx || dy) map.panBy(Math.round(dx), Math.round(dy));
}
function framePoint(map: any, g: any, lat: number, lng: number, pad: any, maxZoom = 16) {
  // ~650m half-box → street zoom at 16; each zoom level out doubles the box (zoom 13 ≈ half a city).
  const d = 0.006 * 2 ** Math.max(0, 16 - maxZoom);
  const b = new g.LatLngBounds();
  b.extend({ lat: lat - d, lng: lng - d });
  b.extend({ lat: lat + d, lng: lng + d });
  map.fitBounds(b, pad);
  g.event.addListenerOnce(map, 'idle', () => {
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
  });
}
const COLORS = { pickup: '#C8FF46', dropoff: '#F5F7F6', vehicle: '#C8FF46', stop: '#FFC83D', person: '#4C9AFF', spot: '#4C9AFF' };

// Google AdvancedMarkerElement anchors its content at the BOTTOM-centre, but our markers (cars,
// dots) are drawn centred on their point. Without this shift a 84 px car was drawn 42 px north
// of its real GPS position — a few metres when zoomed in, hundreds of metres (the neighbouring
// street) at the normal zoom (bug 2026-11-14). MapLibre anchors at the centre already.
function centerOnPoint(el: HTMLElement): HTMLElement {
  el.style.transform = 'translateY(50%)';
  return el;
}

function markerEl(mk: MapMarker): HTMLElement {
  if (mk.kind === 'vehicle' && mk.nav) {
    const el = navArrowEl({ moving: mk.moving, stale: mk.stale, title: mk.label });
    el.dataset.sig = 'nav';
    return centerOnPoint(el);
  }
  if (mk.kind === 'vehicle') {
    const el = vehicleMarkerEl({ state: mk.self ? 'self' : mk.busy ? 'busy' : 'available', stale: mk.stale, title: mk.label || 'Your driver', tag: mk.tag });
    el.dataset.sig = `${mk.busy ? 1 : 0}|${mk.tag ?? ''}`;
    el.classList.add('ily-vehicle');
    return centerOnPoint(el);
  }
  if (mk.kind === 'spot') { const el = spotEl({ name: mk.label ?? '', active: mk.active }); el.dataset.sig = `spot|${mk.active ? 1 : 0}|${mk.label ?? ''}`; return el; }
  if (mk.num != null && mk.kind !== 'person') return centerOnPoint(numberedStopEl({ num: mk.num, kind: mk.kind, next: mk.next, title: mk.label }));
  if (mk.kind === 'person') return centerOnPoint(personMarkerEl({ title: mk.label, stale: mk.stale }));
  // Pin: the needle tip (element bottom) is the point — Google's default bottom anchor, no shift.
  if (mk.kind === 'pickup') { const el = pickupPinEl({ title: mk.label, stale: mk.stale, pulse: mk.pulse }); el.dataset.sig = mk.pulse ? 'pulse' : 'pin'; return el; }
  const el = document.createElement('div');
  el.style.cssText = `width:18px;height:18px;border-radius:50px;background:${COLORS[mk.kind]};border:2px solid #0d1608;box-shadow:0 0 0 3px rgba(200,255,70,0.25);opacity:${mk.stale ? 0.5 : 1};display:flex;align-items:center;justify-content:center;font-size:14px`;
  el.title = mk.label || mk.kind;
  return centerOnPoint(el);
}

/** Fitting never zooms out past the whole island. */
const MIN_FIT_ZOOM = 8;

export default function GoogleMapView({ markers = [], route, center, zoom = 9, interactive = true, onMapClick, className, fitPadding, fitRoute, keepInView, fleet = [], fleetLikeSelf, routeWidth = 7, areas = [], focus, focusZoom, follow, onFollowBreak, recenterTick = 0, glideMs = 700, holdCamera = false, onGlideEnd, onUserMove, idleReturnMs, onIdleReturn, onCenterPick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const lastUpd = useRef(new Map<string, number>());
  const lastFollowAt = useRef(0);
  // Bold route line with rounded bends (2026-11-17); the car glides along the same drawn line.
  const shownRoute = useMemo(() => smoothRoute(route), [route]);
  const routeRef = useRef(shownRoute);
  routeRef.current = shownRoute;
  // Reconcile markers by id (no recreation flicker) and remember each one's logical
  // position so a vehicle marker can be tweened between GPS samples.
  const markerMap = useRef<Map<string, any>>(new Map());
  const posMap = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const animMap = useRef<Map<string, number>>(new Map());
  const fleetObjs = useRef<any[]>([]);
  const polyRef = useRef<any>(null);
  const gRef = useRef<any>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const followRef = useRef(follow);
  followRef.current = follow;
  const breakRef = useRef(onFollowBreak);
  breakRef.current = onFollowBreak;
  const userMoveRef = useRef(onUserMove);
  userMoveRef.current = onUserMove;
  const glideEndRef = useRef(onGlideEnd);
  glideEndRef.current = onGlideEnd;
  const centerPickRef = useRef(onCenterPick);
  centerPickRef.current = onCenterPick;
  const padRef = useRef(fitPadding);
  padRef.current = fitPadding;
  const camAnim = useRef<number | null>(null);
  const homeRef = useRef<{ lat: number; lng: number }>(center ?? CYPRUS_CENTER);
  // Any touch/pinch/scroll stops the navigation follow-camera at once (not only a drag) and,
  // with idleReturnMs, hands the camera back after that many ms without gestures.
  const idleReturnRef = useRef(onIdleReturn);
  idleReturnRef.current = onIdleReturn;
  const idle = useIdleReturn(containerRef, idleReturnMs, {
    onStart: () => { if (followRef.current) breakRef.current?.(); },
    // Back to the automatic view also turns a hand-rotated map back to north (follow sets its own heading).
    onReturn: () => { if (!followRef.current && mapRef.current) { const m = mapRef.current; easeHeadingToNorth(() => m.getHeading?.() ?? 0, (h) => m.setHeading?.(h)); } idleReturnRef.current?.(); },
  });
  // Two fingers zoom and rotate at once (2026-11-17).
  useTwoFingerCamera(containerRef, mapRef, interactive, { onGesture: () => { if (followRef.current) breakRef.current?.(); } });
  const { t } = useT();
  const compassLabel = useRef('');
  compassLabel.current = t('common.mapNorth');

  useEffect(() => {
    let cancelled = false;
    // Stable Map instances (created once per component) — captured for the cleanup below.
    const animCache = animMap.current;
    const markerCache = markerMap.current;
    const posCache = posMap.current;
    let ro: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !containerRef.current) return;
        gRef.current = g;
        const map = new g.Map(containerRef.current, {
          center: homeRef.current,
          zoom,
          mapId: MAP_ID || undefined,
          colorScheme: currentTheme() === 'light' ? ((g.ColorScheme && g.ColorScheme.LIGHT) || 'LIGHT') : ((g.ColorScheme && g.ColorScheme.DARK) || 'DARK'),
          disableDefaultUI: !interactive,
          clickableIcons: false,
          gestureHandling: interactive ? 'greedy' : 'none',
          // Two-finger rotation, 360° (2026-11-17). Works on vector maps (our Map ID); tilt stays ours.
          headingInteractionEnabled: interactive,
          tiltInteractionEnabled: false,
          rotateControl: false,
          keyboardShortcuts: interactive,
          fullscreenControl: false,
          // Zoom/camera buttons only with a mouse (touch → pinch); kept clear of the bottom sheets.
          zoomControl: interactive && !window.matchMedia('(pointer: coarse)').matches,
          cameraControl: false,
          zoomControlOptions: g.ControlPosition ? { position: g.ControlPosition.RIGHT_CENTER } : undefined,
          streetViewControl: false,
          mapTypeControl: false,
        });
        if (interactive && clickRef.current) {
          map.addListener('click', (e: any) => clickRef.current?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
        }
        mapRef.current = map;
        map.addListener('dragstart', () => { cancelAnimationFrame(map.__ilyCam ?? 0); userMoveRef.current?.(); if (followRef.current) breakRef.current?.(); });
        // Centre pin: only a move the user made by hand (finger / mouse / wheel) reports the point under
        // the pin, once the map has stopped and the finger is up — programmatic camera moves never do.
        {
          const box = containerRef.current!;
          let touched = false, down = false;
          const press = () => { touched = true; down = true; };
          const release = () => { down = false; };
          const wheel = () => { touched = true; };
          box.addEventListener('pointerdown', press, { passive: true });
          box.addEventListener('touchstart', press, { passive: true });
          window.addEventListener('pointerup', release, { passive: true });
          window.addEventListener('touchend', release, { passive: true });
          box.addEventListener('wheel', wheel, { passive: true });
          map.addListener('idle', () => {
            if (!touched || down || !centerPickRef.current) return;
            touched = false;
            const proj = map.getProjection?.(), c = map.getCenter?.(), z = map.getZoom?.();
            if (!proj || !c || z == null) return;
            const pt = pinPoint(padRef.current, box.clientWidth, box.clientHeight);
            const scale = 2 ** z, w = proj.fromLatLngToPoint(c);
            const ll = proj.fromPointToLatLng(new g.Point(w.x + (pt.x - box.clientWidth / 2) / scale, w.y + (pt.y - box.clientHeight / 2) / scale));
            if (ll) centerPickRef.current({ lat: ll.lat(), lng: ll.lng(), zoom: z });
          });
        }
        // Keep cars pointing along their travel direction while the map rotates (heading-up nav).
        // Compass (north button) only on maps without an automatic return — those go back to north by themselves.
        const compass = interactive && !idleReturnMs && g.ControlPosition
          ? compassEl(compassLabel.current, () => easeHeadingToNorth(() => map.getHeading?.() ?? 0, (h) => map.setHeading?.(h)))
          : null;
        if (compass) map.controls[g.ControlPosition.RIGHT_TOP].push(compass.el);
        map.addListener('heading_changed', () => { const h = map.getHeading?.() ?? 0; compass?.update(h); containerRef.current?.querySelectorAll<HTMLElement>('.ily-vehicle').forEach((el) => orientVehicle(el, h)); });
        // The map may be created before its (mobile/flex) container has its final size,
        // which leaves it painting only the background. Nudge a resize + recentre when
        // the container settles and on any later size change.
        let firstNudge = true;
        const nudge = () => {
          if (cancelled || !mapRef.current) return;
          g.event.trigger(mapRef.current, 'resize');
          // Only recentre on the very first sizing (before markers/bounds are applied),
          // so a later resize never clobbers a fitted route/markers view.
          if (firstNudge && markerMap.current.size === 0) mapRef.current.setCenter(homeRef.current);
          firstNudge = false;
        };
        ro = new ResizeObserver(nudge);
        if (containerRef.current) ro.observe(containerRef.current);
        [60, 250, 600].forEach((ms) => timers.push(setTimeout(nudge, ms)));
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      ro?.disconnect();
      timers.forEach(clearTimeout);
      animCache.forEach((id) => cancelAnimationFrame(id));
      animCache.clear();
      markerCache.clear();
      posCache.clear();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready) return;
    const incoming = new Set(markers.map((m) => m.id));

    // Remove markers that are gone.
    for (const [id, marker] of markerMap.current) {
      if (!incoming.has(id)) {
        marker.map = null;
        markerMap.current.delete(id);
        posMap.current.delete(id);
        const a = animMap.current.get(id);
        if (a) { cancelAnimationFrame(a); animMap.current.delete(id); }
      }
    }

    // Add new / update existing (tween vehicle markers between GPS samples).
    for (const mk of markers) {
      let marker = markerMap.current.get(mk.id);
      if (!marker) {
        marker = new g.marker.AdvancedMarkerElement({ map, position: { lat: mk.lat, lng: mk.lng }, content: markerEl(mk), title: mk.label, ...(mk.self ? { zIndex: 1000 } : mk.kind === 'pickup' ? { zIndex: 950 } : mk.kind === 'spot' && mk.active ? { zIndex: 940 } : mk.kind === 'person' ? { zIndex: 900 } : {}) /* brand pin over the person (2026-11-17) */ });
        if (mk.kind === 'vehicle' && mk.heading != null && marker.content) orientVehicle(marker.content as HTMLElement, map.getHeading?.() ?? 0, mk.heading);
        markerMap.current.set(mk.id, marker);
        posMap.current.set(mk.id, { lat: mk.lat, lng: mk.lng });
        continue;
      }
      marker.title = mk.label ?? '';
      // Re-render a vehicle whose plate tag or busy state changed (staff fleet map).
      const sig = mk.nav ? 'nav' : `${mk.busy ? 1 : 0}|${mk.tag ?? ''}`;
      if (mk.kind === 'pickup' && marker.content && (marker.content as HTMLElement).dataset.sig !== (mk.pulse ? 'pulse' : 'pin')) marker.content = markerEl(mk);
      // Pickup-point silhouette: the chosen one carries the name (2026-11-24).
      if (mk.kind === 'spot' && marker.content && (marker.content as HTMLElement).dataset.sig !== `spot|${mk.active ? 1 : 0}|${mk.label ?? ''}`) marker.content = markerEl(mk);
      if (mk.kind === 'vehicle' && marker.content && (marker.content as HTMLElement).dataset.sig !== sig) {
        marker.content = markerEl(mk);
        if (mk.heading != null) orientVehicle(marker.content as HTMLElement, map.getHeading?.() ?? 0, mk.heading);
      }
      // Arrow: pulse only while standing still (toggle in place — no re-create, no animation restart).
      if (mk.nav && marker.content) (marker.content as HTMLElement).classList.toggle('ily-moving', !!mk.moving);
      if (marker.content) (marker.content as HTMLElement).style.opacity = mk.stale ? '0.5' : '1';
      // Start from where the car is drawn right now (an unfinished glide must not jump).
      const drawn = marker.position as { lat: number | (() => number); lng: number | (() => number) } | null;
      const dLat = drawn ? (typeof drawn.lat === 'function' ? drawn.lat() : drawn.lat) : null;
      const dLng = drawn ? (typeof drawn.lng === 'function' ? drawn.lng() : drawn.lng) : null;
      const from = dLat != null && dLng != null ? { lat: dLat, lng: dLng } : (posMap.current.get(mk.id) ?? { lat: mk.lat, lng: mk.lng });
      const moved = Math.abs(from.lat - mk.lat) > 1e-7 || Math.abs(from.lng - mk.lng) > 1e-7;
      const prev = animMap.current.get(mk.id);
      if (prev) { cancelAnimationFrame(prev); animMap.current.delete(mk.id); }
      if (mk.kind === 'vehicle' && moved) {
        const to = { lat: mk.lat, lng: mk.lng };
        // Point the car along its travel direction relative to the (possibly rotated) map. A known
        // route heading wins; otherwise use the movement, ignoring GPS jitter under 4 m.
        const mapHeading = mapRef.current?.getHeading?.() ?? 0;
        if (marker.content) {
          if (mk.heading != null) orientVehicle(marker.content as HTMLElement, mapHeading, mk.heading);
          // No route heading: the nose is steered along the glide below (road direction).
          else if (!routeRef.current && distanceM(from, to) >= 4) orientVehicle(marker.content as HTMLElement, mapHeading, bearing(from, to));
        }
        // Economical GPS (~5 s) but smooth movement (2026-11-17): the glide lasts about as long as the
        // gap between updates, so the car keeps rolling instead of jump-and-stop, and follows the drawn
        // route line around corners.
        const start = performance.now();
        const last = lastUpd.current.get(mk.id);
        lastUpd.current.set(mk.id, start);
        const dur = last ? Math.max(900, Math.min(6000, (start - last) * 0.95)) : 900;
        const path = glidePath(from, to, routeRef.current);
        const m = marker;
        const steer = mk.heading == null && !!routeRef.current && marker.content ? (marker.content as HTMLElement) : null;
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / dur);
          const here = path(t);
          m.position = here; // linear in time = steady speed
          // Nose forward (2026-11-18): look a little ahead along the glide; ignore sub-metre wiggles.
          if (steer && t < 1) {
            const ahead = path(Math.min(1, t + 0.08));
            if (distanceM(here, ahead) > 0.8) steerVehicle(steer, mapRef.current?.getHeading?.() ?? 0, bearing(here, ahead));
          }
          if (t < 1) animMap.current.set(mk.id, requestAnimationFrame(step));
          else animMap.current.delete(mk.id);
        };
        animMap.current.set(mk.id, requestAnimationFrame(step));
        posMap.current.set(mk.id, to);
      } else {
        marker.position = { lat: mk.lat, lng: mk.lng };
        posMap.current.set(mk.id, { lat: mk.lat, lng: mk.lng });
      }
    }
  }, [markers, ready, fitPadding]);

  // Frame the view. Keyed on a signature that IGNORES vehicle movement, so a moving
  // driver dot animates freely without the map re-fitting/zooming every GPS tick — it
  // only re-frames when the stops (pickup/dropoff) or the marker set change.
  const fitKey = fitKeyOf(markers);
  // Re-frame / re-centre when the visible area changes (e.g. the sheet under the map grew or
  // shrank) or the route arrives — the whole route must fit above the sheet (2026-11-16).
  const padKey = fitPadding ? `${fitPadding.top},${fitPadding.right},${fitPadding.bottom},${fitPadding.left}` : '';
  const routeKey = fitRoute && route && route.length ? `${route.length}:${route[0].join(',')}:${route[route.length - 1].join(',')}` : '';
  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready || followRef.current || idle.active.current || holdCamera) return;
    // A focus point with its own zoom owns the camera (2026-11-17): don't fit the markers around it.
    if (focus && focusZoom != null) return;
    const box = containerRef.current?.getBoundingClientRect();
    const pad = safePadding(fitPadding ?? { top: 70, right: 70, bottom: 70, left: 70 }, box?.width ?? 0, box?.height ?? 0);
    const fm = markers.filter((m) => !m.noFit); // later stops of a shared ride are shown, not framed
    // One point + a drawn route (2026-11-19: trip in progress while the car's position is not known)
    // frames the whole route too, instead of a close-up of the destination with the line cut off.
    if (fm.length >= 2 || (fm.length === 1 && fitRoute && route && route.length > 1)) {
      const b = new g.LatLngBounds();
      fm.forEach((m) => b.extend({ lat: m.lat, lng: m.lng }));
      // The drawn route can bulge outside its end points — include it so all of it shows.
      if (fitRoute && route) route.forEach(([lng, lat]) => b.extend({ lat, lng }));
      map.fitBounds(b, pad);
      // Points very close together (driver waiting at the pickup): don't zoom in past street level.
      // …and never further out than the whole of Cyprus (2026-11-23: a tiny visible band showed the Middle East).
      g.event.addListenerOnce(map, 'idle', () => { const z = map.getZoom(); if (z > 17) map.setZoom(17); else if (z < MIN_FIT_ZOOM) map.setZoom(MIN_FIT_ZOOM); });
    } else if (fm.length === 1) {
      if (focusZoom != null) centerPointAt(map, fm[0].lat, fm[0].lng, pad, focusZoom);
      else framePoint(map, g, fm[0].lat, fm[0].lng, pad);
    } else {
      const b = new g.LatLngBounds();
      b.extend({ lat: CYPRUS_BOUNDS.south, lng: CYPRUS_BOUNDS.west });
      b.extend({ lat: CYPRUS_BOUNDS.north, lng: CYPRUS_BOUNDS.east });
      map.fitBounds(b, pad);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready, idle.returnTick, padKey, recenterTick, keepInView ? (routeKey ? 'route' : '') : routeKey]);

  // Keep-in-view camera (2026-11-18). Economical: one check per GPS update, a camera move only when a
  // point left the view (or the remaining route got much smaller), at most every 3 s, eased over 1 s.
  const keepAnim = useRef(0);
  const lastCam = useRef(0);
  useEffect(() => {
    const map = mapRef.current, el = containerRef.current;
    if (!keepInView || !map || !el || !ready || followRef.current || idle.active.current) return;
    const pts: { lat: number; lng: number }[] = markers.filter((m) => !m.noFit).map((m) => ({ lat: m.lat, lng: m.lng }));
    if (route) route.forEach(([lng, lat]) => pts.push({ lat, lng }));
    if (pts.length < 2) return;
    const pad = safePadding(fitPadding ?? { top: 70, right: 70, bottom: 70, left: 70 }, el.clientWidth, el.clientHeight);
    const W = el.clientWidth, H = el.clientHeight;
    const target = cameraFor(pts, W, H, pad);
    if (!target) return;
    const c = map.getCenter?.(); const z = map.getZoom?.();
    if (!c || z == null) return;
    const cur = { lat: c.lat(), lng: c.lng() };
    const inView = pts.every((p) => { const s = toScreen(p, cur, z, W, H); return s.x >= pad.left * 0.6 && s.x <= W - pad.right * 0.6 && s.y >= pad.top * 0.6 && s.y <= H - pad.bottom * 0.6; });
    const now = performance.now();
    if (inView && target.zoom - z < 0.6) return;
    if (inView && now - lastCam.current < 3000) return;
    lastCam.current = now;
    cancelAnimationFrame(keepAnim.current);
    const start = now, from = { ...cur, zoom: z };
    const step = (tNow: number) => {
      const k = Math.min(1, (tNow - start) / 1000), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      map.moveCamera({ center: { lat: from.lat + (target.center.lat - from.lat) * e, lng: from.lng + (target.center.lng - from.lng) * e }, zoom: from.zoom + (target.zoom - from.zoom) * e });
      if (k < 1) keepAnim.current = requestAnimationFrame(step);
    };
    keepAnim.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, route, keepInView, ready, padKey]);
  useEffect(() => () => cancelAnimationFrame(keepAnim.current), []);

  // Zoom to a focus point (the passenger's detected location) once it resolves, unless a
  // full 2-stop route is already framed. Markers that are not framed (noFit: pickup-point dots of a
  // territory, 2026-11-24) do not count — they kept the camera from moving to the chosen point.
  const focusKey = focus ? `${focus.lat.toFixed(5)},${focus.lng.toFixed(5)}` : '';
  const lastRecenter = useRef(recenterTick);
  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready || !focus || holdCamera || markers.filter((m) => !m.noFit).length >= 2 || followRef.current || idle.active.current) return;
    const fbox = containerRef.current?.getBoundingClientRect();
    const fpad = safePadding(fitPadding ?? { top: 70, right: 70, bottom: 70, left: 70 }, fbox?.width ?? 0, fbox?.height ?? 0);
    // «Моё местоположение» / back from the sea (recenterTick): glide; anything else: one exact move.
    const glide = recenterTick !== lastRecenter.current;
    lastRecenter.current = recenterTick;
    if (focusZoom != null) centerPointAt(map, focus.lat, focus.lng, fpad, focusZoom, glide ? glideMs : 0, glide ? () => glideEndRef.current?.() : undefined);
    else framePoint(map, g, focus.lat, focus.lng, fpad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, ready, idle.returnTick, padKey, recenterTick]);

  // Navigation camera: ease centre + heading toward the latest fix (shortest way round).
  const followKey = follow ? `${follow.lat.toFixed(6)},${follow.lng.toFixed(6)},${Math.round(follow.heading)},${follow.zoom ?? 17},${follow.tilt ?? 45}` : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !follow || idle.active.current) return;
    if (camAnim.current) cancelAnimationFrame(camAnim.current);
    const c0 = map.getCenter?.();
    const from = { lat: c0 ? c0.lat() : follow.lat, lng: c0 ? c0.lng() : follow.lng, heading: map.getHeading?.() ?? 0, zoom: map.getZoom?.() ?? follow.zoom ?? 17 };
    const dh = ((follow.heading - from.heading + 540) % 360) - 180;
    const far = Math.abs(from.lat - follow.lat) + Math.abs(from.lng - follow.lng) > 0.02; // > ~2 km: jump
    const zoom = follow.zoom ?? 17, tilt = follow.tilt ?? 45;
    if (far) { map.moveCamera({ center: { lat: follow.lat, lng: follow.lng }, heading: follow.heading, zoom, tilt }); return; }
    // Linear over about the gap between fixes (2026-11-17): the camera moves steadily with the car
    // instead of a quick ease and a pause after every GPS fix.
    const start = performance.now();
    const gap = lastFollowAt.current ? start - lastFollowAt.current : 800;
    lastFollowAt.current = start;
    const dur = Math.max(600, Math.min(2500, gap));
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = t;
      // Zoom eases too (speed-dependent navigation zoom, 2026-11-17) — no jumps.
      map.moveCamera({ center: { lat: from.lat + (follow.lat - from.lat) * e, lng: from.lng + (follow.lng - from.lng) * e }, heading: from.heading + dh * e, zoom: from.zoom + (zoom - from.zoom) * e, tilt });
      camAnim.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    camAnim.current = requestAnimationFrame(step);
    return () => { if (camAnim.current) cancelAnimationFrame(camAnim.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey, ready]);

  // Live on-duty cars overlay (does not affect the fit).
  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready) return;
    fleetObjs.current.forEach((m) => (m.map = null));
    fleetObjs.current = [];
    for (const v of fleet) {
      const el = vehicleMarkerEl({
        // fleet overlays: every car white (on-trip yellow is staff-only); on a driver's map the other
        // cars look like the driver's own, lighter, 35 % smaller (71 → 46 px).
        state: fleetLikeSelf ? 'peer' : 'available',
        stale: v.stale,
        size: fleetLikeSelf ? 46 : 61,
        title: v.state === 'busy' ? 'On a trip' : 'Available',
      });
      fleetObjs.current.push(new g.marker.AdvancedMarkerElement({ map, position: { lat: v.lat, lng: v.lng }, content: centerOnPoint(el), zIndex: 1 }));
    }
  }, [fleet, ready, fleetLikeSelf]);

  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready) return;
    // Update the existing line in place (no flicker while it shrinks behind the car, 2026-11-18).
    if (polyRef.current && shownRoute && shownRoute.length) { polyRef.current.setPath(shownRoute.map(([lng, lat]) => ({ lat, lng }))); return; }
    if (polyRef.current) { polyRef.current.setMap(null); polyRef.current = null; }
    if (shownRoute && shownRoute.length) {
      polyRef.current = new g.Polyline({
        path: shownRoute.map(([lng, lat]) => ({ lat, lng })),
        strokeColor: '#C8FF46',
        strokeOpacity: 0.95,
        strokeWeight: routeWidth,
        map,
      });
    }
  }, [shownRoute, ready, routeWidth]);

  // Shaded areas (pickup territory, 2026-11-24).
  const areaObjs = useRef<any[]>([]);
  const areasKey = areas.map((a) => `${a.id}:${a.polygon.length}`).join('|');
  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready) return;
    areaObjs.current.forEach((o) => o.setMap(null));
    areaObjs.current = areas.filter((a) => a.polygon.length >= 3).map((a) => new g.Polygon({ map, paths: a.polygon.map(([lat, lng]) => ({ lat, lng })), strokeColor: a.color, strokeOpacity: 0.95, strokeWeight: 4.5, fillColor: a.color, fillOpacity: 0.16, clickable: false, zIndex: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areasKey, ready]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-page text-muted ${className ?? ''}`}>
        <div className="text-center p-6">
          <div className="text-sm font-medium text-ink">Map unavailable</div>
          <div className="mt-1 text-xs">Trip details and actions still work below.</div>
        </div>
      </div>
    );
  }
  // isolation: marker z-indexes (own car 1000, person 900) stay inside the map, never above panels.
  return <div ref={containerRef} dir="ltr" className={className} style={{ isolation: 'isolate' }} aria-label="Map" role="application" />;
}

// Web-Mercator helpers for the keep-in-view camera (map not rotated, no tilt).
function worldXY(p: { lat: number; lng: number }): { x: number; y: number } {
  const s = Math.sin((Math.max(-85, Math.min(85, p.lat)) * Math.PI) / 180);
  return { x: (p.lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
}
function fromWorld(x: number, y: number): { lat: number; lng: number } {
  return { lng: x * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI };
}
function toScreen(p: { lat: number; lng: number }, center: { lat: number; lng: number }, zoom: number, W: number, H: number) {
  const a = worldXY(p), c = worldXY(center), scale = 256 * 2 ** zoom;
  return { x: W / 2 + (a.x - c.x) * scale, y: H / 2 + (a.y - c.y) * scale };
}
export function cameraFor(pts: { lat: number; lng: number }[], W: number, H: number, pad: { top: number; right: number; bottom: number; left: number }, maxZoom = 17) {
  const ws = pts.map(worldXY);
  const minX = Math.min(...ws.map((w) => w.x)), maxX = Math.max(...ws.map((w) => w.x));
  const minY = Math.min(...ws.map((w) => w.y)), maxY = Math.max(...ws.map((w) => w.y));
  const aw = Math.max(40, W - pad.left - pad.right), ah = Math.max(40, H - pad.top - pad.bottom);
  const zx = maxX > minX ? Math.log2(aw / ((maxX - minX) * 256)) : maxZoom;
  const zy = maxY > minY ? Math.log2(ah / ((maxY - minY) * 256)) : maxZoom;
  const zoom = Math.max(3, Math.min(maxZoom, zx, zy));
  const scale = 256 * 2 ** zoom;
  // Shift the centre so the content sits in the padded (visible) area.
  const cx = (minX + maxX) / 2 + (pad.right - pad.left) / 2 / scale;
  const cy = (minY + maxY) / 2 + (pad.bottom - pad.top) / 2 / scale;
  return { center: fromWorld(cx, cy), zoom };
}
