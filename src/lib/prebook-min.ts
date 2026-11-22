import type { LatLng } from '@/lib/geo';
import { shareZone } from '@/lib/share';
import { isFixedPrice } from '@/lib/price-type';

// Pre-booking minimum fare (operator, 2026-11-22): a PRE-BOOKED ride inside the town of Nicosia
// costs at least €20; above €20 the taximeter counts as usual. OUR commercial rule, not a
// regulated figure. «Inside Nicosia» = pickup AND drop-off in the Nicosia town area (the same
// centre + radius as the ride-share places, src/lib/share.ts). Fixed fares are never changed.
// Env PREBOOK_MIN_NICOSIA_CENTS overrides the amount; 0 switches the rule off.
export const PREBOOK_MIN_NICOSIA_CENTS = (() => {
  const v = Number(process.env.PREBOOK_MIN_NICOSIA_CENTS);
  return Number.isFinite(v) && v >= 0 && process.env.PREBOOK_MIN_NICOSIA_CENTS !== undefined && process.env.PREBOOK_MIN_NICOSIA_CENTS !== '' ? Math.round(v) : 2000;
})();

/** The minimum for this trip in cents, or null when no minimum applies. */
export function prebookMinCents(t: { pickup: LatLng; dropoff: LatLng; scheduled: boolean; priceType?: string | null }): number | null {
  if (!t.scheduled || PREBOOK_MIN_NICOSIA_CENTS <= 0 || isFixedPrice(t.priceType)) return null;
  return shareZone(t.pickup) === 'NICOSIA' && shareZone(t.dropoff) === 'NICOSIA' ? PREBOOK_MIN_NICOSIA_CENTS : null;
}

/** Same rule for a stored booking row. */
export function bookingMinCents(b: { pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number; scheduledAt: Date | string | null; priceType: string | null }): number | null {
  return prebookMinCents({ pickup: { lat: b.pickupLat, lng: b.pickupLng }, dropoff: { lat: b.dropoffLat, lng: b.dropoffLng }, scheduled: !!b.scheduledAt, priceType: b.priceType });
}
