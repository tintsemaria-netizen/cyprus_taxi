import { Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { driverExists, driverReportResponse } from '@/server/reports/driver-report';

export const dynamic = 'force-dynamic';

// The admin's view of one driver's reports (2026-11-20): the very same figures the driver sees.
// GET /api/v1/admin/drivers/:id/report/{earnings|duty|analytics|export}
export async function GET(req: Request, { params }: { params: Promise<{ id: string; part: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id, part } = await params;
  if (!(await driverExists(id))) return Errors.notFound();
  return driverReportResponse(id, part, new URL(req.url));
}
