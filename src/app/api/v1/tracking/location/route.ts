import { apiOk, apiError, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { rateLimit } from '@/lib/rate-limit';
import { savePassengerLocation, clearPassengerLocation } from '@/server/passenger-location';

export const dynamic = 'force-dynamic';

// The passenger (full tracking session only — never a read-only share link) shares their live
// position with the driver until pickup, or stops sharing (DELETE). Opt-in per ride.
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const rl = await rateLimit('pax-loc', bookingId, 30, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let b: { lat?: unknown; lng?: unknown; accuracyM?: unknown };
  try { b = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.accuracyM ?? 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return Errors.validation({ lat: 'Invalid coordinates.' });
  const r = await savePassengerLocation(bookingId, { lat, lng, accuracyM: Number.isFinite(acc) && acc >= 0 ? Math.min(acc, 100_000) : 0 });
  if (r === 'not_active') return apiError(409, 'NOT_ACTIVE', 'Location sharing is only possible until pickup.');
  return apiOk({ ok: true });
}

export async function DELETE() {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  await clearPassengerLocation(bookingId);
  return apiOk({ ok: true });
}
