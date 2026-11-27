import { cookies } from 'next/headers';
import { apiOk, apiError, Errors } from '@/lib/http';
import { rateLimit, refundRateLimit } from '@/lib/rate-limit';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { emailConfigured, sendEmail } from '@/server/email/provider';
import { asLocale, tr } from '@/i18n/translate';
import { normalizeEmail, newEmailCode, checkEmailCode, changeDriverEmail } from '@/server/driver/profile';

export const dynamic = 'force-dynamic';

// Change the driver's e-mail (2026-11-27, operator): step 1 { email } mails a 6-digit code (in his language);
// step 2 { email, code } saves it. Without a mail provider: «unavailable» (the code is shown only in tests/dev).
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: { email?: string; code?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const email = normalizeEmail(body.email || '');
  if (!email) return Errors.validation({ email: 'EMAIL' });
  if (!body.code) {
    const rl = await rateLimit('drv-email-change', ctx.driver.id, 5, 3600);
    if (!rl.ok) return Errors.throttled(rl.retryAfter);
    const dev = process.env.NODE_ENV !== 'production';
    if (!emailConfigured() && !dev) return apiOk({ sent: false, unavailable: true });
    const code = await newEmailCode(email);
    if (!emailConfigured()) return apiOk({ sent: true, devCode: code });
    const L = asLocale((await cookies()).get('lang')?.value);
    const subject = tr(L, 'driver.me.emailCodeSubject');
    const text = tr(L, 'driver.me.emailCodeBody', { code });
    const r = await sendEmail({ to: email, subject, text, html: `<p style="font-family:system-ui,sans-serif;font-size:16px">${text.replace(code, `<b style="font-size:22px;letter-spacing:3px">${code}</b>`)}</p>` });
    return apiOk(r.ok ? { sent: true } : { sent: false, unavailable: true });
  }
  const rlv = await rateLimit('drv-email-verify', ctx.driver.id, 10, 600);
  if (!rlv.ok) return Errors.throttled(rlv.retryAfter);
  if (!(await checkEmailCode(email, String(body.code)))) return apiError(401, 'BAD_CODE', 'Incorrect or expired code.');
  await refundRateLimit('drv-email-verify', ctx.driver.id);
  if (!(await changeDriverEmail(ctx.driver.id, email))) return apiError(409, 'NO_APPLICATION', 'No driver record to store the e-mail.');
  return apiOk({ ok: true, email });
}
