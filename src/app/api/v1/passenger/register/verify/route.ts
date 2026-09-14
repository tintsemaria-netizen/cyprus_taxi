import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { hashPassword } from '@/lib/auth';
import { normalizePhone } from '@/server/applicant';
import { checkOtp } from '@/server/sms';
import { upsertPassengerCredentials, createPassengerSession } from '@/server/passenger';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Passenger sign-up step 2 (Task 018): verify the phone SMS code, then create/attach the email +
// password account (phone is now verified) and start a session. No KYC.
export async function POST(req: Request) {
  let body: { email?: string; password?: string; name?: string; phone?: string; code?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const name = (body.name || '').trim();
  const phone = normalizePhone(body.phone || '');
  if (!EMAIL_RE.test(email) || password.length < 8 || !name || !phone || !body.code) return Errors.validation({ _: 'Complete every field.' });

  const rl = await rateLimit('reg-verify', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);

  if (!(await checkOtp(phone, body.code))) return apiError(401, 'BAD_CODE', 'Incorrect or expired code.');

  try {
    const p = await upsertPassengerCredentials(phone, { email, passwordHash: await hashPassword(password), name });
    await createPassengerSession(p.id);
    return apiOk({ ok: true, email: p.email, name: p.name });
  } catch (e) {
    if ((e as Error).message === 'email-taken') return apiError(409, 'EMAIL_TAKEN', 'That email is already registered.');
    throw e;
  }
}
