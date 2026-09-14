import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone, verifiedApplicant, createApplicantSession } from '@/server/applicant';
import { getOrCreateApplication } from '@/server/applications';
import { checkOtp } from '@/server/sms';

export const dynamic = 'force-dynamic';

// Verify the OTP → sign in the applicant and ensure their draft application exists.
export async function POST(req: Request) {
  let body: { phone?: string; code?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const phone = normalizePhone(body.phone || '');
  if (!phone || !body.code) return Errors.validation({ _: 'Phone and code are required.' });
  const rl = await rateLimit('otp-verify', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const ok = await checkOtp(phone, body.code);
  if (!ok) return apiError(401, 'BAD_CODE', 'Incorrect or expired code.');
  const applicant = await verifiedApplicant(phone);
  await createApplicantSession(applicant.id);
  await getOrCreateApplication(applicant.id);
  return apiOk({ ok: true });
}
