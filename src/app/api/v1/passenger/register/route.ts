import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { hashPassword } from '@/lib/auth';
import { normalizePhone } from '@/server/applicant';
import { passengerByEmail, createEmailPassenger, createPassengerSession } from '@/server/passenger';
import { sendOtp } from '@/server/sms';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Passenger sign-up step 1 (Task 018). Name, email and password are required; phone is OPTIONAL.
// - No phone: the account is created right away (email + password) and signed in.
// - Phone given: an SMS code is sent and the account is created after verification (verify route).
//   If SMS is unavailable, the account is still created — without the phone, which is never stored
//   unverified — and the client is told so (`phoneSkipped`). The contact number for a ride is then
//   entered when booking.
export async function POST(req: Request) {
  let body: { email?: string; password?: string; name?: string; phone?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const name = (body.name || '').trim();
  const rawPhone = (body.phone || '').trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const fieldErrors: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) fieldErrors.email = 'Enter a valid email.';
  if (password.length < 8) fieldErrors.password = 'At least 8 characters.';
  if (!name) fieldErrors.name = 'Enter your name.';
  if (rawPhone && !phone) fieldErrors.phone = 'Enter a valid phone number, or leave it empty.';
  if (Object.keys(fieldErrors).length) return Errors.validation(fieldErrors);

  const rlIp = await rateLimit('reg-ip', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rlIp.ok) return Errors.throttled(rlIp.retryAfter);

  // An email already in use is only OK when it belongs to this same (phone-verified) account.
  const byEmail = await passengerByEmail(email);
  if (byEmail && (!phone || byEmail.phone !== phone)) return apiError(409, 'EMAIL_TAKEN', 'That email is already registered.');

  if (phone) {
    const rlP = await rateLimit('reg-phone', phone, 5, 600);
    if (!rlP.ok) return Errors.throttled(rlP.retryAfter);
    try {
      const r = await sendOtp(phone);
      return apiOk({ sent: true, provider: r.provider, devCode: r.devCode });
    } catch {
      // SMS unavailable. Attaching credentials to an existing account needs the code, so that
      // case still fails; a brand-new account is created without the phone instead.
      if (byEmail) return apiError(503, 'SMS_UNAVAILABLE', 'Phone verification is unavailable right now.');
    }
  }

  try {
    const p = await createEmailPassenger({ email, passwordHash: await hashPassword(password), name });
    await createPassengerSession(p.id);
    return apiOk({ sent: false, created: true, phoneSkipped: !!phone });
  } catch (e) {
    if ((e as Error).message === 'email-taken') return apiError(409, 'EMAIL_TAKEN', 'That email is already registered.');
    throw e;
  }
}
