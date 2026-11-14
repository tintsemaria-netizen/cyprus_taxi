import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { passengerRides, passengerDetail } from '@/server/admin-passengers';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const profile = await passengerDetail(id);
  if (!profile) return Errors.notFound();
  return apiOk({ profile, rides: await passengerRides(id) });
}
