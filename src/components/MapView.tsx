'use client';

import { useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { loadMaplibre } from '@/lib/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { publicMapConfig } from '@/lib/config';
import { vehicleMarkerEl, personMarkerEl, orientVehicle, pickupPinEl, navArrowEl } from './carMarker';
import { useIdleReturn } from './useIdleReturn';
import { fitKeyOf } from './mapFit';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'pickup' | 'dropoff' | 'vehicle' | 'person' | 'stop';
  label?: string;
  stale?: boolean;
  /** Visible label under a vehicle marker (e.g. plate number on staff maps). */
  tag?: string;
  /** Vehicle is on a trip (staff fleet map). */
  busy?: boolean;
  /** The viewer's own car (driver app): darker colour, drawn above other cars. */
  self?: boolean;
  /** Known direction of travel (compass degrees) for a vehicle, e.g. the route bearing. */
  heading?: number;
  /** Draw the own vehicle as a navigation arrow (driver on an order). */
  nav?: boolean;
  /** Vehicle is driving (the arrow's standing-still pulse is hidden). */
  moving?: boolean;
  /** Pickup pin pulses (a driver is being searched). */
  pulse?: boolean;
}

interface Props {
  markers?: MapMarker[];
  route?: [number, number][]; // [lng, lat]
  center?: { lat: number; lng: number };
  zoom?: number;
  /** Frame the whole route line too (booking preview). */
  fitRoute?: boolean;
  /** Zoom for a single point / the focus point (default 15; 13 ≈ half a city). */
  focusZoom?: number;
  interactive?: boolean;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  className?: string;
  fitPadding?: { top: number; right: number; bottom: number; left: number };
  fleet?: { lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' }[];
  focus?: { lat: number; lng: number } | null; // zoom the map to this point (e.g. the user's location)
  // Navigation camera (see GoogleMapView): centred, heading-up, tilted; suspends auto-fit.
  follow?: { lat: number; lng: number; heading: number; zoom?: number; tilt?: number } | null;
  /** Let the user pan/zoom freely; return to the automatic view this many ms after the last gesture. */
  idleReturnMs?: number;
  /** Called when the map returns to its automatic view after idleReturnMs (e.g. resume follow). */
  onIdleReturn?: () => void;
  onFollowBreak?: () => void;
}

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };

function demoStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [publicMapConfig.tiles],
        tileSize: 256,
        attribution: publicMapConfig.attribution,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0e1416' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.85, 'raster-saturation': -0.3, 'raster-brightness-max': 0.85 } },
    ],
  };
}

const COLORS = { pickup: '#C8FF46', dropoff: '#F5F7F6', vehicle: '#C8FF46', stop: '#FFC83D', person: '#4C9AFF' };

export default function MapView({ markers = [], route, center, zoom = 9, interactive = true, onMapClick, className, fitPadding, fitRoute, fleet = [], focus, focusZoom: focusZoomProp, follow, onFollowBreak, idleReturnMs, onIdleReturn }: Props) {
  const focusZoom = focusZoomProp ?? 15;
  // Re-frame / re-centre when the visible area changes (e.g. the sheet under the map grew or shrank).
  const padKey = fitPadding ? `${fitPadding.top},${fitPadding.right},${fitPadding.bottom},${fitPadding.left}` : '';
  const containerRef = useRef<HTMLDivElement>(null);
  // Any touch/pinch/scroll stops the navigation follow-camera at once (not only a drag) and,
  // with idleReturnMs, hands the camera back after that many ms without gestures.
  const idleReturnRef = useRef(onIdleReturn);
  idleReturnRef.current = onIdleReturn;
  const lastFit = useRef('');
  const idle = useIdleReturn(containerRef, idleReturnMs, {
    onStart: () => { if (followRef.current) breakRef.current?.(); },
    onReturn: () => idleReturnRef.current?.(),
  });
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjs = useRef<maplibregl.Marker[]>([]);
  const fleetObjs = useRef<maplibregl.Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const followRef = useRef(follow);
  followRef.current = follow;
  const breakRef = useRef(onFollowBreak);
  breakRef.current = onFollowBreak;

  useEffect(() => {
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    (async () => {
      try {
        const maplibre = await loadMaplibre();
        if (cancelled || !containerRef.current) return;
        map = new maplibre.Map({
          container: containerRef.current,
          style: demoStyle(),
          center: [center?.lng ?? CYPRUS_CENTER.lng, center?.lat ?? CYPRUS_CENTER.lat],
          zoom,
          interactive,
          attributionControl: { compact: true },
        });
        map.on('error', (e) => {
          // Tile/network errors shouldn't blank the app; show a fallback if the map never initialises.
          if (!map || !map.loaded()) setFailed(true);
          console.warn('map error', e?.error?.message);
        });
        map.on('load', () => { if (!cancelled) setReady(true); });
        // Keep cars pointing along their travel direction while the map rotates (heading-up nav).
        map.on('rotate', () => { const b = map!.getBearing(); document.querySelectorAll<HTMLElement>('.ily-vehicle').forEach((el) => orientVehicle(el, b)); });
        map.on('dragstart', () => { if (followRef.current) breakRef.current?.(); });
        if (interactive) {
          // Zoom buttons only with a mouse; on touch screens pinch-zoom is used and bottom sheets
          // would cover the buttons anyway (2026-11-15 multi-device audit). (Google: right-centre.)
          if (!window.matchMedia('(pointer: coarse)').matches) map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
          map.on('click', (ev) => clickRef.current?.({ lat: ev.lngLat.lat, lng: ev.lngLat.lng }));
        }
        mapRef.current = map;
      } catch (e) {
        console.warn('map load failed', e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (async () => {
      const maplibre = await loadMaplibre();
      markerObjs.current.forEach((m) => m.remove());
      markerObjs.current = [];
      for (const mk of markers) {
        let el: HTMLElement;
        if (mk.kind === 'vehicle' && mk.nav) {
          el = navArrowEl({ moving: mk.moving, stale: mk.stale, title: mk.label });
          if (mk.heading != null) orientVehicle(el, map.getBearing(), mk.heading);
        } else if (mk.kind === 'vehicle') {
          el = vehicleMarkerEl({ state: mk.self ? 'self' : mk.busy ? 'busy' : 'available', stale: mk.stale, title: mk.label || 'Your driver', tag: mk.tag });
          el.classList.add('ily-vehicle');
          if (mk.heading != null) orientVehicle(el, map.getBearing(), mk.heading);
        } else if (mk.kind === 'person') {
          el = personMarkerEl({ title: mk.label, stale: mk.stale });
        } else if (mk.kind === 'pickup') {
          el = pickupPinEl({ title: mk.label, stale: mk.stale, pulse: mk.pulse });
        } else {
          el = document.createElement('div');
          el.style.width = '18px';
          el.style.height = '18px';
          el.style.borderRadius = '50%';
          el.style.background = COLORS[mk.kind];
          el.style.border = '2px solid #0d1608';
          el.style.boxShadow = '0 0 0 3px rgba(200,255,82,0.25)';
          el.style.opacity = mk.stale ? '0.5' : '1';
          el.title = mk.label || mk.kind;
        }
        const marker = new maplibre.Marker({ element: el, anchor: mk.kind === 'pickup' ? 'bottom' : 'center' }).setLngLat([mk.lng, mk.lat]).addTo(map);
        if (mk.self) marker.getElement().style.zIndex = '1000';
        else if (mk.kind === 'pickup') marker.getElement().style.zIndex = '950'; // brand pin over the person (2026-11-17)
        else if (mk.kind === 'person') marker.getElement().style.zIndex = '900';
        markerObjs.current.push(marker);
      }
      // Fit to markers if more than one (not while the navigation camera is following). Moving
      // markers (cars, the live person) do not re-fit — only a change of the fixed points does.
      if (followRef.current || idle.active.current) return;
      // The visible area (padding) is part of the key: a sheet that changes height re-frames (2026-11-16).
      const key = `${fitKeyOf(markers)}#${idle.returnTick}#${fitPadding ? `${fitPadding.top},${fitPadding.bottom}` : ''}#${fitRoute && route ? route.length : ''}`;
      if (key === lastFit.current) return;
      lastFit.current = key;
      if (focus && focusZoomProp != null) return; // a focus point with its own zoom owns the camera (2026-11-17)
      if (markers.length >= 2) {
        const b = new maplibre.LngLatBounds();
        markers.forEach((m) => b.extend([m.lng, m.lat]));
        if (fitRoute && route) route.forEach((p) => b.extend(p as [number, number]));
        map.fitBounds(b, { padding: fitPadding ?? 70, maxZoom: fitRoute ? 15 : 12, duration: 400 });
      } else if (markers.length === 1 && !focus) {
        // A focus point owns the camera when given (it runs first; this async fit must not undo it).
        map.easeTo({ center: [markers[0].lng, markers[0].lat], zoom: 12, duration: 400, ...(fitPadding ? { padding: fitPadding } : {}) });
      }
    })();
    // Only a change in the padding VALUES re-fits (padKey), not a new object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, ready, idle.returnTick, padKey, fitRoute ? route : null]);

  // Live on-duty cars overlay (does not affect the fit) — same as GoogleMapView.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    (async () => {
      const maplibre = await loadMaplibre();
      if (cancelled) return;
      fleetObjs.current.forEach((m) => m.remove());
      fleetObjs.current = [];
      for (const v of fleet) {
        const el = vehicleMarkerEl({ state: 'available', stale: v.stale, size: 61, title: v.state === 'busy' ? 'On a trip' : 'Available' });
        fleetObjs.current.push(new maplibre.Marker({ element: el }).setLngLat([v.lng, v.lat]).addTo(map));
      }
    })();
    return () => { cancelled = true; };
  }, [fleet, ready]);

  // Zoom to a focus point (e.g. the passenger's detected location), once per change.
  const focusKey = focus ? `${focus.lat.toFixed(5)},${focus.lng.toFixed(5)}` : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus || followRef.current || idle.active.current) return;
    // Centre in the visible area (between overlays / above a sheet) — fitPadding, 2026-11-16.
    map.easeTo({ center: [focus.lng, focus.lat], zoom: focusZoom, duration: 500, ...(fitPadding ? { padding: fitPadding } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, ready, idle.returnTick, padKey]);

  const followKey = follow ? `${follow.lat.toFixed(6)},${follow.lng.toFixed(6)},${Math.round(follow.heading)},${follow.zoom ?? 17},${follow.tilt ?? 45}` : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !follow || idle.active.current) return;
    // Demo raster tiles run out past z16 in places; cap the fallback map there.
    map.easeTo({ center: [follow.lng, follow.lat], bearing: follow.heading, zoom: Math.min(16, follow.zoom ?? 16), pitch: follow.tilt ?? 45, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey, ready]);

  // Sync route line
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const id = 'route';
    const data: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: route ?? [] },
    };
    const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data as GeoJSON.GeoJSON);
    } else if (route && route.length) {
      map.addSource(id, { type: 'geojson', data: data as GeoJSON.GeoJSON });
      map.addLayer({
        id,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#C8FF46', 'line-width': 4, 'line-opacity': 0.9 },
      });
    }
  }, [route, ready]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-[#0e1416] text-muted ${className ?? ''}`}>
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
