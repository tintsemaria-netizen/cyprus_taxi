// Late-cancel fees (operator 2026-11-26), CARD payment only — before that, or with cash, a cancel is free:
//  • no-show: the driver is at the pickup and the free wait + `afterPaidMin` paid minutes are over → `noShowCents`;
//  • pre-booking: less than `prebookMin` minutes before the booked pickup time, the driver not yet there → `prebookCents`.
// The driver at the pickup: only the no-show rule.
export interface LateCancelRule { noShowCents: number; afterPaidMin: number; prebookCents: number; prebookMin: number }
export type LateCancelKind = 'noShow' | 'prebook';
export interface LateCancel { kind: LateCancelKind; feeCents: number; at: Date }

/** Every fee that can apply to this booking, with the moment it starts (sorted by start). */
export function lateCancelSchedule(
  b: { pickupAt: Date | null; waiting: { arrivedAt: Date; graceSeconds: number } | null },
  card: boolean, r: LateCancelRule,
): LateCancel[] {
  if (!card) return [];
  const out: LateCancel[] = [];
  // Once the driver is at the pickup, a pre-booking follows the ordinary rule (3 free + 2 paid min, then the
  // no-show fee) — the 10 € is only for cancelling inside the 30 min before he arrives (operator 2026-11-27).
  if (b.pickupAt && r.prebookCents > 0 && !b.waiting) out.push({ kind: 'prebook', feeCents: r.prebookCents, at: new Date(b.pickupAt.getTime() - r.prebookMin * 60_000) });
  if (b.waiting && r.noShowCents > 0) out.push({ kind: 'noShow', feeCents: r.noShowCents, at: new Date(b.waiting.arrivedAt.getTime() + (b.waiting.graceSeconds + r.afterPaidMin * 60) * 1000) });
  return out.sort((x, y) => x.at.getTime() - y.at.getTime());
}

/** The fee if the passenger cancelled at `now` (the larger one that has started), else null. */
export function lateCancelAt(list: LateCancel[], now: Date): LateCancel | null {
  const due = list.filter((f) => now.getTime() >= f.at.getTime());
  return due.length ? due.reduce((a, b) => (b.feeCents > a.feeCents ? b : a)) : null;
}

/** Minutes after arrival from which the no-show fee applies (for the text). */
export const lateCancelAfterMin = (graceSeconds: number, r: Pick<LateCancelRule, 'afterPaidMin'>) => Math.round(graceSeconds / 60) + r.afterPaidMin;

/** Seconds after arrival from which the driver may close the ride as a no-show — when the fee starts (2026-11-27). */
export const noShowAfterSec = (graceSeconds: number, r: Pick<LateCancelRule, 'afterPaidMin'>) => graceSeconds + r.afterPaidMin * 60;
