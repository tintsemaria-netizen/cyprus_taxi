'use client';

// Map editor for fixed-fare zones (2026-11-17). Tap the map to add a corner, drag a corner to
// move it. Other zones are drawn faded for reference. Google Maps when a browser key is set
// (editable polygon with draggable corners and mid-points), MapLibre otherwise.
import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { loadMaplibre } from '@/lib/maplibre';
import { googleEnabled, loadGoogleMaps, MAP_ID } from '@/lib/google-maps';
import { publicMapConfig } from '@/lib/config';

export type Poly = [number, number][];
export interface RefZone { id: string; name: string; polygon: Poly; color: string }

interface Props {
  center: { lat: number; lng: number };
  airport: { lat: number; lng: number };
  zones: RefZone[];
  editing: Poly | null; // null = not editing
  onChange: (p: Poly) => void;
  className?: string;
}

const LIME = '#C8FF46';

export default function ZoneEditorMap(props: Props) {
  return googleEnabled() ? <GoogleZoneMap {...props} /> : <LibreZoneMap {...props} />;
}

// ---------- Google ----------
function GoogleZoneMap({ center, airport, zones, editing, onChange, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st = useRef<{ g: any; map: any; edit: any; refs: any[]; airport: any } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useEffect(() => {
    let dead = false;
    void loadGoogleMaps().then((g) => {
      if (dead || !ref.current) return;
      const map = new g.Map(ref.current, {
        center, zoom: 12, mapId: MAP_ID || undefined, colorScheme: 'DARK', disableDefaultUI: true,
        zoomControl: true, gestureHandling: 'greedy', clickableIcons: false,
      });
      map.addListener('click', (e: { latLng: { lat: () => number; lng: () => number } }) => {
        if (!editingRef.current) return;
        onChangeRef.current([...editingRef.current, [e.latLng.lat(), e.latLng.lng()]]);
      });
      st.current = { g, map, edit: null, refs: [], airport: null };
      draw();
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const s = st.current;
    if (!s) return;
    const { g, map } = s;
    s.refs.forEach((p) => p.setMap(null));
    s.refs = zones.map((z) => new g.Polygon({ map, paths: z.polygon.map(([lat, lng]) => ({ lat, lng })), strokeColor: z.color, strokeWeight: 2, fillColor: z.color, fillOpacity: 0.12, clickable: false }));
    s.airport?.setMap?.(null);
    s.airport = new g.Circle({ map, center: airport, radius: 2500, strokeColor: '#ffffff', strokeOpacity: 0.6, strokeWeight: 1, fillOpacity: 0.05, clickable: false });
    if (s.edit) { g.event.clearInstanceListeners(s.edit.getPath()); s.edit.setMap(null); s.edit = null; }
    if (editing) {
      const poly = new g.Polygon({ map, paths: editing.map(([lat, lng]) => ({ lat, lng })), strokeColor: LIME, strokeWeight: 3, fillColor: LIME, fillOpacity: 0.2, editable: true, zIndex: 10 });
      const sync = () => {
        const path = poly.getPath();
        const pts: Poly = [];
        for (let i = 0; i < path.getLength(); i++) { const p = path.getAt(i); pts.push([p.lat(), p.lng()]); }
        onChangeRef.current(pts);
      };
      const path = poly.getPath();
      path.addListener('set_at', sync); path.addListener('insert_at', sync); path.addListener('remove_at', sync);
      // A click on the polygon itself also adds a corner (else clicks inside would be swallowed).
      poly.addListener('click', (e: { latLng: { lat: () => number; lng: () => number }; vertex?: number }) => {
        if (e.vertex != null) return;
        onChangeRef.current([...(editingRef.current ?? []), [e.latLng.lat(), e.latLng.lng()]]);
      });
      s.edit = poly;
    }
  }

  useEffect(() => { draw(); }); // cheap: a handful of polygons
  useEffect(() => { st.current?.map?.panTo(center); }, [center]);

  return <div ref={ref} dir="ltr" className={className} data-testid="zone-map" />;
}

// ---------- MapLibre ----------
function LibreZoneMap({ center, airport, zones, editing, onChange, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const libRef = useRef<typeof maplibregl | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const ready = useRef(false);

  useEffect(() => {
    let dead = false;
    void loadMaplibre().then((mod) => {
      const lib = mod as unknown as typeof maplibregl;
      if (dead || !ref.current) return;
      libRef.current = lib;
      const map = new lib.Map({
        container: ref.current, center: [center.lng, center.lat], zoom: 11.5, attributionControl: { compact: true },
        style: { version: 8, sources: { osm: { type: 'raster', tiles: [publicMapConfig.tiles], tileSize: 256, attribution: publicMapConfig.attribution } },
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0e1416' } }, { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.9, 'raster-brightness-max': 0.9 } }] },
      });
      map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] } });
        map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'] } });
        ready.current = true;
        draw();
      });
      map.on('click', (e) => {
        if (!editingRef.current) return;
        onChangeRef.current([...editingRef.current, [e.lngLat.lat, e.lngLat.lng]]);
      });
      mapRef.current = map;
    });
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ring(p: Poly) { const r = p.map(([lat, lng]) => [lng, lat]); return r.length ? [...r, r[0]] : r; }
  function circle(c: { lat: number; lng: number }, m: number) {
    const pts: number[][] = [];
    for (let i = 0; i <= 48; i++) { const a = (2 * Math.PI * i) / 48; pts.push([c.lng + (m / 111_320 / Math.cos((c.lat * Math.PI) / 180)) * Math.sin(a), c.lat + (m / 110_540) * Math.cos(a)]); }
    return pts;
  }

  function draw() {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !ready.current) return;
    const feats = [
      { type: 'Feature', properties: { color: '#ffffff', op: 0.05, w: 1 }, geometry: { type: 'Polygon', coordinates: [circle(airport, 2500)] } },
      ...zones.filter((z) => z.polygon.length >= 3).map((z) => ({ type: 'Feature', properties: { color: z.color, op: 0.12, w: 2 }, geometry: { type: 'Polygon', coordinates: [ring(z.polygon)] } })),
      ...(editing && editing.length >= 2 ? [{ type: 'Feature', properties: { color: LIME, op: editing.length >= 3 ? 0.2 : 0, w: 3 }, geometry: { type: 'Polygon', coordinates: [ring(editing)] } }] : []),
    ];
    (map.getSource('zones') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats } as never);
    markers.current.forEach((m) => m.remove());
    markers.current = (editing ?? []).map(([lat, lng], i) => {
      const el = document.createElement('div');
      el.style.cssText = `width:16px;height:16px;border-radius:50%;background:${LIME};border:2px solid #10191C;cursor:grab`;
      el.dataset.testid = 'zone-vertex';
      el.addEventListener('click', (e) => e.stopPropagation());
      const mk = new lib.Marker({ element: el, draggable: true }).setLngLat([lng, lat]).addTo(map);
      mk.on('dragend', () => {
        const ll = mk.getLngLat();
        const cur = [...(editingRef.current ?? [])];
        cur[i] = [ll.lat, ll.lng];
        onChangeRef.current(cur);
      });
      return mk;
    });
  }

  useEffect(() => { draw(); });
  useEffect(() => { mapRef.current?.easeTo({ center: [center.lng, center.lat] }); }, [center]);

  return <div ref={ref} dir="ltr" className={className} data-testid="zone-map" />;
}
