import { apiOk, Errors } from '@/lib/http';
import { requireFleetOwner, isFleetCtx } from '@/server/fleet';
import { docAttention } from '@/server/doc-renewal';

export const dynamic = 'force-dynamic';

// «Мой автопарк» (2026-11-24, operator): the owner sees which of his drivers / cars have a document
// expiring, expired, or a new one waiting for the operator's check. Read-only — the operator accepts.
export async function GET() {
  const ctx = await requireFleetOwner();
  if (!isFleetCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const items = (await docAttention(new Date(), ctx.fleet.id)).map((a) => ({ ...a, applicationId: '' })); // no admin links
  return apiOk({ items });
}
