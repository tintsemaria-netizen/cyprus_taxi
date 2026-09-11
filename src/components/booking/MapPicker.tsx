'use client';

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { publicMapConfig } from '@/lib/config';
import { api } from '@/lib/api-client';
import type { Selected } from './PlacesInput';

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };

function demoStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { osm: { type: 'raster', tiles: [publicMapConfig.tiles], tileSize: 256, attribution: publicMapConfig.attribution } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0e1416' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.85, 'raster-saturation': -0.3, 'raster-brightness-max': 0.85 } },
    ],
  };
}

interface Props {
  kind: 'pickup' | 'dropoff';
  initial: Selected | null;      // saved coordinate for this field (reopen at it)
  fallback: { lat: number; lng: number } | null; // e.g. the other stop
  onConfirm: (sel: Selected) => void;
  onCancel: () => void;
}

type GeoState = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'timeout';

export default function MapPicker({ kind, initial, fallback, onConfirm, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarker = useRef<maplibregl.Marker | null>(null);
  const userMoved = useRef(false);       // user has manually panned/zoomed
  const closed = useRef(false);          // picker dismissed — ignore late async
  const revSeq = useRef(0);              // reverse-geocode request id
  const geoReqSeq = useRef(0);           // geolocation request id
  const [center, setCenter] = useState<{ lat: number; lng: number }>(initial ?? fallback ?? CYPRUS_CENTER);
  const [addr, setAddr] = useState<string | null>(initial?.label ?? null);
  const [geo, setGeo] = useState<GeoState>('idle');
  const [failed, setFailed] = useState(false);
  const label = kind === 'pickup' ? 'Set pickup location' : 'Set destination';

  // Lock background scroll while the picker is open; restore on close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escape (desktop) and browser/mobile Back dismiss without committing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') cancel(); }
    function onPop() { cancel(); }
    window.addEventListener('keydown', onKey);
    history.pushState({ picker: true }, '');
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialise the map.
  useEffect(() => {
    let cancelledSetup = false;
    (async () => {
      try {
        const maplibre = (await import('maplibre-gl')).default;
        if (cancelledSetup || !containerRef.current) return;
        const start = initial ?? fallback ?? CYPRUS_CENTER;
        const map = new maplibre.Map({
          container: containerRef.current,
          style: demoStyle(),
          center: [start.lng, start.lat],
          zoom: initial ? 15 : fallback ? 12 : 8,
          attributionControl: { compact: true },
        });
        map.on('error', () => { if (!map.loaded()) setFailed(true); });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
        // User interaction marks the camera as user-controlled (blocks late auto-centre).
        map.on('dragstart', () => { userMoved.current = true; });
        map.on('zoomstart', (e) => { if ((e as unknown as { originalEvent?: unknown }).originalEvent) userMoved.current = true; });
        // Draft coordinate tracks the map centre under the fixed pin.
        map.on('move', () => { const c = map.getCenter(); setCenter({ lat: c.lat, lng: c.lng }); });
        map.on('moveend', () => { const c = map.getCenter(); reverseGeocode(c.lat, c.lng); });
        map.on('load', () => { map.resize(); if (initial) reverseGeocode(initial.lat, initial.lng); });
        mapRef.current = map;

        // Request device location on open only when this field has no saved coordinate.
        if (!initial) requestLocation(false);
      } catch {
        setFailed(true);
      }
    })();
    const onResize = () => mapRef.current?.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelledSetup = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reverseGeocode(lat: number, lng: number) {
    const my = ++revSeq.current;
    try {
      const r = await api<{ place: { label: string } | null; unavailable?: boolean }>(`/places/reverse?lat=${lat}&lng=${lng}`);
      if (my !== revSeq.current || closed.current) return; // stale
      setAddr(r.place?.label ?? null);
    } catch {
      if (my === revSeq.current) setAddr(null);
    }
  }

  function showUser(lat: number, lng: number, accuracyM: number) {
    const map = mapRef.current;
    if (!map) return;
    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (!userMarker.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#4C9AFF;border:2px solid #fff;box-shadow:0 0 0 2px rgba(76,154,255,0.4)';
        el.title = 'Your location';
        userMarker.current = new maplibre.Marker({ element: el });
      }
      userMarker.current.setLngLat([lng, lat]).addTo(map);
      // Accuracy circle
      const circle = accuracyCircle(lat, lng, accuracyM);
      const src = map.getSource('acc') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(circle as GeoJSON.GeoJSON);
      else {
        map.addSource('acc', { type: 'geojson', data: circle as GeoJSON.GeoJSON });
        map.addLayer({ id: 'acc', type: 'fill', source: 'acc', paint: { 'fill-color': '#4C9AFF', 'fill-opacity': 0.12 } });
      }
    })();
  }

  // explicit=true when the user pressed "My location" (always recenters).
  function requestLocation(explicit: boolean) {
    if (!('geolocation' in navigator)) { setGeo('unavailable'); return; }
    setGeo('locating');
    const my = ++geoReqSeq.current;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (closed.current || my !== geoReqSeq.current) return;
        setGeo('ok');
        showUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 0);
        // A late result must not hijack the camera after a manual move (unless explicit).
        if (explicit || !userMoved.current) {
          const zoom = pos.coords.accuracy && pos.coords.accuracy > 1000 ? 12 : 15;
          mapRef.current?.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom, duration: 500 });
        }
      },
      (err) => {
        if (closed.current || my !== geoReqSeq.current) return;
        setGeo(err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function confirm() {
    closed.current = true;
    const c = mapRef.current?.getCenter();
    const lat = c ? c.lat : center.lat;
    const lng = c ? c.lng : center.lng;
    const l = addr ?? `Pin ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    popHistory();
    onConfirm({ lat, lng, label: l });
  }
  function cancel() {
    if (closed.current) return;
    closed.current = true;
    popHistory();
    onCancel();
  }
  // Consume the history entry we pushed, without triggering our own popstate cancel.
  function popHistory() {
    window.removeEventListener('popstate', () => {});
    if (history.state && (history.state as { picker?: boolean }).picker) history.back();
  }

  const geoMsg: Record<GeoState, string | null> = {
    idle: null, locating: 'Finding your location…', ok: null,
    denied: 'Location permission denied — pan the map to your pickup, or enable location in your browser.',
    unavailable: 'Location unavailable — pan the map to choose.',
    timeout: 'Location timed out — pan the map or try again.',
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-page" style={{ height: '100dvh' }}>
      {/* header */}
      <div className="z-10 flex items-center gap-3 border-b border-edge bg-page/95 px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button className="btn-ghost !min-h-0 !py-1.5 text-sm" onClick={cancel} aria-label="Back">‹ Back</button>
        <h2 className="font-semibold">{label}</h2>
      </div>

      {/* map + fixed centre pin */}
      <div className="relative flex-1">
        {failed ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted">
            <div>
              <div className="text-sm text-ink">Map unavailable</div>
              <div className="mt-1 text-xs">Enter the address by name instead, or retry.</div>
            </div>
          </div>
        ) : (
          <>
            <div ref={containerRef} className="absolute inset-0" aria-label="Map — drag to position the pin" role="application" />
            {/* fixed selection pin at the visual centre */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
              <svg width="34" height="46" viewBox="0 0 34 46" aria-hidden>
                <path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 29 17 29s17-17 17-29C34 7.6 26.4 0 17 0z" fill="#C8FF46" stroke="#0d1608" strokeWidth="2" />
                <circle cx="17" cy="17" r="6" fill="#0d1608" />
              </svg>
            </div>
            <button
              className="absolute right-3 top-3 z-10 rounded-full border border-edge bg-page/90 px-3 py-2 text-sm text-ink hover:border-accent/50"
              onClick={() => requestLocation(true)}
            >
              ⌖ My location
            </button>
          </>
        )}
      </div>

      {/* bottom confirmation panel */}
      <div className="border-t border-edge bg-panel p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {geoMsg[geo] && <p className="mb-2 text-xs text-warn">{geoMsg[geo]}</p>}
        <div className="mb-3">
          <div className="label">Selected {kind === 'pickup' ? 'pickup' : 'destination'}</div>
          <div className="mt-0.5 truncate text-sm font-medium">{addr ?? `Pin ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`}</div>
          {!addr && <div className="text-[11px] text-muted">No street address available — using map coordinates.</div>}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={cancel}>Cancel</button>
          <button className="btn-primary flex-1" onClick={confirm} disabled={failed}>
            {kind === 'pickup' ? 'Confirm pickup' : 'Confirm destination'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Approximate an accuracy circle as a polygon (radius in metres) for display.
function accuracyCircle(lat: number, lng: number, radiusM: number): GeoJSON.Feature {
  const points = 48;
  const coords: [number, number][] = [];
  const r = Math.min(radiusM, 3000); // cap for display sanity
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}
