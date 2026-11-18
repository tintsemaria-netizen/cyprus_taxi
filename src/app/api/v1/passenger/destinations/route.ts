import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
export const dynamic = 'force-dynamic';

// The passenger's own frequent places (2026-11-18): pickups and destinations of the last 100 rides
// (cancelled ones skipped), the most often used first, then the most recent. Points under ~120 m
// apart count as one place. Used for quick picks and as the top of every address search.
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rows = await prisma.booking.findMany({
    where: { passengerId: p.id, status: { not: 'CANCELED' } }, orderBy: { createdAt: 'desc' }, take: 100,
    select: { dropoffLabel: true, dropoffLat: true, dropoffLng: true, pickupLabel: true, pickupLat: true, pickupLng: true },
  });
  type Spot = { label: string; lat: number; lng: number; n: number; order: number };
  const spots: Spot[] = [];
  const near = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.abs(a.lat - b.lat) < 0.0011 && Math.abs(a.lng - b.lng) < 0.0013;
  let order = 0;
  const add = (label: string, lat: number, lng: number, weight: number) => {
    if (!label || /^(pin|point|точка)\s*-?\d/i.test(label.trim())) return; // bare map points are not «places»
    const s = spots.find((x) => x.label === label || near(x, { lat, lng }));
    if (s) s.n += weight; else spots.push({ label, lat, lng, n: weight, order: order++ });
  };
  // Destinations weigh a bit more than pickups (this list mostly answers «куда»).
  for (const r of rows) { add(r.dropoffLabel, r.dropoffLat, r.dropoffLng, 1); add(r.pickupLabel, r.pickupLat, r.pickupLng, 0.6); }
  spots.sort((a, b) => b.n - a.n || a.order - b.order);
  return apiOk({ destinations: spots.slice(0, 8).map(({ label, lat, lng }) => ({ label, lat, lng })) });
}
