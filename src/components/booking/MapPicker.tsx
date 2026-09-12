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
      { id: 'bg', type: 'background', paint: { 'background-color': '#0e1518' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.85, 'raster-saturation': -0.3, 'raster-brightness-max': 0.85 } },
    ],
  };
}

interface Props {
  kind: 'pickup' | 'dropoff';
  initial: Selected | null;
  fallback: { lat: number; lng: number } | null;
  onConfirm: (sel: Selected) => void;
  onCancel: () => void;
}

type GeoState = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'timeout';

const coordLabel = (lat: number, lng: number) => `Pin ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

export default function MapPicker({ kind, initial, fallback, onConfirm, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarker = useRef<maplibregl.Marker | null>(null);

  // --- versioned draft: coordinate + its resolved label move together ---
  const draftRev = useRef(0);                       // bumps on every coordinate change
  const centerRef = useRef<{ lat: number; lng: number }>(initial ?? fallback ?? CYPRUS_CENTER);
  const addrRef = useRef<{ rev: number; label: string } | null>(
    initial ? { rev: 0, label: initial.label } : null,
  );
  const revSeq = useRef(0);                          // latest reverse-geocode request id

  const closed = useRef(false);                      // dismissed → ignore all late async
  const userMoveCount = useRef(0);                   // increments ONLY on user gestures
  const geoGen = useRef(0);                          // increments per geolocation request
  const popped = useRef(false);                      // history entry consumed

  const [center, setCenter] = useState(centerRef.current);
  const [addr, setAddr] = useState<string | null>(initial?.label ?? null);
  const [resolving, setResolving] = useState(false);
  const [geo, setGeo] = useState<GeoState>('idle');
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const label = kind === 'pickup' ? 'Set pickup location' : 'Set destination';

  // Lock background scroll; restore on close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Owned Escape + history handlers so cleanup actually removes them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    const onPop = () => { popped.current = true; cancel(); };
    window.addEventListener('keydown', onKey);
    history.pushState({ ilyasPicker: true }, '');
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any coordinate change invalidates the current label + pending request identity.
  function onCoordChange(lat: number, lng: number) {
    draftRev.current += 1;
    revSeq.current += 1;                 // any in-flight reverse response is now stale
    centerRef.current = { lat, lng };
    addrRef.current = null;
    setCenter({ lat, lng });
    setAddr(null);
    setResolving(true);
  }

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const maplibre = (await import('maplibre-gl')).default;
        if (disposed || closed.current || !containerRef.current) return;
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
        // User gestures mark the camera as user-controlled.
        const userGesture = (e: { originalEvent?: unknown }) => { if (e.originalEvent) userMoveCount.current += 1; };
        map.on('dragstart', userGesture);
        map.on('zoomstart', userGesture);
        map.on('rotatestart', userGesture);
        // Coordinate tracks the centre under the fixed pin; label invalidates immediately.
        map.on('move', () => { const c = map.getCenter(); onCoordChange(c.lat, c.lng); });
        map.on('moveend', () => { const c = map.getCenter(); reverseGeocode(c.lat, c.lng, draftRev.current); });
        map.on('load', () => {
          if (disposed || closed.current) return;
          map.resize();
          reverseGeocode(start.lat, start.lng, draftRev.current);
        });
        mapRef.current = map;
        if (!initial) requestLocation(false); // auto-locate only when this field is empty
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    const onResize = () => mapRef.current?.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reverse-geocode tied to a specific draft revision. Applies ONLY if that draft is
  // still current (and the picker is open); ignores every stale success and failure.
  async function reverseGeocode(lat: number, lng: number, rev: number) {
    const my = ++revSeq.current;
    setResolving(true);
    try {
      const r = await api<{ place: { label: string } | null; unavailable?: boolean }>(`/places/reverse?lat=${lat}&lng=${lng}`);
      if (closed.current || my !== revSeq.current || rev !== draftRev.current) return; // stale
      if (r.place?.label) { addrRef.current = { rev, label: r.place.label }; setAddr(r.place.label); }
      else { addrRef.current = null; setAddr(null); }
      setResolving(false);
    } catch {
      if (closed.current || my !== revSeq.current || rev !== draftRev.current) return;
      addrRef.current = null; setAddr(null); setResolving(false);
    }
  }

  function showUser(lat: number, lng: number, acc: number) {
    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      const map = mapRef.current;
      if (!map || closed.current) return;
      if (!userMarker.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#4C9AFF;border:2px solid #fff;box-shadow:0 0 0 2px rgba(76,154,255,0.4)';
        el.title = 'Your device location';
        userMarker.current = new maplibre.Marker({ element: el });
      }
      userMarker.current.setLngLat([lng, lat]).addTo(map);
      const add = () => {
        if (!mapRef.current || closed.current) return;
        const data = accuracyCircle(lat, lng, acc) as GeoJSON.GeoJSON;
        const src = map.getSource('acc') as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        else {
          map.addSource('acc', { type: 'geojson', data });
          map.addLayer({ id: 'acc', type: 'fill', source: 'acc', paint: { 'fill-color': '#4C9AFF', 'fill-opacity': 0.12 } });
        }
      };
      // Adding sources/layers requires a ready style.
      if (map.isStyleLoaded()) add(); else map.once('load', add);
    })();
  }

  // explicit=true → "My location" button; recenters unless the user has dragged since
  // this exact click. auto (false) → only recenters if the user has never moved.
  function requestLocation(explicit: boolean) {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { setGeo('unavailable'); return; }
    setGeo('locating');
    const gen = ++geoGen.current;
    const moveAtRequest = userMoveCount.current;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (closed.current || gen !== geoGen.current) return;
        setGeo('ok');
        setAccuracyM(pos.coords.accuracy ?? null);
        showUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 0);
        const mayRecenter = explicit ? userMoveCount.current === moveAtRequest : userMoveCount.current === 0;
        if (mayRecenter) {
          const zoom = pos.coords.accuracy && pos.coords.accuracy > 1000 ? 12 : 15;
          mapRef.current?.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom, duration: 500 });
        }
      },
      (err) => {
        if (closed.current || gen !== geoGen.current) return;
        setGeo(err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function finish() {
    if (!popped.current && history.state && (history.state as { ilyasPicker?: boolean }).ilyasPicker) {
      history.back(); // consume our own entry without leaving a phantom
    }
  }
  function confirm() {
    if (closed.current) return;
    closed.current = true;
    const c = mapRef.current?.getCenter();
    const lat = c ? c.lat : centerRef.current.lat;
    const lng = c ? c.lng : centerRef.current.lng;
    // Commit ONE consistent snapshot: label only if it belongs to this exact draft.
    const snap = addrRef.current;
    const l = snap && snap.rev === draftRev.current ? snap.label : coordLabel(lat, lng);
    finish();
    onConfirm({ lat, lng, label: l });
  }
  function cancel() {
    if (closed.current) return;
    closed.current = true;
    finish();
    onCancel();
  }

  const geoMsg: Record<GeoState, string | null> = {
    idle: null, locating: 'Finding your location…', ok: null,
    denied: 'Location permission denied — pan the map to your point, or enable location in your browser settings.',
    unavailable: 'Location unavailable — pan the map to choose.',
    timeout: 'Location timed out — pan the map or press “My location” to retry.',
  };
  const coarse = accuracyM !== null && accuracyM > 150;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-page" style={{ height: '100dvh' }}>
      <div className="z-10 flex items-center gap-3 border-b border-edge bg-page/95 px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button className="btn-ghost !min-h-0 !py-1.5 text-sm" onClick={cancel} aria-label="Back">‹ Back</button>
        <h2 className="font-semibold">{label}</h2>
      </div>

      <div className="relative flex-1">
        {failed ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted">
            <div>
              <div className="text-sm text-ink">Map unavailable</div>
              <div className="mt-1 text-xs">Close this and enter the address by name instead.</div>
              <button className="btn-ghost mt-4" onClick={cancel}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <div ref={containerRef} className="absolute inset-0" aria-label="Map — drag to position the pin" role="application" />
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

      <div className="border-t border-edge bg-panel p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {geoMsg[geo] && <p className="mb-2 text-xs text-warn">{geoMsg[geo]}</p>}
        {geo === 'ok' && coarse && <p className="mb-2 text-[11px] text-muted">Your device location is approximate (±{Math.round(accuracyM as number)} m).</p>}
        <div className="mb-3">
          <div className="label">Selected {kind === 'pickup' ? 'pickup' : 'destination'}</div>
          <div className="mt-0.5 truncate text-sm font-medium">
            {addr ?? coordLabel(center.lat, center.lng)}
            {resolving && !addr && <span className="ml-2 text-[11px] text-muted">resolving…</span>}
          </div>
          {!addr && <div className="text-[11px] text-muted">No street address for this point — using map coordinates.</div>}
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

// Honest accuracy circle: renders the reported radius. Extremely large fixes are
// visually capped (with a disclosure in the panel), never shrunk to look precise.
function accuracyCircle(lat: number, lng: number, radiusM: number): GeoJSON.Feature {
  const points = 48;
  const coords: [number, number][] = [];
  const r = Math.min(Math.max(radiusM, 5), 20000);
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}
