import { apiOk, apiError, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Launch fixes §9: a new rule version (rate %, effective date). Versions are never edited.
export async function POST(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  let body: { ratePct?: number; effectiveFrom?: string; note?: string; currency?: string };
  try { body = await req.json(); } catch { return Errors.validation({ _: 'Invalid JSON.' }); }
  const rateBp = Math.round((body.ratePct ?? NaN) * 100);
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 5000) return Errors.validation({ ratePct: '0–50 %.' });
  const from = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
  if (Number.isNaN(from.getTime())) return Errors.validation({ effectiveFrom: 'Invalid date.' });
  const note = (body.note || '').trim();
  if (note.length < 3) return Errors.validation({ note: 'Say where these terms come from (e.g. «scenario, not approved»).' });
  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(920601)`; // serialize version numbers
    const last = await tx.commissionRule.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
    const rule = await tx.commissionRule.create({ data: { version: (last?.version ?? 0) + 1, rateBp, effectiveFrom: from, note: note.slice(0, 300), currency: body.currency || 'EUR', createdById: ctx.user.id } });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, actorRole: 'ADMIN', action: 'COMMISSION_RULE', detail: `v${rule.version} ${rateBp}bp from ${from.toISOString()}` } });
    return rule;
  });
  if (!r) return apiError(500, 'FAILED', 'Could not save.');
  return apiOk({ version: r.version }, 201);
}
