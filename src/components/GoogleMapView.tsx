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
}

const CYPRUS_CENTER = { lat: 34.92, lng: 33.2 };
const COLORS = { pickup: '#C8FF46', dropoff: '#F5F7F6', vehicle: '#C8FF46' };

function markerEl(mk: MapMarker): HTMLElement {
  const el = document.createElement('div');
  const vehicle = mk.kind === 'vehicle';
  el.style.cssText = `width:${vehicle ? 30 : 18}px;height:${vehicle ? 30 : 18}px;border-radius:${vehicle ? 8 : 50}px;background:${COLORS[mk.kind]};border:2px solid #0d1608;box-shadow:0 0 0 3px rgba(200,255,70,0.25);opacity:${mk.stale ? 0.5 : 1};display:flex;align-items:center;justify-content:center;font-size:14px`;
  el.title = mk.label || mk.kind;
  if (vehicle) el.textContent = '🚕';
  return el;
}

export default function GoogleMapView({ markers = [], route, center, zoom = 9, interactive = true, onMapClick, className, fitPadding }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerObjs = useRef<any[]>([]);
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
          if (firstNudge && markerObjs.current.length === 0) mapRef.current.setCenter(homeRef.current);
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
      markerObjs.current = [];
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current, g = gRef.current;
    if (!map || !g || !ready) return;
    markerObjs.current.forEach((m) => (m.map = null));
    markerObjs.current = [];
    for (const mk of markers) {
      const marker = new g.marker.AdvancedMarkerElement({ map, position: { lat: mk.lat, lng: mk.lng }, content: markerEl(mk), title: mk.label });
      markerObjs.current.push(marker);
    }
    const pad = fitPadding ?? { top: 70, right: 70, bottom: 70, left: 70 };
    if (markers.length >= 2) {
      const b = new g.LatLngBounds();
      markers.forEach((m) => b.extend({ lat: m.lat, lng: m.lng }));
      map.fitBounds(b, pad);
    } else if (markers.length === 1) {
      map.panTo({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(13);
    } else {
      // No stops yet: frame the whole island INTO the visible area (fitPadding keeps
      // it clear of a mobile booking sheet / desktop side panel).
      const b = new g.LatLngBounds();
      b.extend({ lat: CYPRUS_BOUNDS.south, lng: CYPRUS_BOUNDS.west });
      b.extend({ lat: CYPRUS_BOUNDS.north, lng: CYPRUS_BOUNDS.east });
      map.fitBounds(b, pad);
    }
  }, [markers, ready, fitPadding]);

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
