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
import { currentTheme } from '@/lib/theme';

export type Poly = [number, number][];
export interface RefZone { id: string; name: string; polygon: Poly; color: string; label?: string; labelAt?: [number, number]; strong?: boolean; holes?: Poly[] }

// Price label on the map (2026-11-21): a small pill in the zone's colour.
function pillSvg(text: string, color: string): { url: string; w: number; h: number } {
  const w = Math.round(text.length * 7.2 + 18), h = 24;
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="11" fill="${color}" stroke="#0b0f10" stroke-opacity="0.4"/><text x="${w / 2}" y="16.5" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="12.5" font-weight="700" fill="#0b0f10">${esc}</text></svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, w, h };
}

interface Props {
  center: { lat: number; lng: number };
  airport: { lat: number; lng: number };
  zones: RefZone[];
  editing: Poly | null; // null = not editing
  onChange: (p: Poly) => void;
  /** A click on the map when no polygon is being drawn (e.g. «the ring's edge goes through here»). */
  onPick?: (lat: number, lng: number) => void;
  /** Zones inside the one being drawn: shown cut out, so a belt looks like a band from its inner zone outwards. */
  editingHoles?: Poly[];
  /** Show this box ([south, west, north, east]); re-fitted whenever its value changes. */
  fit?: [number, number, number, number] | null;
  className?: string;
}

const LIME = '#C8FF46';

export default function ZoneEditorMap(props: Props) {
  return googleEnabled() ? <GoogleZoneMap {...props} /> : <LibreZoneMap {...props} />;
}

// ---------- Google ----------
function GoogleZoneMap({ center, airport, zones, editing, editingHoles, onChange, onPick, fit, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st = useRef<{ g: any; map: any; edit: any; refs: any[]; airport: any; labels: any[] } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
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
        if (!editingRef.current) { onPickRef.current?.(e.latLng.lat(), e.latLng.lng()); return; }
        onChangeRef.current([...editingRef.current, [e.latLng.lat(), e.latLng.lng()]]);
      });
      st.current = { g, map, edit: null, refs: [], airport: null, labels: [] };
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
    s.refs = zones.map((z) => new g.Polygon({ map, paths: [z.polygon, ...(z.holes ?? []).map((h) => h.slice().reverse())].map((r) => r.map(([lat, lng]) => ({ lat, lng }))), strokeColor: z.color, strokeWeight: z.strong ? 3 : 2, fillColor: z.color, fillOpacity: z.strong ? 0.2 : 0.08, clickable: false, zIndex: z.strong ? 5 : 1 }));
    s.labels.forEach((m) => m.setMap(null));
    s.labels = zones.filter((z) => z.label && z.labelAt).map((z) => {
      const pill = pillSvg(z.label!, z.color);
      return new g.Marker({ map, position: { lat: z.labelAt![0], lng: z.labelAt![1] }, clickable: false, zIndex: z.strong ? 30 : 20,
        icon: { url: pill.url, scaledSize: new g.Size(pill.w, pill.h), anchor: new g.Point(pill.w / 2, pill.h / 2) } });
    });
    s.airport?.setMap?.(null);
    s.airport = new g.Circle({ map, center: airport, radius: 2500, strokeColor: '#ffffff', strokeOpacity: 0.6, strokeWeight: 1, fillOpacity: 0.05, clickable: false });
    if (s.edit) { const ep = s.edit.getPath(); if (ep) g.event.clearInstanceListeners(ep); s.edit.setMap(null); s.edit = null; }
    if (editing) {
      // paths as ONE explicit ring (2026-11-21 fix): with a flat empty array (a new zone, no corners yet)
      // Google creates no ring, getPath() is undefined and «+ Новая зона» crashed the page.
      const poly = new g.Polygon({ map, paths: [editing.map(([lat, lng]) => ({ lat, lng }))], strokeColor: LIME, strokeWeight: 3, fillColor: LIME, fillOpacity: editingHoles?.length ? 0.08 : 0.2, editable: true, zIndex: 10 });
      const sync = () => {
        const path = poly.getPath();
        if (!path) return;
        const pts: Poly = [];
        for (let i = 0; i < path.getLength(); i++) { const p = path.getAt(i); pts.push([p.lat(), p.lng()]); }
        onChangeRef.current(pts);
      };
      const path = poly.getPath();
      path?.addListener('set_at', sync); path?.addListener('insert_at', sync); path?.addListener('remove_at', sync);
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
  const fitKey = fit ? fit.join(',') : '';
  useEffect(() => {
    if (!fit) return;
    const go = () => { const m = st.current?.map; if (!m) return false; m.fitBounds({ south: fit[0], west: fit[1], north: fit[2], east: fit[3] }, 24); return true; };
    if (!go()) { const id = setInterval(() => { if (go()) clearInterval(id); }, 300); return () => clearInterval(id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={ref} dir="ltr" className={className} data-testid="zone-map" />;
}

// ---------- MapLibre ----------
function LibreZoneMap({ center, airport, zones, editing, editingHoles, onChange, onPick, fit, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const libRef = useRef<typeof maplibregl | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const labelMarkers = useRef<maplibregl.Marker[]>([]);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
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
        style: { version: 8, sources: { osm: { type: 'raster', tiles: [currentTheme() === 'light' ? publicMapConfig.tilesLight : publicMapConfig.tiles], tileSize: 256, attribution: publicMapConfig.attribution } },
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
        if (!editingRef.current) { onPickRef.current?.(e.lngLat.lat, e.lngLat.lng); return; }
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
      ...zones.filter((z) => z.polygon.length >= 3).map((z) => ({ type: 'Feature', properties: { color: z.color, op: z.strong ? 0.2 : 0.08, w: z.strong ? 3 : 2 }, geometry: { type: 'Polygon', coordinates: [ring(z.polygon), ...(z.holes ?? []).map((h) => ring(h.slice().reverse()))] } })),
      ...(editing && editing.length >= 2 ? [{ type: 'Feature', properties: { color: LIME, op: editing.length >= 3 ? 0.2 : 0, w: 3 }, geometry: { type: 'Polygon', coordinates: [ring(editing), ...(editing.length >= 3 ? (editingHoles ?? []).map((h) => ring(h.slice().reverse())) : [])] } }] : []),
    ];
    (map.getSource('zones') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats } as never);
    labelMarkers.current.forEach((m) => m.remove());
    labelMarkers.current = zones.filter((z) => z.label && z.labelAt).map((z) => {
      const el = document.createElement('div');
      el.textContent = z.label!;
      el.style.cssText = `background:${z.color};color:#0b0f10;font:700 12.5px Inter,Arial,sans-serif;padding:3px 9px;border-radius:11px;white-space:nowrap;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.4)`;
      return new lib.Marker({ element: el }).setLngLat([z.labelAt![1], z.labelAt![0]]).addTo(map);
    });
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
  const fitKey = fit ? fit.join(',') : '';
  useEffect(() => {
    if (!fit) return;
    const go = () => { const m = mapRef.current; if (!m || !ready.current) return false; m.fitBounds([[fit[1], fit[0]], [fit[3], fit[2]]], { padding: 24, duration: 400 }); return true; };
    if (!go()) { const id = setInterval(() => { if (go()) clearInterval(id); }, 300); return () => clearInterval(id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={ref} dir="ltr" className={className} data-testid="zone-map" />;
}
