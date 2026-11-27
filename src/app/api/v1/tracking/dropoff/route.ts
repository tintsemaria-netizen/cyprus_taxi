import { onCyprusIsland } from '@/lib/cyprus-island';
import { noGoAt } from '@/server/no-go';
import { apiOk, apiError, Errors } from '@/lib/http';
import { getTrackingBookingId } from '@/lib/tracking';
import { rateLimit } from '@/lib/rate-limit';
import { confirmDropoff, previewDropoff } from '@/server/passenger-dropoff';

export const dynamic = 'force-dynamic';

// Passenger changes the drop-off during the ride (2026-11-27).
// POST {lat,lng,label}            → the new price (nothing changes yet)
// POST {lat,lng,label,quoteId}    → apply it; the driver is notified
// Full tracking session only — a read-only share link has no tracking session.
export async function POST(req: Request) {
  const bookingId = await getTrackingBookingId();
  if (!bookingId) return Errors.unauthorized();
  const rl = await rateLimit('pax-dropoff', bookingId, 20, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  let b: { lat?: unknown; lng?: unknown; label?: unknown; quoteId?: unknown };
  try { b = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const lat = Number(b.lat), lng = Number(b.lng), label = typeof b.label === 'string' ? b.label.trim() : '';
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return Errors.validation({ dropoff: 'Invalid coordinates.' });
  if (!onCyprusIsland({ lat, lng })) return apiError(422, 'OFF_ISLAND', 'The destination is not on the island of Cyprus.', { dropoff: 'Not on Cyprus.' });
  if (await noGoAt({ lat, lng })) return apiError(422, 'NO_GO_ZONE', 'The taxi does not go to this area.', { dropoff: 'No-go area.' });
  if (!label) return Errors.validation({ dropoff: 'Address required.' });
  const to = { lat, lng, label };
  if (typeof b.quoteId === 'string' && b.quoteId) {
    const r = await confirmDropoff(bookingId, to, b.quoteId);
    return r.ok ? apiOk(r) : apiError(r.status, r.code, r.message);
  }
  const p = await previewDropoff(bookingId, to);
  return p.ok ? apiOk(p) : apiError(p.status, p.code, p.message);
}
