import { apiOk, Errors } from '@/lib/http';
import { getStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isPrivileged, mfaSetupRequired } from '@/server/staff-mfa';
import { ownedFleet } from '@/server/fleet';
import { staffAlerts } from '@/server/staff-alerts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getStaff();
  if (!ctx) return Errors.unauthorized();
  let driverId: string | null = null;
  if (ctx.user.role === 'DRIVER') {
    const d = await prisma.driver.findUnique({ where: { userId: ctx.user.id } });
    driverId = d?.id ?? null;
  }
  const alerts = await staffAlerts(ctx.user);
  return apiOk({
    id: ctx.user.id, role: ctx.user.role, displayName: ctx.user.displayName, driverId,
    isOwner: ctx.user.role === 'ADMIN' && ctx.user.isOwner, // superadmin: «Бухгалтерия», «Сотрудники», «Изменения» (2026-11-23)
    unreadChanges: alerts.changes,
    pendingApplications: alerts.applications, // «Заявки» red (2026-11-23)
    docAlerts: alerts.docs, // «Водители» / «Машины» red for documents (2026-11-24)
    fleet: ctx.user.role === 'FLEET_OWNER' || ctx.user.role === 'DRIVER' ? await ownedFleet(ctx.user.id) : null,
    mfa: { eligible: isPrivileged(ctx.user), enabled: !!ctx.user.totpEnabledAt, setupRequired: mfaSetupRequired(ctx.user) },
  });
}
