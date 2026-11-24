import { apiOk, apiError, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { uploadCarRenewal } from '@/server/cars';

export const dynamic = 'force-dynamic';
const MAX = 20 * 1024 * 1024;

// The owner uploads a new insurance / taxi licence / photo of his car (2026-11-24, raw bytes, ?slot=).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const slot = new URL(req.url).searchParams.get('slot') || '';
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return Errors.validation({ _: 'Empty upload.' });
  if (buf.length > MAX) return Errors.validation({ file: 'File too large.' });
  const r = await uploadCarRenewal(ctx.driver.id, id, slot, buf);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
