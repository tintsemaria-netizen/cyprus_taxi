// Commission — CALCULATION MODE ONLY (launch fixes §9, 2026-11-20).
//
// What it does: when a ride's amount becomes confirmed (driver entered the taximeter amount, or a
// fixed price at completion), the commission from the admin-entered rule in force at completion is
// booked in an append-only ledger; a later correction of the amount books an ADJUSTMENT (the
// difference), never an edit. Admins can record a payment the driver actually made (with a
// reference — idempotent), a credit or a write-off. Everything is audited.
//
// What it does NOT do (until the business approves terms): no rate by default (12 % from the
// financial review is a scenario assumption, NOT a tariff), no demand to pay shown to drivers, no
// debt limit (offer blocking stays OFF), no card charges, no penalties. COMMISSION_MODE=calc turns
// accruals on; anything else = off.
//
// Unpaid ride rule (explicit): commission accrues on the CONFIRMED amount whether or not the
// passenger has paid the driver; a cancelled ride or one without a confirmed amount accrues nothing.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { fareTotal, confirmedCents } from '@/lib/fare-total';

type Tx = Prisma.TransactionClient;
export const commissionMode = (): 'calc' | 'off' => ((process.env.COMMISSION_MODE || '').toLowerCase() === 'calc' ? 'calc' : 'off');

/** Commission in cents, rounded half away from zero (no float drift: integer arithmetic). */
export function commissionCents(basisCents: number, rateBp: number): number {
  const num = basisCents * rateBp;
  const q = Math.trunc(num / 10000), r = num % 10000;
  return Math.abs(r) * 2 >= 10000 ? q + Math.sign(num) : q;
}

async function ruleAt(tx: Tx, at: Date) {
  return tx.commissionRule.findFirst({ where: { effectiveFrom: { lte: at } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] });
}

/**
 * Book (or correct) the commission for one ride. Call inside the transaction that confirmed or
 * changed the amount (booking row already locked). Idempotent: replaying the same state books
 * nothing; a changed amount books exactly the difference.
 */
export async function accrueCommissionTx(tx: Tx, bookingId: string): Promise<{ booked: number } | null> {
  if (commissionMode() !== 'calc') return null;
  const b = await tx.booking.findUnique({ where: { id: bookingId }, select: { status: true, priceType: true, fare: { select: { estimateCents: true, waitingCents: true, finalCents: true, currency: true, paymentStatus: true, priceType: true } } } });
  if (!b || b.status !== 'COMPLETED' || !b.fare) return null;
  const asg = await tx.assignment.findFirst({ where: { bookingId, reason: 'completed' }, orderBy: { endedAt: 'desc' }, select: { driverId: true, endedAt: true } });
  if (!asg?.endedAt) return null;
  const settle = await tx.driverSettlement.findFirst({ where: { bookingId }, orderBy: { revision: 'desc' }, select: { reportedFinalCents: true, currency: true, paymentReceived: true, revision: true } });
  const t = fareTotal({ priceType: b.fare.priceType ?? b.priceType, completed: true, fare: b.fare, settlement: settle });
  const basis = confirmedCents(t);
  if (basis == null) return null; // not confirmed yet → nothing owed yet
  const rule = await ruleAt(tx, asg.endedAt);
  if (!rule) return null; // no rule entered → nothing calculated
  const target = commissionCents(basis, rule.rateBp);
  const prior = await tx.commissionEntry.aggregate({ where: { bookingId, kind: { in: ['ACCRUAL', 'ADJUSTMENT'] } }, _sum: { amountCents: true }, _count: true });
  const delta = target - (prior._sum.amountCents ?? 0);
  if (delta === 0 && prior._count > 0) return { booked: 0 };
  const kind = prior._count === 0 ? 'ACCRUAL' : 'ADJUSTMENT';
  const sourceKey = `acc:${bookingId}:${settle?.revision ?? 'fixed'}:v${rule.version}:${basis}`;
  try {
    await tx.commissionEntry.create({ data: { driverId: asg.driverId, bookingId, kind, amountCents: delta, currency: t.currency ?? rule.currency, ruleVersion: rule.version, basisCents: basis, sourceKey, note: kind === 'ADJUSTMENT' ? 'ride amount corrected' : null } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { booked: 0 }; // replay
    throw e;
  }
  return { booked: delta };
}

export type ManualKind = 'PAYMENT' | 'CREDIT' | 'WRITE_OFF';
/**
 * Admin-confirmed money movement. `reference` (bank/cash receipt number) makes it idempotent —
 * a double click or a retried request never counts a payment twice. Amount > 0; stored negative.
 */
export async function recordManualEntry(p: { driverId: string; kind: ManualKind; amountCents: number; reference: string; note?: string; staffId: string }): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: string; message: string }> {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0 || p.amountCents > 10_000_000) return { ok: false, code: 'BAD_AMOUNT', message: 'Enter a positive amount in cents.' };
  const ref = p.reference.trim();
  if (ref.length < 3 || ref.length > 100) return { ok: false, code: 'REFERENCE_REQUIRED', message: 'A reference (receipt / transfer number) is required.' };
  if (p.kind !== 'PAYMENT' && !(p.note && p.note.trim().length >= 3)) return { ok: false, code: 'REASON_REQUIRED', message: 'A reason is required for a credit or write-off.' };
  const driver = await prisma.driver.findUnique({ where: { id: p.driverId }, select: { id: true } });
  if (!driver) return { ok: false, code: 'NOT_FOUND', message: 'Driver not found.' };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.commissionEntry.create({ data: { driverId: p.driverId, kind: p.kind, amountCents: -p.amountCents, sourceKey: `${p.kind.toLowerCase()}:${p.driverId}:${ref}`, note: p.note?.slice(0, 300) ?? null, createdById: p.staffId } });
      await tx.auditEvent.create({ data: { actorId: p.staffId, actorRole: 'ADMIN', action: `COMMISSION_${p.kind}`, target: p.driverId, detail: `${p.amountCents} ref ${ref.slice(0, 40)}` } });
    });
    return { ok: true, duplicate: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true, duplicate: true };
    throw e;
  }
}

export interface DriverCommissionRow { driverId: string; name: string; accruedCents: number; paidCents: number; creditCents: number; writtenOffCents: number; balanceCents: number }
/** Per-driver balances: accrued (accruals + adjustments) minus payments, credits and write-offs. */
export async function commissionSummary(): Promise<DriverCommissionRow[]> {
  const g = await prisma.commissionEntry.groupBy({ by: ['driverId', 'kind'], _sum: { amountCents: true } });
  const names = new Map((await prisma.driver.findMany({ where: { id: { in: [...new Set(g.map((x) => x.driverId))] } }, select: { id: true, publicName: true } })).map((d) => [d.id, d.publicName]));
  const rows = new Map<string, DriverCommissionRow>();
  for (const x of g) {
    const r = rows.get(x.driverId) ?? { driverId: x.driverId, name: names.get(x.driverId) ?? '—', accruedCents: 0, paidCents: 0, creditCents: 0, writtenOffCents: 0, balanceCents: 0 };
    const s = x._sum.amountCents ?? 0;
    if (x.kind === 'ACCRUAL' || x.kind === 'ADJUSTMENT') r.accruedCents += s;
    else if (x.kind === 'PAYMENT') r.paidCents += -s;
    else if (x.kind === 'CREDIT') r.creditCents += -s;
    else if (x.kind === 'WRITE_OFF') r.writtenOffCents += -s;
    r.balanceCents += s;
    rows.set(x.driverId, r);
  }
  return [...rows.values()].sort((a, b) => b.balanceCents - a.balanceCents);
}

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** Reconciliation CSV: one line per ledger entry (ride ref, confirmed amount, rule version, commission, payments). */
export async function commissionCsv(from: Date, to: Date): Promise<string> {
  const rows = await prisma.commissionEntry.findMany({ where: { createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' } });
  const refs = new Map((await prisma.booking.findMany({ where: { id: { in: rows.map((r) => r.bookingId).filter((x): x is string => !!x) } }, select: { id: true, reference: true } })).map((b) => [b.id, b.reference]));
  const names = new Map((await prisma.driver.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.driverId))] } }, select: { id: true, publicName: true } })).map((d) => [d.id, d.publicName]));
  const head = ['mode', 'date', 'driver', 'ride', 'kind', 'confirmed_total_cents', 'rule_version', 'amount_cents', 'currency', 'note'];
  const lines = rows.map((r) => [commissionMode() === 'calc' ? 'CALCULATION' : 'OFF', r.createdAt.toISOString(), names.get(r.driverId) ?? r.driverId, r.bookingId ? refs.get(r.bookingId) ?? '' : '', r.kind, r.basisCents ?? '', r.ruleVersion ?? '', r.amountCents, r.currency, r.note ?? ''].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}
