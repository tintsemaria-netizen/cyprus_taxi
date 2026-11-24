import { apiOk, Errors } from '@/lib/http';
import { requireDriver, isDriverCtx } from '@/lib/driver-ctx';
import { driverDocuments } from '@/server/driver/documents';
import { uploadRenewal } from '@/server/doc-renewal';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  return apiOk(await driverDocuments(ctx.driver));
}

const MAX = 20 * 1024 * 1024;

// The driver uploads a new licence / taxi licence / insurance / roadworthiness himself (2026-11-24, raw
// file bytes; ?slot=). It waits for the operator; the accepted one stays until then (option «б»).
export async function POST(req: Request) {
  const ctx = await requireDriver();
  if (!isDriverCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const slot = new URL(req.url).searchParams.get('slot') || '';
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return Errors.validation({ _: 'Empty upload.' });
  if (buf.length > MAX) return Errors.validation({ file: 'File too large.' });
  const r = await uploadRenewal(ctx.driver.id, slot, buf);
  if (!r.ok) return Errors.validation({ [r.code === 'BAD_SLOT' ? 'slot' : 'file']: r.message });
  return apiOk({ id: r.id, scanStatus: r.scanStatus });
}
