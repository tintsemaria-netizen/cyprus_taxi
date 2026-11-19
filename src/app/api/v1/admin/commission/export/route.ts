import { Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { commissionCsv } from '@/server/commission';

export const dynamic = 'force-dynamic';

// Launch fixes §9: reconciliation CSV for [from, to) (default: last 31 days). ADMIN only.
export async function GET(req: Request) {
  const ctx = await requireStaff(['ADMIN']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const u = new URL(req.url);
  const to = u.searchParams.get('to') ? new Date(u.searchParams.get('to')!) : new Date();
  const from = u.searchParams.get('from') ? new Date(u.searchParams.get('from')!) : new Date(to.getTime() - 31 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Errors.validation({ from: 'Invalid date.' });
  return new Response(await commissionCsv(from, to), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="commission-calculation.csv"', 'cache-control': 'no-store' } });
}
