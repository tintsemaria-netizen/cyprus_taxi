import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { resetPassengerPassword } from '@/server/admin-passengers';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const temporaryPassword = await resetPassengerPassword(id, ctx.user.id);
  if (!temporaryPassword) return Errors.notFound();
  return apiOk({ temporaryPassword });
}
