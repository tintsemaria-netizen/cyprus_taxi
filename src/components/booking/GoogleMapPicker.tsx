'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, MAP_ID } from '@/lib/google-maps';
import { api } from '@/lib/api-client';
import type { Selected } from './PlacesInput';

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };
const MOVE_TOLERANCE = 1e-6;      // ~0.11m — ignore resize/no-op idle events
const REVERSE_TIMEOUT_MS = 8000;

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

export default function GoogleMapPicker({ kind, initial, fallback, onConfirm, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const gRef = useRef<any>(null);
  const userMarker = useRef<any>(null);
  const accCircle = useRef<any>(null);

  const draftRev = useRef(0);
  const centerRef = useRef<{ lat: number; lng: number }>(initial ?? fallback ?? CYPRUS_CENTER);
  const addrRef = useRef<{ rev: number; label: string } | null>(initial ? { rev: 0, label: initial.label } : null);
  const lastProcessed = useRef<{ lat: number; lng: number }>(centerRef.current);
  const lastReverseKey = useRef<string | null>(initial ? coordKey(initial.lat, initial.lng) : null);
  const reverseAbort = useRef<AbortController | null>(null);
  const revSeq = useRef(0);
  const mapGen = useRef(0);
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
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onRealMove(lat: number, lng: number) {
    draftRev.current += 1;
    revSeq.current += 1;
    reverseAbort.current?.abort();
    centerRef.current = { lat, lng };
    lastProcessed.current = { lat, lng };
    addrRef.current = null;
    setCenter({ lat, lng });
    setAddr(null);
    setResolving(true);
  }

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
      result = await api<{ place: { label: string } | null }>(`/places/reverse?lat=${lat}&lng=${lng}`, { signal: controller.signal, timeoutMs: REVERSE_TIMEOUT_MS });
    } catch { errored = true; }
    if (closed.current || gen !== mapGen.current || my !== revSeq.current || rev !== draftRev.current) return;
    lastReverseKey.current = key;
    if (!errored && result?.place?.label) { addrRef.current = { rev, label: result.place.label }; setAddr(result.place.label); }
    else { addrRef.current = null; setAddr(null); }
    setResolving(false);
  }

  useEffect(() => {
    let disposed = false;
    const gen = ++mapGen.current;
    setFailed(false);
    setMapLoaded(false);
    let ro: ResizeObserver | null = null;
    loadGoogleMaps()
      .then((g) => {
        if (disposed || closed.current || gen !== mapGen.current || !containerRef.current) return;
        gRef.current = g;
        const start = centerRef.current;
        const map = new g.Map(containerRef.current, {
          center: start,
          zoom: initial ? 16 : fallback ? 14 : 11,
          mapId: MAP_ID || undefined,
          colorScheme: (g.ColorScheme && g.ColorScheme.DARK) || 'DARK',
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        });
        mapRef.current = map;
        map.addListener('dragstart', () => { userMoveCount.current += 1; });
        // A real geographic centre change invalidates the label immediately (Task 008);
        // resize/no-op idle (unchanged centre) is ignored via tolerance.
        map.addListener('center_changed', () => {
          if (gen !== mapGen.current) return;
          const c = map.getCenter(); if (!c) return;
          const p = { lat: c.lat(), lng: c.lng() };
          if (near(p, lastProcessed.current)) return;
          onRealMove(p.lat, p.lng);
        });
        // 'idle' is the settle signal → one reverse lookup, deduped by coordinate.
        map.addListener('idle', () => {
          if (disposed || closed.current || gen !== mapGen.current) return;
          const c = map.getCenter(); if (!c) return;
          reverseGeocode(c.lat(), c.lng(), draftRev.current, gen);
        });
        g.event.addListenerOnce(map, 'idle', () => {
          if (disposed || closed.current || gen !== mapGen.current) return;
          setMapLoaded(true);
          const c = map.getCenter();
          if (c) { lastProcessed.current = { lat: c.lat(), lng: c.lng() }; centerRef.current = { lat: c.lat(), lng: c.lng() }; }
        });
        // Keep the canvas sized to its container (fixed overlay).
        ro = new ResizeObserver(() => { if (gen === mapGen.current && mapRef.current) g.event.trigger(mapRef.current, 'resize'); });
        if (containerRef.current) ro.observe(containerRef.current);
        if (!initial) requestLocation(false, gen);
      })
      .catch(() => { if (!disposed && gen === mapGen.current) setFailed(true); });
    return () => {
      disposed = true;
      ro?.disconnect();
      reverseAbort.current?.abort();
      if (mapRef.current && gRef.current) gRef.current.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  function showUser(lat: number, lng: number, acc: number, gen: number) {
    const g = gRef.current, map = mapRef.current;
    if (!g || !map || closed.current || gen !== mapGen.current) return;
    if (!userMarker.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#4C9AFF;border:2px solid #fff;box-shadow:0 0 0 2px rgba(76,154,255,0.4)';
      userMarker.current = new g.marker.AdvancedMarkerElement({ map, position: { lat, lng }, content: el, title: 'Your device location' });
    } else {
      userMarker.current.position = { lat, lng };
      userMarker.current.map = map;
    }
    if (accCircle.current) accCircle.current.setMap(null);
    accCircle.current = new g.Circle({ center: { lat, lng }, radius: Math.min(Math.max(acc, 5), 20000), map, strokeOpacity: 0, fillColor: '#4C9AFF', fillOpacity: 0.12 });
  }

  function requestLocation(explicit: boolean, gen = mapGen.current) {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { setGeo('unavailable'); return; }
    setGeo('locating');
    const g = ++geoGen.current;
    const moveAtRequest = userMoveCount.current;
    const onOk = (pos: GeolocationPosition) => {
      if (closed.current || g !== geoGen.current || gen !== mapGen.current) return;
      setGeo('ok'); setAccuracyM(pos.coords.accuracy ?? null);
      showUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 0, gen);
      const mayRecenter = explicit ? userMoveCount.current === moveAtRequest : userMoveCount.current === 0;
      if (mayRecenter && mapRef.current) {
        mapRef.current.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        mapRef.current.setZoom(pos.coords.accuracy && pos.coords.accuracy > 1000 ? 13 : 16);
      }
    };
    const onErr = (err: GeolocationPositionError, triedLow: boolean) => {
      if (closed.current || g !== geoGen.current || gen !== mapGen.current) return;
      if (err.code === err.PERMISSION_DENIED) { setGeo('denied'); return; }
      if (!triedLow) {
        // High-accuracy GPS often times out indoors / on desktops without GPS. Fall
        // back to coarse (network/wifi) location, which is faster and more reliable.
        navigator.geolocation.getCurrentPosition(onOk, (e) => onErr(e, true), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
        return;
      }
      setGeo(err.code === err.TIMEOUT ? 'timeout' : 'unavailable');
    };
    navigator.geolocation.getCurrentPosition(onOk, (e) => onErr(e, false), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  function finish() {
    if (!popped.current && history.state && (history.state as { ilyasPicker?: boolean }).ilyasPicker) history.back();
  }
  function confirm() {
    if (closed.current) return;
    closed.current = true;
    const c = mapRef.current?.getCenter?.();
    const lat = c ? c.lat() : centerRef.current.lat;
    const lng = c ? c.lng() : centerRef.current.lng;
    const snap = addrRef.current;
    const l = snap && snap.rev === draftRev.current ? snap.label : coordLabel(lat, lng);
    finish();
    onConfirm({ lat, lng, label: l });
  }
  function cancel() { if (closed.current) return; closed.current = true; finish(); onCancel(); }

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
              <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted"><span className="animate-pulse">Loading map…</span></div>
            )}
            <button className="absolute right-3 top-3 z-10 rounded-full border border-edge bg-page/90 px-3 py-2 text-sm text-ink hover:border-accent/50 disabled:opacity-50" onClick={() => requestLocation(true)} disabled={!mapLoaded}>
              ⌖ My location
            </button>
          </>
        )}
      </div>

      <div className="border-t border-edge bg-panel p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {geoMsg[geo] && <p className="mb-2 text-xs text-warn">{geoMsg[geo]}</p>}
        {geo === 'ok' && coarse && <p className="mb-2 text-[11px] text-muted">Your device location is approximate (±{Math.round(accuracyM as number)} m).</p>}
        <div className="mb-3 h-[3.25rem]">
          <div className="label">Selected {kind === 'pickup' ? 'pickup' : 'destination'}</div>
          <div className="mt-0.5 truncate text-sm font-medium">
            {addr ?? coordLabel(center.lat, center.lng)}
            {resolving && !addr && <span className="ml-2 text-[11px] text-muted">resolving…</span>}
          </div>
          <div className="text-[11px] text-muted">{addr ? ' ' : 'No street address for this point — using map coordinates.'}</div>
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
