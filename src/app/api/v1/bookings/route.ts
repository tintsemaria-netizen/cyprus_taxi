import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { createBookingSchema, zodFieldErrors } from '@/lib/validation';
import { createBooking } from '@/server/bookings';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Build the tracking link from the domain the passenger is actually using (multi-domain
// support), but only for a known host — never from a spoofed Host header.
function requestBaseUrl(req: Request): string | undefined {
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim().toLowerCase();
  if (!host || !config.appAllowedHosts().has(host)) return undefined;
  const proto = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('booking-create', ip, 5, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  const idempotencyKey = req.headers.get('idempotency-key');
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return Errors.validation({ _: 'Idempotency-Key header required (8-200 chars).' });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation(zodFieldErrors(parsed.error));

  const result = await createBooking(parsed.data, idempotencyKey, requestBaseUrl(req));
  if (!result.ok) return apiError(result.status, result.code, result.message, result.fieldErrors, result.extra);
  return apiOk(result.body, 201);
}
