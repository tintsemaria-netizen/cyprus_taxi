import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { reliabilityView } from '@/server/reports/reliability-view';

export const dynamic = 'force-dynamic';

// The admin's driver card: «Рейтинг и надёжность» (2026-11-27), same tool as the driver's own.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const v = await reliabilityView(id);
  return v ? apiOk(v) : Errors.notFound();
}
