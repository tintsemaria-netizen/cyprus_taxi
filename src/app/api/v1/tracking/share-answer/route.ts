import { apiOk, apiError, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { answerShare } from '@/server/share';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ groupId: z.string().uuid(), accept: z.boolean(), variant: z.number().int().min(0).max(5).optional() });

// Passenger answers a ride-share proposal (Task 022) for the ride their tracking session is for.
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  let raw: unknown;
  try { raw = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const p = schema.safeParse(raw);
  if (!p.success) return Errors.validation({ _: 'groupId and accept are required.' });
  const r = await answerShare(p.data.groupId, { kind: 'PASSENGER', bookingId }, p.data.accept, new Date(), p.data.variant);
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return apiOk({ ok: true, status: r.status });
}
