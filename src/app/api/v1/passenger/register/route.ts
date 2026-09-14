import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/server/applicant';
import { passengerByEmail } from '@/server/passenger';
import { sendOtp } from '@/server/sms';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bolt-style passenger sign-up step 1 (Task 018): validate email/password/name/phone and send the
// phone SMS OTP. No KYC. The account is created only after the code is verified (see verify route).
export async function POST(req: Request) {
  let body: { email?: string; password?: string; name?: string; phone?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const name = (body.name || '').trim();
  const phone = normalizePhone(body.phone || '');
  const fieldErrors: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) fieldErrors.email = 'Enter a valid email.';
  if (password.length < 8) fieldErrors.password = 'At least 8 characters.';
  if (!name) fieldErrors.name = 'Enter your name.';
  if (!phone) fieldErrors.phone = 'Enter a valid phone number.';
  if (Object.keys(fieldErrors).length) return Errors.validation(fieldErrors);

  // Reject an email already used by a different account before sending an OTP.
  const byEmail = await passengerByEmail(email);
  if (byEmail && byEmail.phone !== phone) return apiError(409, 'EMAIL_TAKEN', 'That email is already registered.');

  const rlP = await rateLimit('reg-phone', phone!, 5, 600);
  const rlIp = await rateLimit('reg-ip', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rlP.ok || !rlIp.ok) return Errors.throttled(Math.max(rlP.retryAfter ?? 0, rlIp.retryAfter ?? 0));

  try {
    const r = await sendOtp(phone!);
    return apiOk({ sent: true, provider: r.provider, devCode: r.devCode });
  } catch {
    return apiError(503, 'SMS_UNAVAILABLE', 'Phone verification is unavailable right now.');
  }
}
