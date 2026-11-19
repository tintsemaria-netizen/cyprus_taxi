import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { systemStatus } from '@/server/readiness';

export const dynamic = 'force-dynamic';

// Launch fixes §3: dependency status for admins (SMS, malware scan, e-mail, push, maps, switches).
// Names and states only — never secret values.
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await systemStatus({ probeScanner: true }));
}
