import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit, refundRateLimit } from '@/lib/rate-limit';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { normalizePhone } from '@/server/applicant';
import { sendOtp, checkOtp } from '@/server/sms';
import { phoneTaken, changeDriverPhone } from '@/server/driver/profile';

export const dynamic = 'force-dynamic';

// Change the driver's phone (2026-11-27, operator): step 1 { phone } sends an SMS code to the NEW number;
// step 2 { phone, code } changes it. The phone is also his sign-in, so it must not belong to anyone else.
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: { phone?: string; code?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const phone = normalizePhone(body.phone || '');
  if (!phone) return Errors.validation({ phone: 'PHONE' });
  if (phone === ctx.driver.phone) return Errors.validation({ phone: 'SAME' });
  if (await phoneTaken(ctx.driver.id, phone)) return apiError(409, 'PHONE_TAKEN', 'This number belongs to another account.');
  if (!body.code) {
    const rl = await rateLimit('drv-phone-change', ctx.driver.id, 5, 3600);
    const rlIp = await rateLimit('otp-ip', clientIp(req, config.trustedProxyHops), 20, 600);
    if (!rl.ok || !rlIp.ok) return Errors.throttled(Math.max(rl.retryAfter ?? 0, rlIp.retryAfter ?? 0));
    try { const r = await sendOtp(phone); return apiOk({ sent: true, devCode: r.devCode }); }
    catch { return apiOk({ sent: false, unavailable: true }); }
  }
  const rlv = await rateLimit('drv-phone-verify', ctx.driver.id, 10, 600);
  if (!rlv.ok) return Errors.throttled(rlv.retryAfter);
  if (!(await checkOtp(phone, String(body.code)))) return apiError(401, 'BAD_CODE', 'Incorrect or expired code.');
  await refundRateLimit('drv-phone-verify', ctx.driver.id);
  await changeDriverPhone(ctx.driver.id, phone);
  return apiOk({ ok: true, phone });
}
