import { apiOk, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { saveSubscription, BrowserSubscription } from '@/server/push';
import { prisma } from '@/lib/db';
import { getPassenger } from '@/server/passenger';

export const dynamic = 'force-dynamic';

// Passenger registers a Web Push subscription for their tracked ride.
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  let body: { subscription?: BrowserSubscription };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (!body.subscription) return Errors.validation({ subscription: 'Required.' });
  // The ride's owner subscribes the device to their account (covers all their rides); anyone else
  // with the tracking link only to this ride.
  const p = await getPassenger();
  const own = p ? await prisma.booking.findFirst({ where: { id: bookingId, passengerId: p.id }, select: { id: true } }) : null;
  const ok = await saveSubscription(own && p ? `PASSENGER_ACCOUNT:${p.id}` : `PASSENGER:${bookingId}`, body.subscription);
  if (!ok) return Errors.validation({ subscription: 'Invalid subscription.' });
  return apiOk({ ok: true });
}
