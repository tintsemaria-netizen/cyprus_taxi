import { apiOk, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/server/applicant';
import { sendOtp } from '@/server/sms';

export const dynamic = 'force-dynamic';

// Approved drivers sign in with their phone via OTP.
export async function POST(req: Request) {
  let body: { phone?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const phone = normalizePhone(body.phone || '');
  if (!phone) return Errors.validation({ phone: 'Enter a valid phone number.' });
  const rl = await rateLimit('otp-phone', phone, 5, 600);
  const rlIp = await rateLimit('otp-ip', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rl.ok || !rlIp.ok) return Errors.throttled(Math.max(rl.retryAfter ?? 0, rlIp.retryAfter ?? 0));
  try { const r = await sendOtp(phone); return apiOk({ sent: true, provider: r.provider, devCode: r.devCode }); }
  catch { return apiOk({ sent: false, unavailable: true }); }
}
