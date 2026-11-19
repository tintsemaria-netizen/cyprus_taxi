import { readPbf, type Tags } from './pbf';
import { placeFold } from '@/lib/placeFold';

// Cyprus address base builder (2026-11-19). From OpenStreetMap extracts it keeps EVERY named place a
// passenger could ask for — towns, villages, hamlets, hotels (also the small village guest houses),
// restaurants, cafés, schools, churches, monasteries, beaches, hospitals, clinics, pharmacies,
// shops, sights, marinas, airports… — plus every named street (one row per street per town) and
// every house address. Each row gets a postcode: its own, else the postal-code area it lies in,
// else the nearest address that has one (≤ 500 m).

export interface OsmPlaceRow {
  id: string; kind: string; name: string; street: string | null; housenumber: string | null;
  locality: string | null; postcode: string | null; postcodeExact: boolean;
  lat: number; lng: number; importance: number; search: string;
  /** Folded names only (for «the name itself matches» ranking). */
  nameFold: string;
}

// ---- display transliteration (Greek → Latin, keeps capitals) ----
const G: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x',
  ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
export function greekToLatin(s: string): string {
  if (!/[Ͱ-Ͽἀ-῿]/.test(s)) return s;
  const plain = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i], lo = ch.toLowerCase(), next = (plain[i + 1] ?? '').toLowerCase();
    const upper = ch !== lo;
    let rep: string | undefined; let skip = 0;
    if (lo === 'ο' && next === 'υ') { rep = 'ou'; skip = 1; }
    else if ((lo === 'α' || lo === 'ε') && next === 'υ') { rep = (lo === 'α' ? 'a' : 'e') + 'v'; skip = 1; }
    else if (lo === 'μ' && next === 'π' && (i === 0 || /\s/.test(plain[i - 1]))) { rep = 'b'; skip = 1; }
    else if (lo === 'ν' && next === 'τ' && (i === 0 || /\s/.test(plain[i - 1]))) { rep = 'd'; skip = 1; }
    else if (lo === 'γ' && (next === 'γ' || next === 'κ')) { rep = 'n'; }
    else rep = G[lo];
    if (rep === undefined) { out += ch; continue; }
    out += upper ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep;
    i += skip;
  }
  return out;
}

// ---- what counts as a place ----
const EXCLUDE_AMENITY = new Set(['atm', 'recycling', 'bench', 'waste_basket', 'waste_disposal', 'vending_machine', 'parking_space', 'bicycle_parking', 'motorcycle_parking', 'charging_station', 'drinking_water', 'shelter', 'telephone', 'post_box', 'clock', 'grit_bin', 'hunting_stand', 'water_point', 'toilets', 'parking_entrance', 'bbq', 'fountain']);
const FOOD = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'nightclub', 'biergarten', 'food_court']);
const SCHOOL = new Set(['school', 'kindergarten', 'college', 'university', 'language_school', 'music_school', 'driving_school', 'childcare']);
const CLINIC = new Set(['clinic', 'doctors', 'dentist', 'veterinary']);
const HOTEL = new Set(['hotel', 'motel', 'hostel', 'guest_house', 'apartment', 'chalet', 'camp_site', 'caravan_site', 'alpine_hut']);
const SIGHT = new Set(['attraction', 'museum', 'viewpoint', 'zoo', 'theme_park', 'gallery', 'aquarium']);
const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian', 'road', 'track', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link']);

export function classify(t: Tags): { kind: string; importance: number } | null {
  const a = t.amenity, tr = t.tourism, pl = t.place, le = t.leisure, nat = t.natural;
  if (pl) {
    if (pl === 'city') return { kind: 'city', importance: 100 };
    if (pl === 'town') return { kind: 'town', importance: 92 };
    if (pl === 'village') return { kind: 'village', importance: 75 };
    if (pl === 'suburb' || pl === 'quarter' || pl === 'neighbourhood' || pl === 'borough') return { kind: 'district', importance: 62 };
    if (pl === 'hamlet' || pl === 'isolated_dwelling' || pl === 'locality' || pl === 'farm' || pl === 'plot') return { kind: 'village', importance: 55 };
    if (pl === 'square') return { kind: 'square', importance: 45 };
    if (pl === 'island' || pl === 'islet') return { kind: 'nature', importance: 30 };
  }
  if (t.aeroway === 'aerodrome' || t.aeroway === 'terminal') return { kind: 'airport', importance: t.iata ? 99 : 60 };
  if (a === 'hospital' || t.healthcare === 'hospital') return { kind: 'hospital', importance: 72 };
  if (a && CLINIC.has(a) || t.healthcare) return { kind: 'clinic', importance: 46 };
  if (a === 'pharmacy') return { kind: 'pharmacy', importance: 40 };
  if (tr && HOTEL.has(tr) || le === 'resort') return { kind: 'hotel', importance: 60 };
  if (a && FOOD.has(a)) return { kind: 'food', importance: 42 };
  if (a && SCHOOL.has(a)) return { kind: a === 'university' || a === 'college' ? 'university' : 'school', importance: a === 'university' ? 58 : 46 };
  if (a === 'place_of_worship' || a === 'monastery' || t.building === 'church' || t.building === 'chapel' || t.building === 'mosque' || t.building === 'monastery') return { kind: 'church', importance: 42 };
  if (nat === 'beach' || le === 'beach_resort') return { kind: 'beach', importance: 62 };
  if (le === 'marina' || t.harbour === 'yes' || t.landuse === 'harbour') return { kind: 'marina', importance: 56 };
  if (a === 'ferry_terminal' || a === 'bus_station') return { kind: 'transport', importance: 50 };
  if (t.shop === 'mall' || t.shop === 'department_store') return { kind: 'mall', importance: 56 };
  if (t.shop === 'supermarket') return { kind: 'shop', importance: 38 };
  if (tr && SIGHT.has(tr) || t.historic) return { kind: 'sight', importance: tr === 'museum' || tr === 'theme_park' || tr === 'zoo' ? 50 : 40 };
  if (le === 'water_park' || le === 'stadium' || le === 'golf_course') return { kind: 'leisure', importance: 50 };
  if (a === 'police' || a === 'townhall' || a === 'courthouse' || a === 'embassy' || t.office === 'government' || t.office === 'diplomatic') return { kind: 'public', importance: 45 };
  if (a === 'cinema' || a === 'theatre' || a === 'arts_centre' || a === 'casino' || a === 'conference_centre' || a === 'events_venue') return { kind: 'leisure', importance: 44 };
  if (t.shop) return { kind: 'shop', importance: 30 };
  if (a === 'fuel' || a === 'car_rental' || a === 'car_wash') return { kind: 'car', importance: 30 };
  if (a === 'parking') return { kind: 'parking', importance: 18 };
  if (a && !EXCLUDE_AMENITY.has(a)) return { kind: 'place', importance: 28 };
  if (le && le !== 'pitch' && le !== 'playground' && le !== 'picnic_table' && le !== 'swimming_pool' && le !== 'garden') return { kind: 'leisure', importance: 32 };
  if (tr === 'information' && t.information === 'office') return { kind: 'place', importance: 28 };
  if (tr && tr !== 'information' && tr !== 'artwork' && tr !== 'picnic_site') return { kind: 'sight', importance: 34 };
  if (nat === 'peak' || nat === 'cape' || nat === 'bay' || nat === 'spring' || nat === 'cave_entrance' || (nat === 'water' && (t.water === 'lake' || t.water === 'reservoir'))) return { kind: 'nature', importance: 28 };
  if (t.office || t.craft || t.club || t.sport || t.man_made === 'lighthouse' || t.man_made === 'pier') return { kind: 'place', importance: 24 };
  if (t.building && t.building !== 'no') return { kind: 'building', importance: 18 };
  return null;
}

const KIND_WORDS: Record<string, string> = {
  hotel: 'hotel отель гостиница apartments', food: 'restaurant ресторан cafe кафе', school: 'school школа', university: 'university университет',
  church: 'church церковь храм', beach: 'beach пляж', hospital: 'hospital больница госпиталь', clinic: 'clinic клиника', pharmacy: 'pharmacy аптека',
  airport: 'airport аэропорт', marina: 'marina марина порт', mall: 'mall молл торговый центр', shop: 'shop магазин', city: '', town: '', village: 'village деревня',
};

function names(t: Tags): string[] {
  const out: string[] = [];
  for (const k of ['name', 'name:en', 'int_name', 'name:el', 'name:ru', 'name:tr', 'alt_name', 'old_name', 'short_name', 'official_name', 'name:de', 'alt_name:en', 'loc_name'])
    if (t[k]) for (const v of t[k].split(';')) if (v.trim()) out.push(v.trim());
  return out;
}

function displayName(t: Tags): string | null {
  const n = t['name:en'] || t.int_name || t.name || t['name:el'] || t['name:tr'];
  return n ? greekToLatin(n) : null;
}

// ---- node coordinate store (sorted ids → binary search) ----
class NodeStore {
  ids: Float64Array; lat: Float32Array; lon: Float32Array; n = 0; sorted = true;
  constructor(cap: number) { this.ids = new Float64Array(cap); this.lat = new Float32Array(cap); this.lon = new Float32Array(cap); }
  add(id: number, la: number, lo: number) {
    if (this.n === this.ids.length) {
      const grow = <T extends Float64Array | Float32Array>(a: T): T => { const b = new (a.constructor as { new (n: number): T })(a.length * 2); b.set(a); return b; };
      this.ids = grow(this.ids); this.lat = grow(this.lat); this.lon = grow(this.lon);
    }
    if (this.n && id < this.ids[this.n - 1]) this.sorted = false;
    this.ids[this.n] = id; this.lat[this.n] = la; this.lon[this.n] = lo; this.n++;
  }
  finish() {
    if (this.sorted) return;
    const idx = Array.from({ length: this.n }, (_, i) => i).sort((x, y) => this.ids[x] - this.ids[y]);
    const ids = new Float64Array(this.n), lat = new Float32Array(this.n), lon = new Float32Array(this.n);
    idx.forEach((j, i) => { ids[i] = this.ids[j]; lat[i] = this.lat[j]; lon[i] = this.lon[j]; });
    this.ids = ids; this.lat = lat; this.lon = lon; this.sorted = true;
  }
  find(id: number): number {
    let lo = 0, hi = this.n - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; const v = this.ids[m]; if (v === id) return m; if (v < id) lo = m + 1; else hi = m - 1; }
    return -1;
  }
}

interface Raw { id: string; tags: Tags; lat: number; lng: number }
interface Seg { ax: number; ay: number; bx: number; by: number }
interface PostalArea { code: string; minx: number; miny: number; maxx: number; maxy: number; segs: Seg[] }

/** Read one .osm.pbf extract into raw tagged objects (with coordinates), streets and postal areas. */
function readExtract(buf: Uint8Array, raws: Raw[], postal: PostalArea[]) {
  // Pass 1: relations — which member ways we need (postal-code boundaries, named areas).
  const needWays = new Set<number>();
  readPbf(buf, { relation: (r) => {
    const t = r.tags; if (!t) return;
    const keep = (t.boundary === 'postal_code' && t.postal_code) || ((t.type === 'multipolygon' || t.type === 'site') && t.name && classify(t));
    if (keep) for (const m of r.members) if (m.type === 1) needWays.add(m.ref);
  } });
  // Pass 2: everything.
  const nodes = new NodeStore(Math.max(1 << 16, Math.ceil(buf.length * 0.16))); // ≈ nodes per byte of PBF
  const wayGeom = new Map<number, Float32Array>(); // member ways: flat lon,lat pairs
  const wayCenter = new Map<number, [number, number]>();
  let finished = false;
  const coords = (refs: number[]) => {
    if (!finished) { nodes.finish(); finished = true; }
    const pts: number[] = [];
    for (const ref of refs) { const i = nodes.find(ref); if (i >= 0) pts.push(nodes.lon[i], nodes.lat[i]); }
    return pts;
  };
  const center = (pts: number[]): [number, number] | null => {
    if (!pts.length) return null;
    let sx = 0, sy = 0; const k = pts.length / 2;
    for (let i = 0; i < pts.length; i += 2) { sx += pts[i]; sy += pts[i + 1]; }
    return [sx / k, sy / k];
  };
  readPbf(buf, {
    node: (n) => {
      nodes.add(n.id, n.lat, n.lon);
      if (n.tags && (n.tags.name || n.tags['addr:housenumber'] || n.tags['name:en'])) raws.push({ id: `n${n.id}`, tags: n.tags, lat: n.lat, lng: n.lon });
    },
    way: (w) => {
      const t = w.tags;
      const want = needWays.has(w.id);
      const tagged = !!(t.name || t['addr:housenumber'] || t['name:en'] || (t.boundary === 'postal_code' && t.postal_code));
      if (!want && !tagged) return;
      const pts = coords(w.refs);
      const c = center(pts); if (!c) return;
      if (want) { wayGeom.set(w.id, Float32Array.from(pts)); wayCenter.set(w.id, c); }
      if (t.boundary === 'postal_code' && t.postal_code) postal.push(area(t.postal_code, [Float32Array.from(pts)]));
      else if (tagged) raws.push({ id: `w${w.id}`, tags: t, lat: c[1], lng: c[0] });
    },
    relation: (r) => {
      const t = r.tags; if (!t) return;
      if (t.boundary === 'postal_code' && t.postal_code) {
        const rings = r.members.filter((m) => m.type === 1 && wayGeom.has(m.ref)).map((m) => wayGeom.get(m.ref)!);
        if (rings.length) postal.push(area(t.postal_code, rings));
        return;
      }
      if (!t.name || !classify(t)) return;
      const cs = r.members.filter((m) => m.type === 1 && wayCenter.has(m.ref) && m.role !== 'inner').map((m) => wayCenter.get(m.ref)!);
      if (!cs.length) return;
      raws.push({ id: `r${r.id}`, tags: t, lng: cs.reduce((s, c) => s + c[0], 0) / cs.length, lat: cs.reduce((s, c) => s + c[1], 0) / cs.length });
    },
  });
}

function area(code: string, rings: Float32Array[]): PostalArea {
  const segs: Seg[] = []; let minx = 999, miny = 999, maxx = -999, maxy = -999;
  for (const r of rings) for (let i = 0; i + 3 < r.length; i += 2) {
    const s = { ax: r[i], ay: r[i + 1], bx: r[i + 2], by: r[i + 3] }; segs.push(s);
    minx = Math.min(minx, s.ax, s.bx); maxx = Math.max(maxx, s.ax, s.bx); miny = Math.min(miny, s.ay, s.by); maxy = Math.max(maxy, s.ay, s.by);
  }
  return { code: code.trim(), minx, miny, maxx, maxy, segs };
}

function inArea(a: PostalArea, x: number, y: number): boolean {
  if (x < a.minx || x > a.maxx || y < a.miny || y > a.maxy) return false;
  let inside = false;
  for (const s of a.segs) if ((s.ay > y) !== (s.by > y) && x < ((s.bx - s.ax) * (y - s.ay)) / (s.by - s.ay) + s.ax) inside = !inside;
  return inside;
}

// ---- spatial grid for "nearest" lookups ----
class Grid<T extends { lat: number; lng: number }> {
  cells = new Map<string, T[]>();
  constructor(public size: number) {}
  key(lat: number, lng: number) { return `${Math.floor(lat / this.size)},${Math.floor(lng / this.size)}`; }
  add(p: T) { const k = this.key(p.lat, p.lng); const c = this.cells.get(k); if (c) c.push(p); else this.cells.set(k, [p]); }
  nearest(lat: number, lng: number, maxM: number, ok: (p: T) => boolean = () => true): T | null {
    const r = Math.ceil(maxM / 111_000 / this.size); const cy = Math.floor(lat / this.size), cx = Math.floor(lng / this.size);
    let best: T | null = null, bd = maxM;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (const p of this.cells.get(`${cy + dy},${cx + dx}`) ?? []) {
      if (!ok(p)) continue; const d = metres(lat, lng, p.lat, p.lng); if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
function metres(a: number, b: number, c: number, d: number) {
  const x = (d - b) * Math.cos(((a + c) / 2) * Math.PI / 180) * 111_320, y = (c - a) * 110_540; return Math.sqrt(x * x + y * y);
}

const PC = /^(\d{4}|99\d{3})$/;

/** Build the address base from one or more .osm.pbf extracts (the island = south + north files). */
export function buildPlaces(files: Uint8Array[]): OsmPlaceRow[] {
  const raws: Raw[] = []; const postal: PostalArea[] = [];
  for (const f of files) readExtract(f, raws, postal);
  // de-duplicate objects present in both extracts
  const seen = new Set<string>(); const objs = raws.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  // settlements for «which town is this in»
  type Settlement = { lat: number; lng: number; name: string; rank: number };
  const towns = new Grid<Settlement>(0.05), districts = new Grid<Settlement>(0.02);
  for (const o of objs) {
    const pl = o.tags.place; const n = displayName(o.tags); if (!pl || !n) continue;
    if (pl === 'city' || pl === 'town' || pl === 'village' || pl === 'hamlet') towns.add({ lat: o.lat, lng: o.lng, name: n, rank: pl === 'city' ? 4 : pl === 'town' ? 3 : pl === 'village' ? 2 : 1 });
    if (pl === 'suburb' || pl === 'quarter' || pl === 'neighbourhood') districts.add({ lat: o.lat, lng: o.lng, name: n, rank: 0 });
  }
  const townOf = (lat: number, lng: number): string | null => {
    const city = towns.nearest(lat, lng, 6000, (s) => s.rank >= 3);
    const near = towns.nearest(lat, lng, 2500);
    const pick = near && (!city || metres(lat, lng, near.lat, near.lng) < 1200) ? near : city ?? near;
    return (pick ?? towns.nearest(lat, lng, 12000))?.name ?? null;
  };

  const rows: OsmPlaceRow[] = [];
  const streets = new Map<string, OsmPlaceRow & { n: number }>();
  for (const o of objs) {
    const t = o.tags;
    const own = (t['addr:postcode'] || t.postal_code || '').trim();
    const street = t['addr:street'] ? greekToLatin(t['addr:street']) : t['addr:place'] ? greekToLatin(t['addr:place']) : null;
    const hn = t['addr:housenumber'] ?? null;
    const name = displayName(t);
    const locality = t.place ? null : (townOf(o.lat, o.lng) ?? (t['addr:city'] ? greekToLatin(t['addr:city']) : null));
    const base = { postcode: PC.test(own) ? own : null, postcodeExact: PC.test(own), lat: o.lat, lng: o.lng, locality };
    const extra = [t['addr:street'], t['addr:city'], locality, ...(t.place ? [] : [])].filter(Boolean).join(' ');
    if (t.highway && ROADS.has(t.highway) && name) {
      const key = `${placeFold(name)}|${locality ?? ''}`;
      const cur = streets.get(key);
      if (cur) { cur.n++; if (!cur.postcode && base.postcode) { cur.postcode = base.postcode; cur.postcodeExact = true; } continue; }
      const row = { id: `s${o.id}`, kind: 'street', name, street: null, housenumber: null, ...base, importance: MAJOR.has(t.highway) ? 50 : 34, nameFold: ` ${placeFold(names(t).join(' '))} `,
        search: ` ${placeFold([...names(t), locality ?? ''].join(' '))} ${placeFold('street улица')} `, n: 1 };
      streets.set(key, row); continue;
    }
    const cls = name ? classify(t) : null;
    if (name && cls) {
      rows.push({ id: o.id, kind: cls.kind, name, street, housenumber: hn, ...base, importance: cls.importance, nameFold: ` ${placeFold(names(t).join(' '))} `,
        search: ` ${placeFold([...names(t), extra, KIND_WORDS[cls.kind] ?? ''].join(' '))} ` });
    } else if (hn && street) {
      rows.push({ id: o.id, kind: 'address', name: `${street} ${hn}`, street, housenumber: hn, ...base, importance: 12, nameFold: ` ${placeFold(`${t['addr:street']} ${street} ${hn}`)} `,
        search: ` ${placeFold([t['addr:street'], street, hn, t['addr:city'] ?? '', locality ?? ''].join(' '))} ` });
    }
  }
  for (const s of streets.values()) { const { n, ...row } = s; void n; rows.push(row); }

  // the same place drawn twice (a point and an outline, or in both extracts) → keep one
  const twins = new Map<string, OsmPlaceRow[]>();
  const unique: OsmPlaceRow[] = [];
  for (const r of rows.sort((a, b) => b.importance - a.importance || (a.postcode ? -1 : 1))) {
    if (r.kind === 'address' || r.kind === 'street') { unique.push(r); continue; }
    const k = `${r.kind}|${placeFold(r.name)}`; const list = twins.get(k) ?? [];
    if (list.some((x) => metres(x.lat, x.lng, r.lat, r.lng) < (r.kind === 'airport' || r.kind === 'city' || r.kind === 'town' ? 5000 : 800))) continue;
    list.push(r); twins.set(k, list); unique.push(r);
  }
  rows.length = 0; rows.push(...unique);

  // postcodes: own → postal area polygon → nearest exact one ≤ 500 m
  for (const r of rows) {
    if (r.postcode) continue;
    const a = postal.find((p) => inArea(p, r.lng, r.lat));
    if (a && PC.test(a.code)) { r.postcode = a.code; r.postcodeExact = true; }
  }
  const exact = new Grid<OsmPlaceRow>(0.01);
  for (const r of rows) if (r.postcode && r.postcodeExact) exact.add(r);
  for (const r of rows) {
    if (r.postcode) continue;
    // nearest known postcode: 500 m for addresses/streets/places in town; up to 3 km for airports,
    // villages, beaches and the like that lie outside the mapped postal areas
    const n = exact.nearest(r.lat, r.lng, 500) ?? exact.nearest(r.lat, r.lng, 3000);
    if (n) { r.postcode = n.postcode; r.postcodeExact = false; }
  }
  // the postcode is searchable too («3025»)
  for (const r of rows) if (r.postcode) r.search += `${r.postcode} `;
  return rows;
}
