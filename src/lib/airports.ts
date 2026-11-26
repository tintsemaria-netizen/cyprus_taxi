import { pointInPolygon } from '@/lib/geo';

// Cyprus airports. Trips to/from them have official fixed fares set by the Road Transport
// Department, so a meter estimate can differ from what the driver legitimately charges, and a
// driver meets the passenger at the terminal rather than at an exact GPS point.
//
// WHERE the airport is (operator 2026-11-25): a pickup territory («Зоны подачи») marked «это аэропорт».
// No fixed circle any more — a point counts as the airport only inside such a territory. No territory
// marked for an airport → that airport is not recognised (no fixed fares from it) until the admin marks one.
// The terminal point below is only the map centre for the admin screens.
export const AIRPORTS = [
  { code: 'LCA', lat: 34.8751, lng: 33.6249 }, // Larnaca
  { code: 'PFO', lat: 34.718, lng: 32.4857 }, // Paphos
  { code: 'ECN', lat: 35.1547, lng: 33.4961 }, // Ercan (north, 2026-11-26, operator) — counts once the admin marks its territory
] as const;
export type AirportCode = (typeof AIRPORTS)[number]['code'];
export const AIRPORT_CODES = AIRPORTS.map((a) => a.code) as unknown as [AirportCode, ...AirportCode[]];

/** An airport area: the (rounded) outline of a territory marked as that airport. */
export interface AirportArea { code: string; polygon: [number, number][] }

// The current areas. Filled by the server from the DB (server/no-go.ts, cached) and in the passenger
// app from /api/v1/no-go. Tests pin their own areas so a DB load does not replace them.
let areas: AirportArea[] = [];
let pinned = false;
/** A no-go zone chosen for an airport's fixed prices (2026-11-26): the zone itself plus a small square (~40 m) around
 *  each of its pickup / drop-off points — they stand next to the zone, and the trip starts / ends there. */
export function zoneAirportAreas(code: string, polygon: [number, number][], spots: { lat: number; lng: number }[]): AirportArea[] {
  const sq = (p: { lat: number; lng: number }): [number, number][] => {
    const dl = 40 / 110540, dn = 40 / (111320 * Math.cos((p.lat * Math.PI) / 180));
    return [[p.lat - dl, p.lng - dn], [p.lat - dl, p.lng + dn], [p.lat + dl, p.lng + dn], [p.lat + dl, p.lng - dn]];
  };
  return [{ code, polygon }, ...spots.map((s) => ({ code, polygon: sq(s) }))];
}
export function setAirportAreas(list: AirportArea[]): void { if (!pinned) areas = list; }
/** Tests: fix the areas (null = back to normal, loaded from the DB). */
export function pinAirportAreas(list: AirportArea[] | null): void { pinned = !!list; areas = list ?? []; }
export const airportAreas = (): AirportArea[] => areas;

/** The airport a point belongs to (inside a territory marked as that airport), or null. */
export function airportAt(lat: number, lng: number): AirportCode | null {
  for (const a of areas) {
    if (a.polygon.length >= 3 && pointInPolygon({ lat, lng }, a.polygon.map(([la, ln]) => ({ lat: la, lng: ln })))) return a.code as AirportCode;
  }
  return null;
}

export function isAirportPoint(lat: number, lng: number): boolean {
  return airportAt(lat, lng) != null;
}
