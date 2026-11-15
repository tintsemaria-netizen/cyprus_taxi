import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { farePreview } from '@/server/trip-close';

export const dynamic = 'force-dynamic';

// What the trip will cost if completed now — shown before the driver's final «Завершить».
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const p = await farePreview(id, ctx.driver.id);
  if (!p) return Errors.notFound('Ride not found.');
  return apiOk(p);
}
