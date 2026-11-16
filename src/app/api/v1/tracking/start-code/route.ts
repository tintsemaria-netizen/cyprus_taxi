import { apiOk, apiError, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { rateLimit } from '@/lib/rate-limit';
import { passengerSetStartCode } from '@/server/passenger-start-code';

export const dynamic = 'force-dynamic';

// Passenger switches the optional trip-start code on/off (POST {enabled}) — 2026-11-16.
// Full tracking session only (a share link has none).
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const rl = await rateLimit('pax-start-code', bookingId, 10, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let b: { enabled?: unknown };
  try { b = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  if (typeof b.enabled !== 'boolean') return Errors.validation({ enabled: 'Required (true/false).' });
  const r = await passengerSetStartCode(bookingId, b.enabled);
  return r.ok ? apiOk(r) : apiError(r.status, r.code, r.message);
}
