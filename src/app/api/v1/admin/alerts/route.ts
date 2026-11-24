import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { staffAlerts } from '@/server/staff-alerts';
import { areaOf } from '@/server/staff-log';

export const dynamic = 'force-dynamic';

// The red menu (2026-11-23): waiting driver applications for every admin; the owner also gets unchecked
// «Не ваши изменения» and the newest one for the silent pop-up. Polled by StaffShell every 10 s.
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const a = await staffAlerts(ctx.user);
  return apiOk({
    applications: a.applications,
    changes: a.changes,
    docs: a.docs,
    last: a.last ? { id: a.last.id, actor: a.last.actorName, method: a.last.method, area: areaOf(a.last.path) } : null,
  });
}
