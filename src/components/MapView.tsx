'use client';

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { publicMapConfig } from '@/lib/config';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'pickup' | 'dropoff' | 'vehicle';
  label?: string;
  stale?: boolean;
}

interface Props {
  markers?: MapMarker[];
  route?: [number, number][]; // [lng, lat]
  center?: { lat: number; lng: number };
  zoom?: number;
  interactive?: boolean;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  className?: string;
  fitPadding?: { top: number; right: number; bottom: number; left: number };
  fleet?: { lat: number; lng: number; stale?: boolean; state?: 'available' | 'busy' }[];
  focus?: { lat: number; lng: number } | null; // zoom the map to this point (e.g. the user's location)
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

const COLORS = { pickup: '#C8FF46', dropoff: '#F5F7F6', vehicle: '#C8FF46' };

export default function MapView({ markers = [], route, center, zoom = 9, interactive = true, onMapClick, className, fitPadding, focus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjs = useRef<maplibregl.Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    (async () => {
      try {
        const maplibre = (await import('maplibre-gl')).default;
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
        if (interactive) {
          map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
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
      const maplibre = (await import('maplibre-gl')).default;
      markerObjs.current.forEach((m) => m.remove());
      markerObjs.current = [];
      for (const mk of markers) {
        const el = document.createElement('div');
        el.style.width = mk.kind === 'vehicle' ? '30px' : '18px';
        el.style.height = mk.kind === 'vehicle' ? '30px' : '18px';
        el.style.borderRadius = mk.kind === 'vehicle' ? '8px' : '50%';
        el.style.background = COLORS[mk.kind];
        el.style.border = '2px solid #0d1608';
        el.style.boxShadow = '0 0 0 3px rgba(200,255,82,0.25)';
        el.style.opacity = mk.stale ? '0.5' : '1';
        el.title = mk.label || mk.kind;
        if (mk.kind === 'vehicle') el.textContent = '🚕';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.fontSize = '14px';
        const marker = new maplibre.Marker({ element: el }).setLngLat([mk.lng, mk.lat]).addTo(map);
        markerObjs.current.push(marker);
      }
      // Fit to markers if more than one
      if (markers.length >= 2) {
        const b = new maplibre.LngLatBounds();
        markers.forEach((m) => b.extend([m.lng, m.lat]));
        map.fitBounds(b, { padding: fitPadding ?? 70, maxZoom: 12, duration: 400 });
      } else if (markers.length === 1) {
        map.easeTo({ center: [markers[0].lng, markers[0].lat], zoom: 12, duration: 400 });
      }
    })();
  }, [markers, ready]);

  // Zoom to a focus point (e.g. the passenger's detected location), once per change.
  const focusKey = focus ? `${focus.lat.toFixed(5)},${focus.lng.toFixed(5)}` : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    map.easeTo({ center: [focus.lng, focus.lat], zoom: 15, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, ready]);

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

  return <div ref={containerRef} className={className} aria-label="Map" role="application" />;
}
