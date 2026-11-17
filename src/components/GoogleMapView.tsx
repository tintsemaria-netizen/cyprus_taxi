'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, MAP_ID } from '@/lib/google-maps';
import { CYPRUS_BOUNDS } from '@/lib/config';
import type { MapMarker } from './MapView';
import { fitKeyOf } from './mapFit';
import { vehicleMarkerEl, orientVehicle, bearing, personMarkerEl, pickupPinEl, navArrowEl } from './carMarker';
import { distanceM } from '@/lib/gpsFilter';
import { useIdleReturn } from './useIdleReturn';
import { compassEl, easeHeadingToNorth } from './mapCompass';
import { useT } from '@/i18n/I18nProvider';

interface Props {
  markers?: MapMarker[];
  route?: [number, number][]; // [lng, lat]
  /** Frame the whole route line too, and re-frame when it changes (booking preview). */
  fitRoute?: boolean;
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
  // Zoom the map to this point (e.g. the passenger's detected location), padding-aware.
  focus?: { lat: number; lng: number } | null;
  // Navigation camera: keep this point centred, rotated to `heading` (heading-up), with tilt.
  // While set, the auto-fit/focus framing is suspended. Dragging the map calls onFollowBreak.
  follow?: { lat: number; lng: number; heading: number; zoom?: number; tilt?: number } | null;
  idleReturnMs?: number;
  /** Called when the map returns to its automatic view after idleReturnMs (e.g. resume follow). */
  onIdleReturn?: () => void;
  onFollowBreak?: () => void;
}

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };

// Frame a single point into the VISIBLE area (respecting fitPadding so it isn't hidden
// behind the booking sheet/side panel) at street-level zoom.
// Exact zoom with the point centred in the visible area (between the overlays), not a fitted
// box: fitBounds with a big box landed below the wanted zoom on narrow phones, so the map looked
// zoomed out / scaled instead of moving closer to the car (2026-11-16).
function centerPointAt(map: any, lat: number, lng: number, pad: any, zoom: number) {
  map.moveCamera({ center: { lat, lng }, zoom });
  const p = typeof pad === 'number' ? { top: pad, right: pad, bottom: pad, left: pad } : pad;
  const dx = Math.round(((p.right ?? 0) - (p.left ?? 0)) / 2), dy = Math.round(((p.bottom ?? 0) - (p.top ?? 0)) / 2);
  if (dx || dy) map.panBy(dx, dy);
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
const COLORS = { pickup: '#C8FF46', dropoff: '#F5F7F6', vehicle: '#C8FF46', stop: '#FFC83D', person: '#4C9AFF' };

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
  if (mk.kind === 'person') return centerOnPoint(personMarkerEl({ title: mk.label, stale: mk.stale }));
  // Pin: the needle tip (element bottom) is the point — Google's default bottom anchor, no shift.
  if (mk.kind === 'pickup') { const el = pickupPinEl({ title: mk.label, stale: mk.stale, pulse: mk.pulse }); el.dataset.sig = mk.pulse ? 'pulse' : 'pin'; return el; }
  const el = document.createElement('div');
  el.style.cssText = `width:18px;height:18px;border-radius:50px;background:${COLORS[mk.kind]};border:2px solid #0d1608;box-shadow:0 0 0 3px rgba(200,255,70,0.25);opacity:${mk.stale ? 0.5 : 1};display:flex;align-items:center;justify-content:center;font-size:14px`;
  el.title = mk.label || mk.kind;
  return centerOnPoint(el);
}

export default function GoogleMapView({ markers = [], route, center, zoom = 9, interactive = true, onMapClick, className, fitPadding, fitRoute, fleet = [], focus, focusZoom, follow, onFollowBreak, idleReturnMs, onIdleReturn }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
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
          colorScheme: (g.ColorScheme && g.ColorScheme.DARK) || 'DARK',
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
        map.addListener('dragstart', () => { if (followRef.current) breakRef.current?.(); });
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
        marker = new g.marker.AdvancedMarkerElement({ map, position: { lat: mk.lat, lng: mk.lng }, content: markerEl(mk), title: mk.label, ...(mk.self ? { zIndex: 1000 } : mk.kind === 'pickup' ? { zIndex: 950 } : mk.kind === 'person' ? { zIndex: 900 } : {}) /* brand pin over the person (2026-11-17) */ });
        if (mk.kind === 'vehicle' && mk.heading != null && marker.content) orientVehicle(marker.content as HTMLElement, map.getHeading?.() ?? 0, mk.heading);
        markerMap.current.set(mk.id, marker);
        posMap.current.set(mk.id, { lat: mk.lat, lng: mk.lng });
        continue;
      }
      marker.title = mk.label ?? '';
      // Re-render a vehicle whose plate tag or busy state changed (staff fleet map).
      const sig = mk.nav ? 'nav' : `${mk.busy ? 1 : 0}|${mk.tag ?? ''}`;
      if (mk.kind === 'pickup' && marker.content && (marker.content as HTMLElement).dataset.sig !== (mk.pulse ? 'pulse' : 'pin')) marker.content = markerEl(mk);
      if (mk.kind === 'vehicle' && marker.content && (marker.content as HTMLElement).dataset.sig !== sig) {
        marker.content = markerEl(mk);
        if (mk.heading != null) orientVehicle(marker.content as HTMLElement, map.getHeading?.() ?? 0, mk.heading);
      }
      // Arrow: pulse only while standing still (toggle in place — no re-create, no animation restart).
      if (mk.nav && marker.content) (marker.content as HTMLElement).classList.toggle('ily-moving', !!mk.moving);
      if (marker.content) (marker.content as HTMLElement).style.opacity = mk.stale ? '0.5' : '1';
      const from = posMap.current.get(mk.id) ?? { lat: mk.lat, lng: mk.lng };
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
          else if (distanceM(from, to) >= 4) orientVehicle(marker.content as HTMLElement, mapHeading, bearing(from, to));
        }
        const start = performance.now();
        const dur = 900; // slightly under the ~5s sample cadence
        const m = marker;
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / dur);
          const e = t * (2 - t); // easeOutQuad
          m.position = { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e };
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
    if (!map || !g || !ready || followRef.current || idle.active.current) return;
    // A focus point with its own zoom owns the camera (2026-11-17): don't fit the markers around it.
    if (focus && focusZoom != null) return;
    const pad = fitPadding ?? { top: 70, right: 70, bottom: 70, left: 70 };
    if (markers.length >= 2) {
      const b = new g.LatLngBounds();
      markers.forEach((m) => b.extend({ lat: m.lat, lng: m.lng }));
      // The drawn route can bulge outside its end points — include it so all of it shows.
      if (fitRoute && route) route.forEach(([lng, lat]) => b.extend({ lat, lng }));
      map.fitBounds(b, pad);
      // Points very close together (driver waiting at the pickup): don't zoom in past street level.
      g.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 17) map.setZoom(17); });
    } else if (markers.length === 1) {
      if (focusZoom != null) centerPointAt(map, markers[0].lat, markers[0].lng, pad, focusZoom);
      else framePoint(map, g, markers[0].lat, markers[0].lng, pad);
    } else {
      const b = new g.LatLngBounds();
      b.extend({ lat: CYPRUS_BOUNDS.south, lng: CYPRUS_BOUNDS.west });
      b.extend({ lat: CYPRUS_BOUNDS.north, lng: CYPRUS_BOUNDS.east });
      map.fitBounds(b, pad);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready, idle.returnTick, padKey, routeKey]);

  // Zoom to a focus point (the passenger's detected location) once it resolves, unless a
  // full 2-stop route is already framed.
  const focusKey = focus ? `${focus.lat.toFixed(5)},${focus.lng.toFixed(5)}` : '';
  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready || !focus || markers.length >= 2 || followRef.current || idle.active.current) return;
    const fpad = fitPadding ?? { top: 70, right: 70, bottom: 70, left: 70 };
    if (focusZoom != null) centerPointAt(map, focus.lat, focus.lng, fpad, focusZoom);
    else framePoint(map, g, focus.lat, focus.lng, fpad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, ready, idle.returnTick, padKey]);

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
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 800);
      const e = t * (2 - t);
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
        state: 'available', // fleet overlays: every car white (on-trip yellow is staff-only)
        stale: v.stale,
        size: 61,
        title: v.state === 'busy' ? 'On a trip' : 'Available',
      });
      fleetObjs.current.push(new g.marker.AdvancedMarkerElement({ map, position: { lat: v.lat, lng: v.lng }, content: centerOnPoint(el), zIndex: 1 }));
    }
  }, [fleet, ready]);

  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready) return;
    if (polyRef.current) { polyRef.current.setMap(null); polyRef.current = null; }
    if (route && route.length) {
      polyRef.current = new g.Polyline({
        path: route.map(([lng, lat]) => ({ lat, lng })),
        strokeColor: '#C8FF46',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
      });
    }
  }, [route, ready]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-[#0e1518] text-muted ${className ?? ''}`}>
        <div className="text-center p-6">
          <div className="text-sm font-medium text-ink">Map unavailable</div>
          <div className="mt-1 text-xs">Trip details and actions still work below.</div>
        </div>
      </div>
    );
  }
  // isolation: marker z-indexes (own car 1000, person 900) stay inside the map, never above panels.
  return <div ref={containerRef} className={className} style={{ isolation: 'isolate' }} aria-label="Map" role="application" />;
}
