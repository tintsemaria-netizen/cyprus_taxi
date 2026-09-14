import { apiOk, apiError, Errors, clientIp } from '@/lib/http';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { verifyPassword } from '@/lib/auth';
import { passengerByEmail, createPassengerSession } from '@/server/passenger';

export const dynamic = 'force-dynamic';

// Passenger email + password sign-in (Task 018). Generic 401 on any failure (no account
// enumeration). Rate-limited by email and IP.
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) return Errors.validation({ _: 'Email and password are required.' });

  const rlE = await rateLimit('plogin-email', email, 8, 600);
  const rlIp = await rateLimit('plogin-ip', clientIp(req, config.trustedProxyHops), 30, 600);
  if (!rlE.ok || !rlIp.ok) return Errors.throttled(Math.max(rlE.retryAfter ?? 0, rlIp.retryAfter ?? 0));

  const p = await passengerByEmail(email);
  if (!p || !p.passwordHash || !(await verifyPassword(password, p.passwordHash))) {
    return apiError(401, 'BAD_CREDENTIALS', 'Incorrect email or password.');
  }
  await createPassengerSession(p.id);
  return apiOk({ ok: true, email: p.email, name: p.name });
}
