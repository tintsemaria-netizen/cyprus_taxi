import { Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { carDocFor } from '@/server/cars';
import { readDocument } from '@/server/storage';

export const dynamic = 'force-dynamic';

// His own new-car document (authenticated, never a public URL).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const d = await carDocFor(id);
  if (!d || d.request?.driverId !== ctx.driver.id) return Errors.forbidden();
  const buf = await readDocument(d.storageKey);
  if (!buf) return Errors.notFound();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': d.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' } });
}
