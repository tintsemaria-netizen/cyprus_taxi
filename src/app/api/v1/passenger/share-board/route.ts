import { apiOk, apiError, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { rateLimit } from '@/lib/rate-limit';
import { shareBoard, proposeFromBoard } from '@/server/share-board';

export const dynamic = 'force-dynamic';

// Share board (2026-11-21): my unpaired co-rider pre-bookings and other passengers' rides on the
// same corridor that fit with mine. No names, phones or exact addresses.
export async function GET() {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  return apiOk(await shareBoard(p.id));
}

// «Поехать вместе» with another passenger's ride, at THEIR time.
export async function POST(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rl = await rateLimit('share-board', p.id, 10, 3600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let body: { myBookingId?: string; otherBookingId?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  if (!body.myBookingId || !body.otherBookingId) return Errors.validation({ otherBookingId: 'Required.' });
  const r = await proposeFromBoard(p.id, body.myBookingId, body.otherBookingId);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true }, 201);
}
