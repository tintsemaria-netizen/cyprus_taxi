import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { adminCarDocs } from '@/server/cars';

export const dynamic = 'force-dynamic';

// Documents of a car added through «Мои машины» (2026-11-24): current and newly uploaded.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const r = await adminCarDocs(id);
  return r ? apiOk(r) : Errors.notFound();
}
