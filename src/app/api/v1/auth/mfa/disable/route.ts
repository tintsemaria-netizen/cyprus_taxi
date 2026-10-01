import { apiOk, apiError, Errors } from '@/lib/http';
import { getStaff } from '@/lib/auth';
import { config } from '@/lib/config';
import { rateLimit } from '@/lib/rate-limit';
import { disableMfa } from '@/server/staff-mfa';

export const dynamic = 'force-dynamic';

// Turn 2FA off: needs the password AND a current code. Refused while enforcement is on.
export async function POST(req: Request) {
  const ctx = await getStaff();
  if (!ctx) return Errors.unauthorized();
  if (config.staffMfaEnforce) return apiError(409, 'MFA_ENFORCED', 'Two-factor authentication is required for your role.');
  let body: { password?: unknown; code?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const rl = await rateLimit('mfa-disable', ctx.user.id, 5, 300);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const ok = await disableMfa(ctx.user, String(body.password ?? ''), String(body.code ?? '').replace(/\s/g, ''));
  if (!ok) return apiError(401, 'MFA_INVALID', 'Password or code is not valid.');
  return apiOk({ enabled: false });
}
