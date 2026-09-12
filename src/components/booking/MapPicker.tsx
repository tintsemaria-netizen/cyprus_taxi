'use client';

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { publicMapConfig } from '@/lib/config';
import { api } from '@/lib/api-client';
import type { Selected } from './PlacesInput';

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };
// ~1e-6° ≈ 0.11 m. Below this the centre is treated as unchanged, so resize/zoom
// events that don't move the geographic centre never invalidate the draft or issue
// a reverse lookup. Far smaller than any meaningful pickup adjustment.
const MOVE_TOLERANCE = 1e-6;
const REVERSE_DEBOUNCE_MS = 350;
const REVERSE_TIMEOUT_MS = 8000;
const LOAD_TIMEOUT_MS = 15000;

function demoStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { osm: { type: 'raster', tiles: [publicMapConfig.tiles], tileSize: 256, attribution: publicMapConfig.attribution } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0e1518' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.9 } },
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
const coordKey = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
const near = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.abs(a.lat - b.lat) < MOVE_TOLERANCE && Math.abs(a.lng - b.lng) < MOVE_TOLERANCE;

export default function MapPicker({ kind, initial, fallback, onConfirm, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarker = useRef<maplibregl.Marker | null>(null);

  // Versioned draft: coordinate + its resolved label move together (Task 008).
  const draftRev = useRef(0);
  const centerRef = useRef<{ lat: number; lng: number }>(initial ?? fallback ?? CYPRUS_CENTER);
  const addrRef = useRef<{ rev: number; label: string } | null>(initial ? { rev: 0, label: initial.label } : null);

  // Flicker/idle control.
  const lastProcessed = useRef<{ lat: number; lng: number }>(centerRef.current); // last centre we acted on
  const lastReverseKey = useRef<string | null>(initial ? coordKey(initial.lat, initial.lng) : null); // dedup (incl. null result)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseAbort = useRef<AbortController | null>(null);
  const revSeq = useRef(0);

  // Lifecycle guards.
  const mapGen = useRef(0);          // increments per (re)created map; stale callbacks bail
  const closed = useRef(false);
  const userMoveCount = useRef(0);
  const geoGen = useRef(0);
  const popped = useRef(false);

  const [center, setCenter] = useState(centerRef.current);
  const [addr, setAddr] = useState<string | null>(initial?.label ?? null);
  const [resolving, setResolving] = useState(false);
  const [geo, setGeo] = useState<GeoState>('idle');
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const label = kind === 'pickup' ? 'Set pickup location' : 'Set destination';

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

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

  // A REAL geographic change: bump the draft, invalidate the label, and schedule a
  // single debounced reverse lookup once movement settles.
  function onRealMove(lat: number, lng: number, gen: number) {
    draftRev.current += 1;
    revSeq.current += 1;                 // any in-flight reverse is now stale
    reverseAbort.current?.abort();       // cancel obsolete request
    centerRef.current = { lat, lng };
    lastProcessed.current = { lat, lng };
    addrRef.current = null;
    setCenter({ lat, lng });
    setAddr(null);
    setResolving(true);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const rev = draftRev.current;
    debounceTimer.current = setTimeout(() => reverseGeocode(lat, lng, rev, gen), REVERSE_DEBOUNCE_MS);
  }

  // Reverse lookup for a specific coordinate/draft/map-generation. Bounded by an
  // 8s timeout; applies only if still the current request. Deduped by coordinate
  // (a null/no-address result is a COMPLETED result, never retried in a loop).
  async function reverseGeocode(lat: number, lng: number, rev: number, gen: number) {
    if (closed.current || gen !== mapGen.current) return;
    const key = coordKey(lat, lng);
    if (lastReverseKey.current === key && rev === draftRev.current) { setResolving(false); return; }
    const my = ++revSeq.current;
    const controller = new AbortController();
    reverseAbort.current = controller;
    setResolving(true);
    let result: { place: { label: string } | null } | null = null;
    let errored = false;
    try {
      result = await api<{ place: { label: string } | null }>(`/places/reverse?lat=${lat}&lng=${lng}`, {
        signal: controller.signal,
        timeoutMs: REVERSE_TIMEOUT_MS,
      });
    } catch {
      errored = true; // timeout / network / abort → coordinate fallback (no retry loop)
    }
    // Ignore stale: superseded request, changed draft, different map, or closed.
    if (closed.current || gen !== mapGen.current || my !== revSeq.current || rev !== draftRev.current) return;
    lastReverseKey.current = key; // mark this coordinate as resolved (success OR null OR error)
    if (!errored && result?.place?.label) {
      addrRef.current = { rev, label: result.place.label };
      setAddr(result.place.label);
    } else {
      addrRef.current = null;
      setAddr(null);
    }
    setResolving(false);
  }

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const gen = ++mapGen.current;
    setFailed(false);
    setMapLoaded(false);
    let loadTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const maplibre = (await import('maplibre-gl')).default;
        if (disposed || closed.current || gen !== mapGen.current || !containerRef.current) return;
        // Retry preserves the current draft: centre on the last draft coordinate.
        const start = centerRef.current;
        const map = new maplibre.Map({
          container: containerRef.current,
          style: demoStyle(),
          center: [start.lng, start.lat],
          zoom: initial ? 15 : fallback ? 13 : 10,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
        const userGesture = (e: { originalEvent?: unknown }) => { if (e.originalEvent) userMoveCount.current += 1; };
        map.on('dragstart', userGesture);
        map.on('zoomstart', userGesture);
        map.on('rotatestart', userGesture);
        // Only a real geographic centre change counts — resize/zoom-in-place is ignored.
        map.on('move', () => {
          if (gen !== mapGen.current) return;
          const c = map.getCenter();
          if (near({ lat: c.lat, lng: c.lng }, lastProcessed.current)) return;
          onRealMove(c.lat, c.lng, gen);
        });
        // Fatal-init detection: if the style never loads, show the recoverable error
        // state. Individual tile errors are NOT fatal and are ignored here.
        loadTimer = setTimeout(() => { if (!disposed && gen === mapGen.current && !map.loaded()) setFailed(true); }, LOAD_TIMEOUT_MS);
        map.on('load', () => {
          if (disposed || closed.current || gen !== mapGen.current) return;
          if (loadTimer) clearTimeout(loadTimer);
          setMapLoaded(true);
          map.resize();
          const c = map.getCenter();
          lastProcessed.current = { lat: c.lat, lng: c.lng };
          centerRef.current = { lat: c.lat, lng: c.lng };
          // Resolve the ACTUAL current point (not a captured start), unless a saved
          // label for this exact point is already present.
          if (!(addrRef.current && addrRef.current.rev === draftRev.current)) {
            reverseGeocode(c.lat, c.lng, draftRev.current, gen);
          }
        });
        ro = new ResizeObserver(() => { if (gen === mapGen.current) mapRef.current?.resize(); });
        if (containerRef.current) ro.observe(containerRef.current);
        [60, 220, 520].forEach((ms) => timers.push(setTimeout(() => { if (gen === mapGen.current) mapRef.current?.resize(); }, ms)));
        if (!initial) requestLocation(false, gen);
      } catch {
        if (!disposed && gen === mapGen.current) setFailed(true);
      }
    })();
    const onResize = () => { if (gen === mapGen.current) mapRef.current?.resize(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      disposed = true;
      if (loadTimer) clearTimeout(loadTimer);
      timers.forEach(clearTimeout);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      reverseAbort.current?.abort();
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  function showUser(lat: number, lng: number, acc: number, gen: number) {
    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      const map = mapRef.current;
      if (!map || closed.current || gen !== mapGen.current) return;
      if (!userMarker.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#4C9AFF;border:2px solid #fff;box-shadow:0 0 0 2px rgba(76,154,255,0.4)';
        el.title = 'Your device location';
        userMarker.current = new maplibre.Marker({ element: el });
      }
      userMarker.current.setLngLat([lng, lat]).addTo(map);
      const add = () => {
        if (!mapRef.current || closed.current || gen !== mapGen.current) return;
        const data = accuracyCircle(lat, lng, acc) as GeoJSON.GeoJSON;
        const src = map.getSource('acc') as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        else {
          map.addSource('acc', { type: 'geojson', data });
          map.addLayer({ id: 'acc', type: 'fill', source: 'acc', paint: { 'fill-color': '#4C9AFF', 'fill-opacity': 0.12 } });
        }
      };
      if (map.isStyleLoaded()) add(); else map.once('load', add);
    })();
  }

  function requestLocation(explicit: boolean, gen = mapGen.current) {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { setGeo('unavailable'); return; }
    setGeo('locating');
    const g = ++geoGen.current;
    const moveAtRequest = userMoveCount.current;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (closed.current || g !== geoGen.current || gen !== mapGen.current) return;
        setGeo('ok');
        setAccuracyM(pos.coords.accuracy ?? null);
        showUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 0, gen);
        const mayRecenter = explicit ? userMoveCount.current === moveAtRequest : userMoveCount.current === 0;
        if (mayRecenter) {
          const zoom = pos.coords.accuracy && pos.coords.accuracy > 1000 ? 12 : 15;
          mapRef.current?.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom, duration: 500 });
        }
      },
      (err) => {
        if (closed.current || g !== geoGen.current || gen !== mapGen.current) return;
        setGeo(err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function finish() {
    if (!popped.current && history.state && (history.state as { ilyasPicker?: boolean }).ilyasPicker) history.back();
  }
  function confirm() {
    if (closed.current) return;
    closed.current = true;
    const c = mapRef.current?.getCenter();
    const lat = c ? c.lat : centerRef.current.lat;
    const lng = c ? c.lng : centerRef.current.lng;
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
              <div className="text-sm text-ink">Map temporarily unavailable</div>
              <div className="mt-1 text-xs">Your entered details are safe.</div>
              <div className="mt-4 flex justify-center gap-2">
                <button className="btn-primary" onClick={() => setRetryKey((k) => k + 1)}>Retry</button>
                <button className="btn-ghost" onClick={cancel}>Enter address instead</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-label="Map — drag to position the pin" role="application" />
            {mapLoaded && (
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
                <svg width="34" height="46" viewBox="0 0 34 46" aria-hidden>
                  <path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 29 17 29s17-17 17-29C34 7.6 26.4 0 17 0z" fill="#C8FF46" stroke="#0d1608" strokeWidth="2" />
                  <circle cx="17" cy="17" r="6" fill="#0d1608" />
                </svg>
              </div>
            )}
            {!mapLoaded && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted">
                <span className="animate-pulse">Loading map…</span>
              </div>
            )}
            <button
              className="absolute right-3 top-3 z-10 rounded-full border border-edge bg-page/90 px-3 py-2 text-sm text-ink hover:border-accent/50 disabled:opacity-50"
              onClick={() => requestLocation(true)}
              disabled={!mapLoaded}
            >
              ⌖ My location
            </button>
          </>
        )}
      </div>

      <div className="border-t border-edge bg-panel p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {geoMsg[geo] && <p className="mb-2 text-xs text-warn">{geoMsg[geo]}</p>}
        {geo === 'ok' && coarse && <p className="mb-2 text-[11px] text-muted">Your device location is approximate (±{Math.round(accuracyM as number)} m).</p>}
        {/* Fixed height so resolving/label/fallback never change layout (no resize→move feedback). */}
        <div className="mb-3 h-[3.25rem]">
          <div className="label">Selected {kind === 'pickup' ? 'pickup' : 'destination'}</div>
          <div className="mt-0.5 truncate text-sm font-medium">
            {addr ?? coordLabel(center.lat, center.lng)}
            {resolving && !addr && <span className="ml-2 text-[11px] text-muted">resolving…</span>}
          </div>
          <div className="text-[11px] text-muted">{addr ? ' ' : 'No street address for this point — using map coordinates.'}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={cancel}>Cancel</button>
          <button className="btn-primary flex-1" onClick={confirm} disabled={failed || !mapLoaded}>
            {kind === 'pickup' ? 'Confirm pickup' : 'Confirm destination'}
          </button>
        </div>
      </div>
    </div>
  );
}

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
