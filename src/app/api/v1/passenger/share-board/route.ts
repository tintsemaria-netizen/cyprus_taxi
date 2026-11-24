import { apiOk, apiError, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { rateLimit } from '@/lib/rate-limit';
import { shareBoard, proposeFromBoard, boardRide } from '@/server/share-board';

export const dynamic = 'force-dynamic';

// Share board (2026-11-21): my unpaired co-rider pre-bookings and other passengers' rides on the
// same corridor that fit with mine. No names, phones or exact addresses.
export async function GET(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  // ?ride=<id>: one open ride for the «Поехать с ним» booking form (2026-11-22).
  const ride = new URL(req.url).searchParams.get('ride');
  if (ride) { const r = await boardRide(ride); return r ? apiOk(r) : Errors.notFound(); }
  return apiOk(await shareBoard(p.id));
}

// «Поехать вместе» with another passenger's ride, at THEIR time.
export async function POST(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rl = await rateLimit('share-board', p.id, 10, 3600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let body: { myBookingId?: string; otherBookingId?: string; confirmOutside?: boolean; fromHours?: boolean };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  if (!body.myBookingId || !body.otherBookingId) return Errors.validation({ otherBookingId: 'Required.' });
  const r = await proposeFromBoard(p.id, body.myBookingId, body.otherBookingId, new Date(), body.confirmOutside === true, body.fromHours === true);
  if (!r.ok) return apiError(r.status, r.code, r.message, {}, r.arriveAt ? { arriveAt: r.arriveAt } : undefined);
  return apiOk({ ok: true, arriveAt: r.arriveAt }, 201);
}
