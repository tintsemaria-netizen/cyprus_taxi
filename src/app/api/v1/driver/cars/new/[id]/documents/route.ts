import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { uploadCarDoc } from '@/server/cars';

export const dynamic = 'force-dynamic';
const MAX = 20 * 1024 * 1024;

// A document / photo of the new car (raw bytes, ?slot=).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const slot = new URL(req.url).searchParams.get('slot') || '';
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return Errors.validation({ _: 'Empty upload.' });
  if (buf.length > MAX) return Errors.validation({ file: 'File too large.' });
  const r = await uploadCarDoc(ctx.driver.id, id, slot, buf);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
