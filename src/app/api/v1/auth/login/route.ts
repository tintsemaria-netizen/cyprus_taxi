import { apiOk, Errors, clientIp } from '@/lib/http';
import { loginSchema, zodFieldErrors } from '@/lib/validation';
import { prisma } from '@/lib/db';
import { verifyPassword, createStaffSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ip = clientIp(req, config.trustedProxyHops);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Errors.validation({ _: 'Invalid JSON body.' });
  }
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation(zodFieldErrors(parsed.error));

  // Rate limit by account and IP (SPEC §10).
  const rlAccount = await rateLimit('login-account', parsed.data.login.toLowerCase(), 5, 60);
  const rlIp = await rateLimit('login-ip', ip, 10, 60);
  if (!rlAccount.ok || !rlIp.ok) return Errors.throttled(Math.max(rlAccount.retryAfter, rlIp.retryAfter));

  const user = await prisma.staffUser.findUnique({ where: { login: parsed.data.login } });
  // Constant-ish path: always run a hash compare to avoid user enumeration timing.
  const dummy = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO0zJ5mYq3S3qJt4W1xkQ0m1cQ0m1cQ0m';
  const ok = user && user.active
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : (await verifyPassword(parsed.data.password, dummy), false);

  if (!user || !user.active || !ok) {
    return Errors.unauthorized();
  }
  await createStaffSession(user);
  return apiOk({ id: user.id, role: user.role, displayName: user.displayName });
}
