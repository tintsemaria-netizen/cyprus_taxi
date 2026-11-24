import { apiOk, Errors } from '@/lib/http';
import { requireStaff, isStaffCtx } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Staff alerts (launch fixes §8/§3, ported 2026-11-24): pre-bookings that went to automatic search, were
// taken off a driver who could not make it, or were given back late; receipt e-mails that failed. Last 7
// days. ADMIN and DISPATCHER. No passenger data — the booking reference only.
export async function GET() {
  const ctx = await requireStaff(['ADMIN', 'DISPATCHER']);
  if (!isStaffCtx(ctx)) return ctx.error === 401 ? Errors.unauthorized() : Errors.forbidden();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await prisma.auditEvent.findMany({ where: { action: { startsWith: 'ALERT_' }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 50 });
  const ids = [...new Set(rows.map((r) => r.target).filter((x): x is string => !!x))];
  const refs = new Map((await prisma.booking.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true } })).map((b) => [b.id, b.reference]));
  const failedEmails = await prisma.receiptEmail.count({ where: { status: 'FAILED', updatedAt: { gte: since } } });
  return apiOk({
    alerts: rows.map((r) => ({ at: r.createdAt.toISOString(), kind: r.action, detail: r.detail, bookingRef: r.target ? refs.get(r.target) ?? null : null })),
    failedReceiptEmails: failedEmails,
  });
}
