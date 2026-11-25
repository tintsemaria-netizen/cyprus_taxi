import { apiOk, apiError, Errors } from '@/lib/http';
import { getPassenger } from '@/server/passenger';
import { rateLimit } from '@/lib/rate-limit';
import { proposeFromBoard } from '@/server/share-board';

export const dynamic = 'force-dynamic';

// «Ехать» with an order picked in the hour list (2026-11-25), at THEIR time. The board page is gone.
export async function POST(req: Request) {
  const p = await getPassenger();
  if (!p) return Errors.unauthorized();
  const rl = await rateLimit('share-board', p.id, 10, 3600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let body: { myBookingId?: string; otherBookingId?: string; confirmOutside?: boolean };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  if (!body.myBookingId || !body.otherBookingId) return Errors.validation({ otherBookingId: 'Required.' });
  const r = await proposeFromBoard(p.id, body.myBookingId, body.otherBookingId, new Date(), body.confirmOutside === true);
  if (!r.ok) return apiError(r.status, r.code, r.message, {}, r.arriveAt ? { arriveAt: r.arriveAt } : undefined);
  return apiOk({ ok: true, arriveAt: r.arriveAt }, 201);
}
