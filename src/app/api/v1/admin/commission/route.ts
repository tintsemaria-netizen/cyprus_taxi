import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { commissionMode, commissionSummary } from '@/server/commission';

export const dynamic = 'force-dynamic';

// Launch fixes §9: commission in CALCULATION mode — rules, per-driver balances. ADMIN only.
export async function GET() {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const rules = await prisma.commissionRule.findMany({ orderBy: { version: 'desc' }, take: 20 });
  return apiOk({
    mode: commissionMode(),
    label: 'CALCULATION ONLY — no approved commission terms; nothing is demanded from drivers.',
    rules: rules.map((r) => ({ version: r.version, ratePct: r.rateBp / 100, base: r.base, currency: r.currency, effectiveFrom: r.effectiveFrom.toISOString(), note: r.note })),
    drivers: await commissionSummary(),
  });
}
