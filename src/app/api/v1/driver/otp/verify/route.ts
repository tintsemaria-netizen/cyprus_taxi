import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/server/applicant';
import { checkOtp } from '@/server/sms';
import { createStaffSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Verify OTP and, if an operational DRIVER account exists for this phone, start a driver session.
export async function POST(req: Request) {
  let body: { phone?: string; code?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const phone = normalizePhone(body.phone || '');
  if (!phone || !body.code) return Errors.validation({ _: 'Phone and code required.' });
  const rl = await rateLimit('otp-verify', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  if (!(await checkOtp(phone, body.code))) return apiError(401, 'BAD_CODE', 'Incorrect or expired code.');
  const user = await prisma.staffUser.findUnique({ where: { login: phone } });
  const driver = user ? await prisma.driver.findUnique({ where: { userId: user.id } }) : null;
  if (!user || user.role !== 'DRIVER' || !user.active || !driver) {
    return apiError(403, 'NOT_A_DRIVER', 'No approved driver account for this number. If you applied, check your application status.');
  }
  await createStaffSession(user);
  return apiOk({ ok: true });
}
