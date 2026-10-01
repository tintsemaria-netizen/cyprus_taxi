import { haversineMeters } from '@/lib/geo';

// Cyprus airports. Trips to/from them have official fixed fares set by the Road Transport
// Department, so a meter estimate can differ from what the driver legitimately charges, and a
// driver meets the passenger at the terminal rather than at an exact GPS point.
export const AIRPORTS = [
  { code: 'LCA', lat: 34.8751, lng: 33.6249 }, // Larnaca
  { code: 'PFO', lat: 34.718, lng: 32.4857 }, // Paphos
] as const;

export const AIRPORT_RADIUS_M = 2500;

export function isAirportPoint(lat: number, lng: number): boolean {
  return AIRPORTS.some((a) => haversineMeters({ lat, lng }, a) <= AIRPORT_RADIUS_M);
}
