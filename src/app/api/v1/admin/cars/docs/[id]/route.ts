import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { carDocFor, decideCarDoc } from '@/server/cars';
import { readDocument } from '@/server/storage';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const { id } = await params;
  const d = await carDocFor(id);
  const buf = d ? await readDocument(d.storageKey) : null;
  if (!d || !buf) return Errors.notFound();
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': d.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON body.' }); }
  const { id } = await params;
  if (body.decision !== 'ACCEPTED' && body.decision !== 'CHANGES') return Errors.validation({ decision: 'ACCEPTED or CHANGES.' });
  const r = await decideCarDoc(id, body.decision, typeof body.note === 'string' ? body.note : undefined, typeof body.expiresAt === 'string' ? body.expiresAt : undefined);
  return r.ok ? apiOk(r.data) : apiError(r.status, r.code, r.message);
}
