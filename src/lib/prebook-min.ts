import { pointInPolygon, type LatLng } from '@/lib/geo';
import { isFixedPrice } from '@/lib/price-type';
import { polygonArea } from '@/lib/zone-shapes';

// Pre-booking minimum fare by area (operator, 2026-11-22): a PRE-BOOKED ride with pickup AND drop-off
// inside one of the areas drawn in admin («Минимум предзаказа») costs at least that area's price —
// Comfort and XL separately; above it the taximeter counts as usual. OUR commercial rule, not a
// regulated figure. Fixed / shared fares are never changed. Pure: the zones are passed in
// (src/server/min-fares.ts loads them).

export interface MinZone { id: string; name: string; polygon: [number, number][]; comfortCents: number; xlCents: number }
export interface MinMatch { cents: number; zone: string }

export function minFor(zones: MinZone[], t: { pickup: LatLng; dropoff: LatLng; scheduled: boolean; priceType?: string | null; vClass?: string | null }): MinMatch | null {
  if (!t.scheduled || isFixedPrice(t.priceType)) return null;
  let best: MinZone | null = null;
  let bestArea = Infinity;
  for (const z of zones) {
    if (z.polygon.length < 3) continue;
    const ring = z.polygon.map(([lat, lng]) => ({ lat, lng }));
    if (!pointInPolygon(t.pickup, ring) || !pointInPolygon(t.dropoff, ring)) continue;
    const a = polygonArea(z.polygon); // several areas → the smallest (most exact) wins
    if (a < bestArea) { best = z; bestArea = a; }
  }
  if (!best) return null;
  const cents = t.vClass === 'XL' ? best.xlCents : best.comfortCents;
  return cents > 0 ? { cents, zone: best.name } : null;
}

/** Same rule for a stored booking row. */
export function bookingMin(zones: MinZone[], b: { pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number; scheduledAt: Date | string | null; priceType: string | null; vClass: string }): MinMatch | null {
  return minFor(zones, { pickup: { lat: b.pickupLat, lng: b.pickupLng }, dropoff: { lat: b.dropoffLat, lng: b.dropoffLng }, scheduled: !!b.scheduledAt, priceType: b.priceType, vClass: b.vClass });
}
