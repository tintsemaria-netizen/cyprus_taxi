import { prisma } from '@/lib/db';
import { createQuote, consumeQuote, type QuoteInput } from '@/server/quote';
import { enqueueDriver } from '@/server/push';
import { lookupPostcode } from '@/server/postcode';

// The passenger changes the drop-off during the ride (operator 2026-11-27): from the moment a driver
// is assigned until the trip ends. Two steps: PREVIEW re-quotes the whole route (pickup → stop → new
// drop-off) and shows the new price — nothing changes yet; CONFIRM with that quote applies it. A fixed
// airport price is re-quoted too (still in the fixed zone → the new fixed price; outside → the meter
// estimate). Never with a co-rider (it would break the other passenger's route and price), the same
// rule as the stop. The driver is notified (push + a banner on the trip screen); he does not have to confirm.
export const DROPOFF_OPEN = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

export type DropoffPoint = { lat: number; lng: number; label: string };
type Fail = { ok: false; status: number; code: string; message: string };
export type DropoffPreview = { ok: true; quoteId: string; fareCents: number; priceType: string; oldFareCents: number | null; oldPriceType: string | null; fareMinCents: number | null } | Fail;
export type DropoffResult = { ok: true; fareCents: number | null; priceType: string | null } | Fail;

type B = NonNullable<Awaited<ReturnType<typeof prisma.booking.findUnique>>>;

function guard(b: B | null): Fail | null {
  if (!b) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found.' };
  if (!DROPOFF_OPEN.includes(b.status)) return { ok: false, status: 409, code: 'BAD_STATE', message: 'The destination can be changed only while a driver is assigned and the ride is not over.' };
  if (b.shareOptIn) return { ok: false, status: 409, code: 'SHARE_NO_DROPOFF_CHANGE', message: 'A ride with a co-rider cannot change its destination — tell the driver.' };
  return null;
}

function quoteInput(b: B, to: DropoffPoint): QuoteInput {
  return {
    pickup: { lat: b.pickupLat, lng: b.pickupLng }, dropoff: { lat: to.lat, lng: to.lng },
    stop: b.stopLat != null && b.stopLng != null ? { lat: b.stopLat, lng: b.stopLng } : null,
    vClass: b.vClass as 'COMFORT' | 'XL', passengerCount: b.passengerCount, luggageCount: b.luggageCount ?? 0,
    scheduledAtUtc: null, // priced for now: the ride is under way
  };
}

export async function previewDropoff(bookingId: string, to: DropoffPoint): Promise<DropoffPreview> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  const bad = guard(b); if (bad) return bad;
  const q = await createQuote(quoteInput(b!, to));
  if (!q.ok) return { ok: false, status: q.status, code: q.code, message: q.message };
  return {
    ok: true, quoteId: q.quote.quoteId, priceType: q.quote.priceType,
    // A pre-booking keeps its minimum (as with a stop added mid-trip, 2026-11-22).
    fareCents: Math.max(b!.fareMinCents ?? 0, q.quote.totalCents),
    oldFareCents: b!.fareCents ?? null, oldPriceType: b!.priceType ?? null, fareMinCents: b!.fareMinCents ?? null,
  };
}

export async function confirmDropoff(bookingId: string, to: DropoffPoint, quoteId: string): Promise<DropoffResult> {
  const b0 = await prisma.booking.findUnique({ where: { id: bookingId } });
  const bad0 = guard(b0); if (bad0) return bad0;
  const c = await consumeQuote(quoteId, quoteInput(b0!, to));
  if (!c.ok) return { ok: false, status: 409, code: c.code, message: c.code === 'QUOTE_EXPIRED' ? 'The price has expired — check it again.' : 'The price does not match this address — check it again.' };
  const postcode = await lookupPostcode(to.lat, to.lng, to.label).catch(() => null);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const cur = await tx.booking.findUnique({ where: { id: bookingId } });
    const bad = guard(cur); if (bad) return bad;
    // The stop may have been added/removed between preview and confirm: the quote would no longer match.
    if ((cur!.stopLat ?? null) !== (b0!.stopLat ?? null) || (cur!.stopLng ?? null) !== (b0!.stopLng ?? null)) {
      return { ok: false as const, status: 409, code: 'QUOTE_MISMATCH', message: 'The route changed — check the price again.' };
    }
    const fareCents = Math.max(cur!.fareMinCents ?? 0, c.totalCents);
    const u = await tx.booking.update({
      where: { id: bookingId },
      data: {
        dropoffLat: to.lat, dropoffLng: to.lng, dropoffLabel: to.label.slice(0, 300), dropoffPostcode: postcode,
        quoteId, fareCents, priceType: c.priceType, fareBreakdown: c.breakdown,
        revision: { increment: 1 },
      },
    });
    await tx.bookingEvent.create({ data: { bookingId, type: 'DROPOFF_CHANGED', actorType: 'PASSENGER', actorId: 'tracking', beforeStatus: cur!.status, afterStatus: cur!.status } });
    const a = await tx.assignment.findFirst({ where: { activeBookingId: bookingId } });
    if (a?.activeDriverId) {
      // No street names in the push (operator 2026-11-22); the trip screen shows the new address.
      await enqueueDriver(tx, a.activeDriverId, 'The passenger changed the destination', 'A new route has been built.',
        { tag: `dropoff-${bookingId}`, dedupeKey: `dropoff-${bookingId}-${u.revision}`, msg: { k: 'drv.dropoffChanged' } });
    }
    return { ok: true as const, fareCents: u.fareCents ?? null, priceType: u.priceType ?? null };
  });
}
