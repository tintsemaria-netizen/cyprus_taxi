import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/server/applicant';
import { checkOtp } from '@/server/sms';
import { verifiedPassenger, createPassengerSession, getPassenger } from '@/server/passenger';
import { prisma } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  let body: { phone?: string; code?: string; name?: string; attach?: boolean }; try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  const phone = normalizePhone(body.phone || '');
  if (!phone || !body.code) return Errors.validation({ _: 'Phone and code required.' });
  const rl = await rateLimit('otp-verify', clientIp(req, config.trustedProxyHops), 20, 600);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  if (!(await checkOtp(phone, body.code))) return apiError(401, 'BAD_CODE', 'Incorrect or expired code.');
  // Attach (launch fixes, 2026-11-19): a signed-in account without a verified phone (e-mail sign-up,
  // test-mode guest) gets THIS number — its history and active ride stay with it. A number that
  // already belongs to another account is never merged: the passenger signs in with it instead.
  if (body.attach) {
    const me = await getPassenger();
    if (me && !(me.phone && me.phoneVerifiedAt)) {
      const owner = await prisma.passenger.findUnique({ where: { phone } });
      if (owner && owner.id !== me.id) return apiError(409, 'PHONE_IN_USE', 'This number belongs to another account. Sign in with it instead.');
      const p = await prisma.passenger.update({ where: { id: me.id }, data: { phone, phoneVerifiedAt: new Date() } });
      await createPassengerSession(p.id); // fresh session after the identity change
      return apiOk({ ok: true, phone: p.phone, name: p.name, attached: true });
    }
  }
  const p = await verifiedPassenger(phone);
  await createPassengerSession(p.id);
  return apiOk({ ok: true, phone: p.phone, name: p.name });
}
