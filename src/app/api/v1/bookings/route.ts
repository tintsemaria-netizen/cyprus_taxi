import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { createBookingSchema, zodFieldErrors } from '@/lib/validation';
import { createBooking } from '@/server/bookings';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

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

  const result = await createBooking(parsed.data, idempotencyKey);
  if (!result.ok) return apiError(result.status, result.code, result.message, result.fieldErrors);
  return apiOk(result.body, 201);
}
