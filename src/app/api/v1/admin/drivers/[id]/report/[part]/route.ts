import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { reportAnalytics, reportDuty, reportEarnings, reportStatementCsv, driverExists } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// The admin's view of one driver's reports (2026-11-20): the very same figures the driver sees.
// GET /api/v1/admin/drivers/:id/report/{earnings|duty|analytics|export}
export async function GET(req: Request, { params }: { params: Promise<{ id: string; part: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id, part } = await params;
  if (!(await driverExists(id))) return Errors.notFound();
  const url = new URL(req.url);
  switch (part) {
    case 'earnings': return apiOk(await reportEarnings(id, url));
    case 'duty': return apiOk(await reportDuty(id));
    case 'analytics': return apiOk(await reportAnalytics(id, url));
    case 'export': {
      const d = await prisma.driver.findUnique({ where: { id }, select: { user: { select: { login: true } } } });
      return reportStatementCsv(id, url, d?.user.login ?? 'driver');
    }
    default: return Errors.notFound();
  }
}
