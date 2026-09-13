import { apiOk, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { saveSubscription, BrowserSubscription } from '@/server/push';

export const dynamic = 'force-dynamic';

// Passenger registers a Web Push subscription for their tracked ride.
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  let body: { subscription?: BrowserSubscription };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (!body.subscription) return Errors.validation({ subscription: 'Required.' });
  const ok = await saveSubscription(`PASSENGER:${bookingId}`, body.subscription);
  if (!ok) return Errors.validation({ subscription: 'Invalid subscription.' });
  return apiOk({ ok: true });
}
