import { apiOk, apiError, Errors } from '@/lib/http';
import { getStaff, createStaffSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { confirmEnrollment, isPrivileged } from '@/server/staff-mfa';

export const dynamic = 'force-dynamic';

// Confirm enrollment with a current code. Other sessions are logged out (sessionVersion bump);
// this browser gets a fresh session so the user stays signed in.
export async function POST(req: Request) {
  const ctx = await getStaff();
  if (!ctx) return Errors.unauthorized();
  if (!isPrivileged(ctx.user)) return Errors.forbidden();
  let body: { code?: unknown };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';
  if (!/^\d{6}$/.test(code)) return Errors.validation({ code: 'Enter the 6-digit code.' });
  const rl = await rateLimit('mfa-enable', ctx.user.id, 10, 300);
  if (!rl.ok) return Errors.throttled(rl.retryAfter);
  const updated = await confirmEnrollment(ctx.user, code);
  if (!updated) return apiError(422, 'MFA_INVALID', 'That code is not valid. Check the time on your phone and try the current code.');
  await createStaffSession(updated);
  return apiOk({ enabled: true });
}
