import { PASSENGER_GUEST } from '@/lib/features';
import { createPassengerSession } from '@/server/passenger';
import { apiOk, apiError, Errors, clientIp, requestBaseUrl } from '@/lib/http';
import { createBookingSchema, createGuestBookingSchema, zodFieldErrors, type CreateBookingInput } from '@/lib/validation';
import { createBooking } from '@/server/bookings';
import { getPassenger } from '@/server/passenger';
import { getRequestLocale } from '@/i18n/server';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';


export async function POST(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  const rl = await rateLimit('booking-create', ip, 5, 60);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  // Task 014: booking requires a signed-in passenger (login/registration after route
  // selection). The verified account phone is authoritative for the booking.
  let passenger = await getPassenger();
  if (!passenger && !PASSENGER_GUEST) return apiError(401, 'LOGIN_REQUIRED', 'Please sign in to request a ride.');

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
  // Guest ordering (PASSENGER_GUEST): name and phone are optional.
  if (PASSENGER_GUEST && raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (!r.phone || (typeof r.phone === 'string' && !r.phone.trim())) delete r.phone;
    if (!r.passengerName || (typeof r.passengerName === 'string' && !r.passengerName.trim())) r.passengerName = 'Guest';
  }
  const parsed = (PASSENGER_GUEST ? createGuestBookingSchema : createBookingSchema).safeParse(raw);
  if (!parsed.success) return Errors.validation(zodFieldErrors(parsed.error));

  // A verified account phone overrides any client-supplied phone. Email-only accounts (no phone)
  // give the contact number per booking; it is validated by the schema. Link to the account.
  if (!passenger) {
    // First order from this device: a guest account + session (guest ordering, 2026-11-19).
    passenger = await prisma.passenger.create({ data: {} });
    await createPassengerSession(passenger.id);
  }
  // '' = no contact phone (guest ordering); createBooking stores it as given.
  const phone = (passenger.phone ?? parsed.data.phone ?? '') as CreateBookingInput['phone'];
  const result = await createBooking({ ...parsed.data, phone }, idempotencyKey, requestBaseUrl(req), passenger.id);
  if (!result.ok) return apiError(result.status, result.code, result.message, result.fieldErrors, result.extra);
  // Remember the passenger's UI language for the e-mailed receipt (best effort).
  try {
    const locale = await getRequestLocale();
    if (passenger.locale !== locale) await prisma.passenger.update({ where: { id: passenger.id }, data: { locale } });
  } catch { /* never fail a booking over this */ }
  return apiOk(result.body, 201);
}
