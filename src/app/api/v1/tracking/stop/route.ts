import { apiOk, apiError, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { rateLimit } from '@/lib/rate-limit';
import { passengerSetStop } from '@/server/passenger-stop';

export const dynamic = 'force-dynamic';

// Passenger adds/replaces (POST {lat,lng,label}) or removes (DELETE) the ride's stop (2026-11-15).
// Full tracking session only — a read-only share link has no tracking session.
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const rl = await rateLimit('pax-stop', bookingId, 10, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let b: { lat?: unknown; lng?: unknown; label?: unknown };
  try { b = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const lat = Number(b.lat), lng = Number(b.lng), label = typeof b.label === 'string' ? b.label.trim() : '';
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return Errors.validation({ stop: 'Invalid coordinates.' });
  if (!label) return Errors.validation({ stop: 'Address required.' });
  const r = await passengerSetStop(bookingId, { lat, lng, label });
  return r.ok ? apiOk(r) : apiError(r.status, r.code, r.message);
}

export async function DELETE() {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const r = await passengerSetStop(bookingId, null);
  return r.ok ? apiOk(r) : apiError(r.status, r.code, r.message);
}
