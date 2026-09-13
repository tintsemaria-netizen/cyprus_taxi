'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, MAP_ID } from '@/lib/google-maps';
import { CYPRUS_BOUNDS } from '@/lib/config';
import type { MapMarker } from './MapView';

interface Props {
  markers?: MapMarker[];
  route?: [number, number][]; // [lng, lat]
  center?: { lat: number; lng: number };
  zoom?: number;
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
}

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };

// Frame a single point into the VISIBLE area (respecting fitPadding so it isn't hidden
// behind the booking sheet/side panel) at street-level zoom.
function framePoint(map: any, g: any, lat: number, lng: number, pad: any, maxZoom = 16) {
  const d = 0.006; // ~650m half-box → ~street zoom
  const b = new g.LatLngBounds();
  b.extend({ lat: lat - d, lng: lng - d });
  b.extend({ lat: lat + d, lng: lng + d });
  map.fitBounds(b, pad);
  g.event.addListenerOnce(map, 'idle', () => {
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
  });
}
const COLORS = { pickup: '#C8FF46', dropoff: '#F5F7F6', vehicle: '#C8FF46' };

function markerEl(mk: MapMarker): HTMLElement {
  const el = document.createElement('div');
  const vehicle = mk.kind === 'vehicle';
  el.style.cssText = `width:${vehicle ? 30 : 18}px;height:${vehicle ? 30 : 18}px;border-radius:${vehicle ? 8 : 50}px;background:${COLORS[mk.kind]};border:2px solid #0d1608;box-shadow:0 0 0 3px rgba(200,255,70,0.25);opacity:${mk.stale ? 0.5 : 1};display:flex;align-items:center;justify-content:center;font-size:14px`;
  el.title = mk.label || mk.kind;
  if (vehicle) el.textContent = '🚕';
  return el;
}

export default function GoogleMapView({ markers = [], route, center, zoom = 9, interactive = true, onMapClick, className, fitPadding, fleet = [], focus }: Props) {
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
  const homeRef = useRef<{ lat: number; lng: number }>(center ?? CYPRUS_CENTER);

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let timers: ReturnType<typeof setTimeout>[] = [];
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
          keyboardShortcuts: interactive,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
        });
        if (interactive && clickRef.current) {
          map.addListener('click', (e: any) => clickRef.current?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
        }
        mapRef.current = map;
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
      animMap.current.forEach((id) => cancelAnimationFrame(id));
      animMap.current.clear();
      markerMap.current.clear();
      posMap.current.clear();
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
        marker = new g.marker.AdvancedMarkerElement({ map, position: { lat: mk.lat, lng: mk.lng }, content: markerEl(mk), title: mk.label });
        markerMap.current.set(mk.id, marker);
        posMap.current.set(mk.id, { lat: mk.lat, lng: mk.lng });
        continue;
      }
      marker.title = mk.label ?? '';
      if (marker.content) (marker.content as HTMLElement).style.opacity = mk.stale ? '0.5' : '1';
      const from = posMap.current.get(mk.id) ?? { lat: mk.lat, lng: mk.lng };
      const moved = Math.abs(from.lat - mk.lat) > 1e-7 || Math.abs(from.lng - mk.lng) > 1e-7;
      const prev = animMap.current.get(mk.id);
      if (prev) { cancelAnimationFrame(prev); animMap.current.delete(mk.id); }
      if (mk.kind === 'vehicle' && moved) {
        const to = { lat: mk.lat, lng: mk.lng };
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
  const fitKey = markers.map((m) => (m.kind === 'vehicle' ? 'v' : `${m.id}:${m.lat.toFixed(4)},${m.lng.toFixed(4)}`)).join('|');
  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready) return;
    const pad = fitPadding ?? { top: 70, right: 70, bottom: 70, left: 70 };
    if (markers.length >= 2) {
      const b = new g.LatLngBounds();
      markers.forEach((m) => b.extend({ lat: m.lat, lng: m.lng }));
      map.fitBounds(b, pad);
    } else if (markers.length === 1) {
      framePoint(map, g, markers[0].lat, markers[0].lng, pad);
    } else {
      const b = new g.LatLngBounds();
      b.extend({ lat: CYPRUS_BOUNDS.south, lng: CYPRUS_BOUNDS.west });
      b.extend({ lat: CYPRUS_BOUNDS.north, lng: CYPRUS_BOUNDS.east });
      map.fitBounds(b, pad);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  // Zoom to a focus point (the passenger's detected location) once it resolves, unless a
  // full 2-stop route is already framed.
  const focusKey = focus ? `${focus.lat.toFixed(5)},${focus.lng.toFixed(5)}` : '';
  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready || !focus || markers.length >= 2) return;
    framePoint(map, g, focus.lat, focus.lng, fitPadding ?? { top: 70, right: 70, bottom: 70, left: 70 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, ready]);

  // Live on-duty cars overlay (does not affect the fit).
  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready) return;
    fleetObjs.current.forEach((m) => (m.map = null));
    fleetObjs.current = [];
    for (const v of fleet) {
      const busy = v.state === 'busy';
      const bg = busy ? '#5b6b62' : '#C8FF46'; // available = lime, busy = muted grey-green
      const el = document.createElement('div');
      el.style.cssText = `width:26px;height:26px;border-radius:7px;background:${bg};border:2px solid #0d1608;box-shadow:0 0 0 3px rgba(200,255,70,${busy ? 0.08 : 0.2});opacity:${v.stale ? 0.5 : 1};display:flex;align-items:center;justify-content:center;font-size:13px`;
      el.textContent = '🚕';
      el.title = busy ? 'On a trip' : 'Available';
      fleetObjs.current.push(new g.marker.AdvancedMarkerElement({ map, position: { lat: v.lat, lng: v.lng }, content: el }));
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
  return <div ref={containerRef} className={className} aria-label="Map" role="application" />;
}
