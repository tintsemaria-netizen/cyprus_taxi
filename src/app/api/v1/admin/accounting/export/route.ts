import { Errors } from '@/lib/http';
import { requireOwner, accountingCsv, type PeriodKind } from '@/server/accounting';

export const dynamic = 'force-dynamic';

// CSV of the period's entries for the accountant (opens in Excel).
export async function GET(req: Request) {
  const ctx = await requireOwner();
  if ('error' in ctx) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const u = new URL(req.url);
  const k = u.searchParams.get('period');
  const kind: PeriodKind = k === 'quarter' || k === 'year' ? k : 'month';
  return accountingCsv(kind, u.searchParams.get('key'));
}
