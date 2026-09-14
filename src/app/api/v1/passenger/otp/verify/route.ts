import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/server/applicant';
import { checkOtp } from '@/server/sms';
import { verifiedPassenger, createPassengerSession } from '@/server/passenger';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  let body: { phone?: string; code?: string; name?: string }; try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  const phone = normalizePhone(body.phone || '');
  if (!phone || !body.code) return Errors.validation({ _: 'Phone and code required.' });
  const rl = await rateLimit('otp-verify', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  if (!(await checkOtp(phone, body.code))) return apiError(401, 'BAD_CODE', 'Incorrect or expired code.');
  const p = await verifiedPassenger(phone);
  await createPassengerSession(p.id);
  return apiOk({ ok: true, phone: p.phone, name: p.name });
}
