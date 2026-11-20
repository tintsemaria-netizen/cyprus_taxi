import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { driverFigures } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// Today + this week for every driver at a glance (admin «Водители» list, 2026-11-20).
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const drivers = await prisma.driver.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  return apiOk({ figures: await driverFigures(drivers.map((d) => d.id)) });
}
