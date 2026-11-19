import { inflateSync } from 'node:zlib';

// Minimal, dependency-free OpenStreetMap PBF reader (2026-11-19) for the Cyprus address base.
// Streams primitive blocks out of an .osm.pbf buffer: nodes (plain + dense), ways (with node refs)
// and relations (with members). Coordinates in degrees. Ids are JS numbers (safe up to 2^53).

export type Tags = Record<string, string>;
export interface PNode { id: number; lat: number; lon: number; tags: Tags | null }
export interface PWay { id: number; refs: number[]; tags: Tags }
export interface PMember { type: 0 | 1 | 2; ref: number; role: string }
export interface PRelation { id: number; members: PMember[]; tags: Tags }
export interface Handlers {
  node?: (n: PNode) => void;
  way?: (w: PWay) => void;
  relation?: (r: PRelation) => void;
}

interface Deg { lat: (v: number) => number; lon: (v: number) => number }

class Reader {
  pos: number;
  constructor(public buf: Uint8Array, start = 0, public end = buf.length) { this.pos = start; }
  done() { return this.pos >= this.end; }
  varint(): number {
    let result = 0, mul = 1, b: number;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return result;
  }
  svarint(): number { const n = this.varint(); return n % 2 === 1 ? -(n + 1) / 2 : n / 2; }
  bytes(): [number, number] { const len = this.varint(); const s = this.pos; this.pos += len; return [s, this.pos]; }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const len = this.varint(); this.pos += len; }
    else if (wire === 5) this.pos += 4;
    else throw new Error(`pbf: wire type ${wire}`);
  }
  /** Packed varints of a length-delimited field. */
  packed(signed: boolean): number[] {
    const [s, e] = this.bytes();
    const r = new Reader(this.buf, s, e); const out: number[] = [];
    while (!r.done()) out.push(signed ? r.svarint() : r.varint());
    return out;
  }
}

const dec = new TextDecoder();

function blockStrings(buf: Uint8Array, s: number, e: number): string[] {
  const r = new Reader(buf, s, e); const out: string[] = [];
  while (!r.done()) {
    const key = r.varint();
    if (key >> 3 === 1 && (key & 7) === 2) { const [a, b] = r.bytes(); out.push(dec.decode(buf.subarray(a, b))); }
    else r.skip(key & 7);
  }
  return out;
}

function tagsOf(keys: number[], vals: number[], st: string[]): Tags | null {
  if (!keys.length) return null;
  const t: Tags = {};
  for (let i = 0; i < keys.length; i++) t[st[keys[i]]] = st[vals[i]];
  return t;
}

function primitiveBlock(buf: Uint8Array, h: Handlers) {
  const r = new Reader(buf);
  let st: string[] = [];
  const groups: [number, number][] = [];
  let gran = 100, latOff = 0, lonOff = 0;
  while (!r.done()) {
    const key = r.varint(); const f = key >> 3, w = key & 7;
    if (f === 1 && w === 2) { const [s, e] = r.bytes(); st = blockStrings(buf, s, e); }
    else if (f === 2 && w === 2) groups.push(r.bytes());
    else if (f === 17 && w === 0) gran = r.varint();
    else if (f === 19 && w === 0) latOff = r.svarint();
    else if (f === 20 && w === 0) lonOff = r.svarint();
    else r.skip(w);
  }
  const deg: Deg = { lat: (v) => (latOff + gran * v) / 1e9, lon: (v) => (lonOff + gran * v) / 1e9 };
  for (const [gs, ge] of groups) {
    const g = new Reader(buf, gs, ge);
    while (!g.done()) {
      const key = g.varint(); const f = key >> 3, w = key & 7;
      if (w !== 2) { g.skip(w); continue; }
      const [s, e] = g.bytes();
      if (f === 2 && h.node) dense(buf, s, e, st, deg, h.node);
      else if (f === 1 && h.node) plainNode(buf, s, e, st, deg, h.node);
      else if (f === 3 && h.way) way(buf, s, e, st, h.way);
      else if (f === 4 && h.relation) relation(buf, s, e, st, h.relation);
    }
  }
}

function dense(buf: Uint8Array, s: number, e: number, st: string[], deg: Deg, cb: (n: PNode) => void) {
  const r = new Reader(buf, s, e);
  let ids: number[] = [], lats: number[] = [], lons: number[] = [], kv: number[] = [];
  while (!r.done()) {
    const key = r.varint(); const f = key >> 3, w = key & 7;
    if (f === 1 && w === 2) ids = r.packed(true);
    else if (f === 8 && w === 2) lats = r.packed(true);
    else if (f === 9 && w === 2) lons = r.packed(true);
    else if (f === 10 && w === 2) kv = r.packed(false);
    else r.skip(w);
  }
  let id = 0, lat = 0, lon = 0, k = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i]; lat += lats[i]; lon += lons[i];
    let tags: Tags | null = null;
    if (kv.length) {
      while (k < kv.length && kv[k] !== 0) { (tags ??= {})[st[kv[k]]] = st[kv[k + 1]]; k += 2; }
      k++;
    }
    cb({ id, lat: deg.lat(lat), lon: deg.lon(lon), tags });
  }
}

function plainNode(buf: Uint8Array, s: number, e: number, st: string[], deg: Deg, cb: (n: PNode) => void) {
  const r = new Reader(buf, s, e);
  let id = 0, lat = 0, lon = 0, keys: number[] = [], vals: number[] = [];
  while (!r.done()) {
    const key = r.varint(); const f = key >> 3, w = key & 7;
    if (f === 1 && w === 0) id = r.svarint();
    else if (f === 2 && w === 2) keys = r.packed(false);
    else if (f === 3 && w === 2) vals = r.packed(false);
    else if (f === 8 && w === 0) lat = r.svarint();
    else if (f === 9 && w === 0) lon = r.svarint();
    else r.skip(w);
  }
  cb({ id, lat: deg.lat(lat), lon: deg.lon(lon), tags: tagsOf(keys, vals, st) });
}

function way(buf: Uint8Array, s: number, e: number, st: string[], cb: (w: PWay) => void) {
  const r = new Reader(buf, s, e);
  let id = 0, keys: number[] = [], vals: number[] = [], refs: number[] = [];
  while (!r.done()) {
    const key = r.varint(); const f = key >> 3, w = key & 7;
    if (f === 1 && w === 0) id = r.varint();
    else if (f === 2 && w === 2) keys = r.packed(false);
    else if (f === 3 && w === 2) vals = r.packed(false);
    else if (f === 8 && w === 2) refs = r.packed(true);
    else r.skip(w);
  }
  let acc = 0; for (let i = 0; i < refs.length; i++) { acc += refs[i]; refs[i] = acc; }
  cb({ id, refs, tags: tagsOf(keys, vals, st) ?? {} });
}

function relation(buf: Uint8Array, s: number, e: number, st: string[], cb: (r: PRelation) => void) {
  const r = new Reader(buf, s, e);
  let id = 0, keys: number[] = [], vals: number[] = [], roles: number[] = [], memids: number[] = [], types: number[] = [];
  while (!r.done()) {
    const key = r.varint(); const f = key >> 3, w = key & 7;
    if (f === 1 && w === 0) id = r.varint();
    else if (f === 2 && w === 2) keys = r.packed(false);
    else if (f === 3 && w === 2) vals = r.packed(false);
    else if (f === 8 && w === 2) roles = r.packed(false);
    else if (f === 9 && w === 2) memids = r.packed(true);
    else if (f === 10 && w === 2) types = r.packed(false);
    else r.skip(w);
  }
  let acc = 0; const members: PMember[] = [];
  for (let i = 0; i < memids.length; i++) { acc += memids[i]; members.push({ type: (types[i] ?? 0) as 0 | 1 | 2, ref: acc, role: st[roles[i]] ?? '' }); }
  cb({ id, members, tags: tagsOf(keys, vals, st) ?? {} });
}

/** Walk every primitive in an .osm.pbf buffer (file order: nodes, ways, relations). */
export function readPbf(file: Uint8Array, h: Handlers) {
  let pos = 0;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  while (pos + 4 <= file.length) {
    const hlen = view.getUint32(pos); pos += 4;
    const hr = new Reader(file, pos, pos + hlen);
    let type = '', size = 0;
    while (!hr.done()) {
      const key = hr.varint(); const f = key >> 3, w = key & 7;
      if (f === 1 && w === 2) { const [a, b] = hr.bytes(); type = dec.decode(file.subarray(a, b)); }
      else if (f === 3 && w === 0) size = hr.varint();
      else hr.skip(w);
    }
    pos += hlen;
    const br = new Reader(file, pos, pos + size);
    pos += size;
    if (type !== 'OSMData') continue;
    let data: Uint8Array | null = null;
    while (!br.done()) {
      const key = br.varint(); const f = key >> 3, w = key & 7;
      if (f === 1 && w === 2) { const [a, b] = br.bytes(); data = file.subarray(a, b); }
      else if (f === 3 && w === 2) { const [a, b] = br.bytes(); data = inflateSync(file.subarray(a, b)); }
      else br.skip(w);
    }
    if (data) primitiveBlock(data, h);
  }
}
