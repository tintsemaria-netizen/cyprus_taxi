import { apiOk, Errors } from '@/lib/http';
import { getStaff } from '@/lib/auth';
import { beginEnrollment, isPrivileged } from '@/server/staff-mfa';

export const dynamic = 'force-dynamic';

// Start TOTP enrollment for the signed-in ADMIN/DISPATCHER: returns a fresh secret, the
// otpauth:// URI and a QR (SVG, rendered server-side so the secret never leaves this origin).
export async function POST() {
  const ctx = await getStaff();
  if (!ctx) return Errors.unauthorized();
  if (!isPrivileged(ctx.user)) return Errors.forbidden();
  if (ctx.user.totpEnabledAt) return Errors.conflict('Two-factor authentication is already enabled.');
  return apiOk(await beginEnrollment(ctx.user));
}
