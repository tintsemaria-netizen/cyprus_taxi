import { apiOk, Errors, clientIp } from '@/lib/http';
import { loginSchema, zodFieldErrors } from '@/lib/validation';
import { prisma } from '@/lib/db';
import { verifyPassword, createStaffSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { apiError } from '@/lib/http';
import { verifyStaffTotp, mfaSetupRequired } from '@/server/staff-mfa';

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
  // Second factor for accounts that enabled TOTP. No session is issued without it.
  if (user.totpEnabledAt) {
    const code = typeof (raw as { totp?: unknown }).totp === 'string' ? ((raw as { totp: string }).totp).replace(/\s/g, '') : '';
    if (!code) return apiError(401, 'MFA_REQUIRED', 'Enter the 6-digit code from your authenticator app.');
    const rlMfa = await rateLimit('login-mfa', user.id, 5, 300);
    if (!rlMfa.ok) return Errors.throttled(rlMfa.retryAfter);
    if (!(await verifyStaffTotp(user, code))) return apiError(401, 'MFA_INVALID', 'That code is not valid. Use the current code from your app.');
  }
  await createStaffSession(user);
  return apiOk({ id: user.id, role: user.role, displayName: user.displayName, mfaSetupRequired: mfaSetupRequired(user) });
}
