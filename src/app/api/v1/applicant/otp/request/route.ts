import { apiOk, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/server/applicant';
import { sendOtp } from '@/server/sms';

export const dynamic = 'force-dynamic';

// Request an SMS OTP to begin/resume driver onboarding. Rate-limited per phone + IP.
export async function POST(req: Request) {
  let body: { phone?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const phone = normalizePhone(body.phone || '');
  if (!phone) return Errors.validation({ phone: 'Enter a valid international phone number (e.g. +35799123456).' });
  const rlP = await rateLimit('otp-phone', phone, 5, 600);
  const rlIp = await rateLimit('otp-ip', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rlP.ok || !rlIp.ok) return Errors.throttled(Math.max(rlP.retryAfter ?? 0, rlIp.retryAfter ?? 0));
  try {
    const r = await sendOtp(phone);
    return apiOk({ sent: true, provider: r.provider, devCode: r.devCode }); // devCode only present in demo mode
  } catch {
    return apiOk({ sent: false, unavailable: true });
  }
}
