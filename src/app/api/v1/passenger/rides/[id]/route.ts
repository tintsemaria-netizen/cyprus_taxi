import { apiOk, Errors } from '@/lib/http';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';
import { passengerReceipt } from '@/server/receipt';

export const dynamic = 'force-dynamic';

// One of the passenger's OWN rides, for the ride page in «Мои поездки» (2026-11-20): route
// (coordinates for the map), when, how it ended and — for a completed ride — driver, car,
// distance, time on the way, total and rating. The receipt itself stays at …/receipt.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const { id } = await params;
  const b = await prisma.booking.findFirst({
    where: { id, passengerId: p.id },
    select: {
      id: true, reference: true, status: true, createdAt: true, scheduledAt: true, updatedAt: true,
      pickupLabel: true, pickupLat: true, pickupLng: true, dropoffLabel: true, dropoffLat: true, dropoffLng: true,
      stopLabel: true, stopLat: true, stopLng: true, vClass: true, passengerCount: true, luggageCount: true,
      quoteId: true, fare: { select: { gpsMeterKm: true } }, rating: { select: { stars: true } },
    },
  });
  if (!b) return Errors.forbidden();

  let completed: null | {
    at: string | null; startedAt: string | null; driver: { name: string; vehicle: string; plate: string } | null;
    totalCents: number | null; currency: string; paymentMethod: string; distanceKm: number | null; durationMin: number | null;
  } = null;
  if (b.status === 'COMPLETED') {
    const [r, started, quote] = await Promise.all([
      passengerReceipt(b.id, p.id),
      prisma.bookingEvent.findFirst({ where: { bookingId: b.id, type: 'TRIP_STARTED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      b.quoteId ? prisma.quote.findUnique({ where: { id: b.quoteId }, select: { distanceMeters: true } }) : null,
    ]);
    const rc = r.ok ? r.receipt : null;
    const end = rc?.completedAt ? new Date(rc.completedAt) : null;
    completed = {
      at: rc?.completedAt ?? null,
      startedAt: started?.createdAt.toISOString() ?? null,
      driver: rc?.driver ?? null,
      totalCents: rc?.fare.totalCents ?? null,
      currency: rc?.fare.currency ?? 'EUR',
      paymentMethod: rc?.fare.paymentMethod ?? 'CASH_TO_DRIVER',
      // Distance actually driven (GPS meter) when known, else the planned road distance.
      distanceKm: b.fare?.gpsMeterKm != null && b.fare.gpsMeterKm >= 0.5 ? Math.round(b.fare.gpsMeterKm * 10) / 10 : quote ? Math.round(quote.distanceMeters / 100) / 10 : null,
      durationMin: started && end ? Math.max(1, Math.round((end.getTime() - started.createdAt.getTime()) / 60_000)) : null,
    };
  }

  return apiOk({
    id: b.id, reference: b.reference, status: b.status,
    at: (b.scheduledAt ?? b.createdAt).toISOString(),
    pickup: { label: b.pickupLabel, lat: b.pickupLat, lng: b.pickupLng },
    stop: b.stopLabel && b.stopLat != null && b.stopLng != null ? { label: b.stopLabel, lat: b.stopLat, lng: b.stopLng } : null,
    dropoff: { label: b.dropoffLabel, lat: b.dropoffLat, lng: b.dropoffLng },
    vClass: b.vClass, passengerCount: b.passengerCount, luggageCount: b.luggageCount,
    completed,
    rating: b.rating ? { stars: b.rating.stars } : null,
  });
}
