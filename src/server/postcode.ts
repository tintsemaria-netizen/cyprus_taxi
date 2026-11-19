import { config } from '@/lib/config';
import { googleConfigured } from '@/server/google';
import { nearestPostcode } from '@/server/osm/search';

// Destination postcode (2026-11-19): shown on every order so a driver sees at a glance which area
// the ride goes to. Cyprus postcodes are 4 digits (north: 5-digit Turkish codes). Order of sources:
// the address text itself → own address base (2026-11-19) → Google reverse geocoding → Photon. Never blocks a
// booking for long: each lookup is time-boxed and any failure just means «no postcode».

const TIMEOUT_MS = 2000;
const cache = new Map<string, string | null>();

/** Postcode written in an address line, e.g. «…, Limassol 3025, Cyprus» → 3025. */
export function postcodeFromLabel(label: string): string | null {
  const m = label.match(/(?:^|[\s,])(\d{4,5})(?=\s*(?:,|$)\s*(?:Cyprus|Κύπρος|Kıbrıs|Кипр)?)/i)
    ?? label.match(/[A-Za-zΑ-Ωα-ωά-ώ.]\s(\d{4})(?:,|$)/);
  if (!m) return null;
  const code = m[1];
  return /^[1-9]\d{3}$|^99\d{3}$/.test(code) ? code : null;
}

async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'IL-Y taxi (il-y.taxi)' } }); return r.ok ? await r.json() : null; }
  finally { clearTimeout(t); }
}

async function googlePostcode(lat: number, lng: number): Promise<string | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=postal_code&key=${config.googleServerKey()}`;
  const d = (await getJson(url)) as { results?: { address_components?: { long_name?: string; types?: string[] }[] }[] } | null;
  for (const r of d?.results ?? []) for (const c of r.address_components ?? []) if (c.types?.includes('postal_code') && c.long_name) return c.long_name;
  return null;
}

async function photonPostcode(lat: number, lng: number): Promise<string | null> {
  const d = (await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`)) as { features?: { properties?: { postcode?: string } }[] } | null;
  const pc = d?.features?.[0]?.properties?.postcode?.trim();
  return pc && /^\d{4,5}$/.test(pc) ? pc : null;
}

export async function lookupPostcode(lat: number, lng: number, label?: string | null): Promise<string | null> {
  const fromLabel = label ? postcodeFromLabel(label) : null;
  if (fromLabel) return fromLabel;
  if (process.env.VITEST) return null; // tests never reach the network
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key)!;
  let pc: string | null = null;
  try { pc = await nearestPostcode(lat, lng, 600); } catch { /* base not ready */ }
  if (!pc) { try { if (googleConfigured()) pc = await googlePostcode(lat, lng); } catch { /* fall through */ } }
  if (!pc) { try { pc = await photonPostcode(lat, lng); } catch { /* none */ } }
  if (cache.size > 2000) cache.clear();
  cache.set(key, pc);
  return pc;
}
