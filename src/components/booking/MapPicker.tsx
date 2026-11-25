'use client';

import { areaBlock, loadNoGo, pickerOutlines, pickerSpot } from '@/lib/area-client';
import LiftPin from '@/components/LiftPin';
import { useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { loadMaplibre } from '@/lib/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { publicMapConfig } from '@/lib/config';
import { api } from '@/lib/api-client';
import type { Selected } from './PlacesInput';
import { useT, translate } from '@/i18n/I18nProvider';
import { currentTheme } from '@/lib/theme';

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };
// ~1e-6° ≈ 0.11 m. Below this the centre is treated as unchanged, so resize/zoom
// events that don't move the geographic centre never invalidate the draft or issue
// a reverse lookup. Far smaller than any meaningful pickup adjustment.
const MOVE_TOLERANCE = 1e-6;
const REVERSE_DEBOUNCE_MS = 350;
const REVERSE_TIMEOUT_MS = 8000;
const LOAD_TIMEOUT_MS = 15000;

function demoStyle(): maplibregl.StyleSpecification {
  const light = currentTheme() === 'light';
  return {
    version: 8,
    sources: { osm: { type: 'raster', tiles: [light ? publicMapConfig.tilesLight : publicMapConfig.tiles], tileSize: 256, attribution: publicMapConfig.attribution } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': light ? '#eef1f0' : '#0e1518' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.9 } },
    ],
  };
}

interface Props {
  kind: 'pickup' | 'dropoff' | 'stop';
  initial: Selected | null;
  fallback: { lat: number; lng: number } | null;
  onConfirm: (sel: Selected) => void;
  onCancel: () => void;
}

type GeoState = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'timeout';

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
  const [lift, setLift] = useState(false); // the logo rises while the map is dragged (as on the start screen)
  // Not on the island or in a «Запретная зона» (2026-11-24): confirm off, a red line says why.
  // Territories on this screen too (operator 2026-11-26): the outline near the logo, and the logo let go inside /
  // next to one slides to its pickup (destination: drop-off) point, named like on the main map.
  const [terrReady, setTerrReady] = useState(false);
  const [zoomNow, setZoomNow] = useState(initial ? 15 : fallback ? 13 : 10);
  const spot = terrReady ? pickerSpot(kind, center, zoomNow) : null;
  const outlines = terrReady ? pickerOutlines(kind, center) : [];
  const outlinesKey = outlines.map((o) => o.length + ':' + o[0]?.join(',')).join('|');
  const blockCode = spot ? null : areaBlock(center);
  const offIsland = !!blockCode;
  useEffect(() => { void loadNoGo().then(() => setTerrReady(true)); }, []);
  const [addr, setAddr] = useState<string | null>(initial?.label ?? null);
  const [resolving, setResolving] = useState(false);
  const [geo, setGeo] = useState<GeoState>('idle');
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const { t } = useT();
  const coordLabel = (lat: number, lng: number) => t('booking.picker.pin', { coords: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
  const label = kind === 'pickup' ? t('booking.picker.titlePickup') : kind === 'stop' ? t('booking.picker.titleStop') : t('booking.picker.titleDestination');

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
        const maplibre = await loadMaplibre();
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
        // No +/- buttons (2026-11-17): pinch / wheel to zoom.
        const userGesture = (e: { originalEvent?: unknown }) => { if (e.originalEvent) userMoveCount.current += 1; };
        map.on('dragstart', (e) => { userGesture(e); setLift(true); });
        map.on('moveend', () => {
          setLift(false);
          if (gen !== mapGen.current) return;
          const c = map.getCenter(), z = map.getZoom(); setZoomNow(z);
          // Let go in / next to a territory → slide onto its point.
          const s = pickerSpot(kind, { lat: c.lat, lng: c.lng }, z);
          if (s && (Math.abs(s.lat - c.lat) > 3e-5 || Math.abs(s.lng - c.lng) > 3e-5)) map.easeTo({ center: [s.lng, s.lat], duration: 300 });
        });
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
      const maplibre = await loadMaplibre();
      const map = mapRef.current;
      if (!map || closed.current || gen !== mapGen.current) return;
      if (!userMarker.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#4C9AFF;border:2px solid #fff;box-shadow:0 0 0 2px rgba(76,154,255,0.4)';
        el.title = t('booking.picker.deviceLocation');
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
  // The territory outlines near the logo, thinner when zoomed out (like the main map).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { type: 'FeatureCollection', features: outlines.map((poly) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...poly.map(([la, ln]) => [ln, la]), [poly[0][1], poly[0][0]]]] } })) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = map.getSource('pk-terr') as any;
    if (src) { src.setData(data); return; }
    map.addSource('pk-terr', { type: 'geojson', data });
    map.addLayer({ id: 'pk-terr-fill', type: 'fill', source: 'pk-terr', paint: { 'fill-color': '#4C9AFF', 'fill-opacity': 0.16 } });
    map.addLayer({ id: 'pk-terr-line', type: 'line', source: 'pk-terr', paint: { 'line-color': '#4C9AFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 13, 2, 14, 2.5, 15, 3.5, 16, 4.5], 'line-opacity': 0.95 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlinesKey, mapLoaded]);

  function confirm() {
    if (closed.current) return;
    const c = mapRef.current?.getCenter();
    const lat = c ? c.lat : centerRef.current.lat;
    const lng = c ? c.lng : centerRef.current.lng;
    // A territory point wins: its place and name (as on the main map).
    const s = pickerSpot(kind, { lat, lng }, mapRef.current?.getZoom?.() ?? zoomNow);
    if (s) { closed.current = true; finish(); onConfirm(s); return; }
    // Only on the island of Cyprus (2026-11-24, operator): the button is off and a red line says why.
    if (areaBlock({ lat, lng })) return;
    closed.current = true;
    const snap = addrRef.current;
    // Stored on the booking and shown to the driver → language-neutral English, not the passenger's UI language.
    const l = snap && snap.rev === draftRev.current ? snap.label : translate('en', 'booking.picker.pin', { coords: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
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
    idle: null, locating: t('booking.picker.geo.locating'), ok: null,
    denied: t('booking.picker.geo.denied'),
    unavailable: t('booking.picker.geo.unavailable'),
    timeout: t('booking.picker.geo.timeout'),
  };
  const coarse = accuracyM !== null && accuracyM > 150;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-page" style={{ height: '100dvh' }}>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-edge bg-page px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button className="btn-ghost !min-h-0 !py-1.5 text-sm" onClick={cancel} aria-label={t('common.back')}>{t('booking.picker.back')}</button>
        <h2 className="font-semibold">{label}</h2>
      </div>

      <div className="relative flex-1">
        {failed ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted">
            <div>
              <div className="text-sm text-ink">{t('booking.picker.mapUnavailable')}</div>
              <div className="mt-1 text-xs">{t('booking.picker.detailsSafe')}</div>
              <div className="mt-4 flex justify-center gap-2">
                <button className="btn-primary" onClick={() => setRetryKey((k) => k + 1)}>{t('common.retry')}</button>
                <button className="btn-ghost" onClick={cancel}>{t('booking.picker.enterAddress')}</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={containerRef} dir="ltr" className="absolute inset-0 h-full w-full" aria-label={t('booking.picker.mapAria')} role="application" />
            {mapLoaded && (
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
                {/* IL-Y brand mark as the centre pin (2026-11-17). */}
                <span className="block h-[40px] w-[32px]" data-testid="picker-pin"><LiftPin lift={lift} /></span>
              </div>
            )}
            {!mapLoaded && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted">
                <span className="animate-pulse">{t('booking.picker.loadingMap')}</span>
              </div>
            )}
            <button
              className="absolute bottom-10 end-3 z-10 flex h-12 items-center gap-2.5 rounded-full border border-white/15 bg-[#10191C]/95 px-5 text-[17px] text-white shadow-lg disabled:opacity-50" data-testid="picker-my-location"
              onClick={() => requestLocation(true)}
              disabled={!mapLoaded}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden className="shrink-0"><circle cx="12" cy="12" r="6" /><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /></svg><span>{t('booking.picker.myLocation')}</span>
            </button>
          </>
        )}
      </div>

      <div className="border-t border-edge bg-panel p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {geoMsg[geo] && <p className="mb-2 text-xs text-warn">{geoMsg[geo]}</p>}
        {geo === 'ok' && coarse && <p className="mb-2 text-xs text-muted">{t('booking.picker.approximate', { m: Math.round(accuracyM as number) })}</p>}
        {/* Fixed height so resolving/label/fallback never change layout (no resize→move feedback). */}
        <div className="mb-3 min-h-[3.25rem]">
          <div className="label">{kind === 'pickup' ? t('booking.picker.selectedPickup') : kind === 'stop' ? t('booking.picker.selectedStop') : t('booking.picker.selectedDestination')}</div>
          <div className="mt-0.5 truncate text-sm font-medium">
            {spot?.label ?? addr ?? coordLabel(center.lat, center.lng)}
            {resolving && !addr && !spot && <span className="ms-2 text-xs text-muted">{t('booking.picker.resolving')}</span>}
          </div>
          {offIsland
            ? <div className="text-xs font-medium leading-snug text-danger" data-testid="picker-off-island">{t(`errors.${blockCode ?? 'OFF_ISLAND'}` as 'errors.OFF_ISLAND')}</div>
            : <div className="truncate text-xs text-muted">{addr || spot ? ' ' : t('booking.picker.noAddress')}</div>}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost !min-h-[44px] shrink-0 !px-4 !py-2 text-sm" onClick={cancel}>{t('common.cancel')}</button>
          <button className="btn-primary !min-h-[44px] min-w-0 flex-1 !px-3 !py-2 text-sm whitespace-nowrap" onClick={confirm} disabled={failed || !mapLoaded || offIsland}>
            {kind === 'pickup' ? t('booking.picker.confirmPickup') : kind === 'stop' ? t('booking.picker.confirmStop') : t('booking.picker.confirmDestination')}
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
