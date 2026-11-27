import { describe, it, expect } from 'vitest';
import { lateCancelSchedule, lateCancelAt, lateCancelAfterMin } from '@/lib/late-cancel';
import { paysByCard } from '@/lib/payment-method';

// Late-cancel fees (operator 2026-11-26), card only: no-show 4 € after 3 free + 2 paid min at the pickup;
// a pre-booking cancelled less than 30 min before pickup 10 €.
const r = { noShowCents: 400, afterPaidMin: 2, prebookCents: 1000, prebookMin: 30 };
const T = new Date('2026-11-26T10:00:00Z');
const at = (min: number) => new Date(T.getTime() + min * 60_000);

describe('late-cancel fees', () => {
  it('no-show: free in the first 5 minutes at the pickup, 4 € after — with card', () => {
    const list = lateCancelSchedule({ pickupAt: null, waiting: { arrivedAt: T, graceSeconds: 180 } }, true, r);
    expect(lateCancelAt(list, at(4.9))).toBeNull();
    expect(lateCancelAt(list, at(5))?.feeCents).toBe(400);
    expect(lateCancelAfterMin(180, r)).toBe(5);
  });
  it('pre-booking: free until 30 min before pickup, 10 € inside the 30 min; at the pickup the ordinary 3 + 2 min → 4 €', () => {
    const pickupAt = at(60);
    expect(lateCancelAt(lateCancelSchedule({ pickupAt, waiting: null }, true, r), at(29))).toBeNull();
    expect(lateCancelAt(lateCancelSchedule({ pickupAt, waiting: null }, true, r), at(30))).toMatchObject({ kind: 'prebook', feeCents: 1000 });
    const arrived = lateCancelSchedule({ pickupAt, waiting: { arrivedAt: at(58), graceSeconds: 180 } }, true, r);
    expect(lateCancelAt(arrived, at(62))).toBeNull();
    expect(lateCancelAt(arrived, at(63))).toMatchObject({ kind: 'noShow', feeCents: 400 });
  });
  it('never with cash; no ride pays by card yet — the rule is dormant', () => {
    expect(lateCancelSchedule({ pickupAt: at(10), waiting: { arrivedAt: T, graceSeconds: 180 } }, false, r)).toEqual([]);
    expect(paysByCard({ id: 'x' })).toBe(false);
  });
});
