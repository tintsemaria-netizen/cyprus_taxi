import { describe, it, expect } from 'vitest';
import { fareTotal, confirmedCents } from '@/lib/fare-total';

// Launch fixes §6: one rule for the ride total everywhere (receipt, history, e-mail, earnings, analytics).
const fare = (o: Partial<{ estimateCents: number | null; waitingCents: number; finalCents: number | null; paymentStatus: string }> = {}) =>
  ({ estimateCents: 2000, waitingCents: 150, finalCents: null, currency: 'EUR', paymentStatus: 'PENDING', ...o });

describe('fareTotal', () => {
  it('meter ride, no driver amount yet → estimate + app waiting, approximate, AWAITING_AMOUNT', () => {
    const t = fareTotal({ priceType: 'REGULATED_METER_ESTIMATE', completed: true, fare: fare(), settlement: null });
    expect(t).toMatchObject({ cents: 2150, approx: true, state: 'AWAITING_AMOUNT' });
    expect(confirmedCents(t)).toBeNull(); // never counted as earnings
  });

  it('meter ride with the taximeter amount → that amount only (no double waiting)', () => {
    const t = fareTotal({ priceType: 'REGULATED_METER_ESTIMATE', completed: true, fare: fare(), settlement: { reportedFinalCents: 2380, paymentReceived: false } });
    expect(t).toMatchObject({ cents: 2380, approx: false, state: 'AMOUNT_CONFIRMED', source: 'meter' });
    expect(confirmedCents(t)).toBe(2380);
  });

  it('meter ride, amount + paid → PAID', () => {
    const t = fareTotal({ priceType: 'REGULATED_METER_ESTIMATE', completed: true, fare: fare(), settlement: { reportedFinalCents: 2380, paymentReceived: true } });
    expect(t.state).toBe('PAID');
  });

  it('fixed price → price + recorded pickup waiting, exact, confirmed at completion', () => {
    const t = fareTotal({ priceType: 'REGULATED_FIXED', completed: true, fare: fare({ finalCents: 4500 }), settlement: null });
    expect(t).toMatchObject({ cents: 4650, approx: false, state: 'AMOUNT_CONFIRMED', source: 'fixed' });
    expect(fareTotal({ priceType: 'SHARED_FIXED', completed: true, fare: fare({ finalCents: 3000, waitingCents: 0, paymentStatus: 'COLLECTED' }), settlement: null }).state).toBe('PAID');
  });

  it('ride not finished → quoted price; meter approximate, fixed exact', () => {
    expect(fareTotal({ priceType: 'REGULATED_METER_ESTIMATE', completed: false, fare: null, settlement: null, quotedCents: 1900 })).toMatchObject({ cents: 1900, approx: true, state: 'ESTIMATE' });
    expect(fareTotal({ priceType: 'REGULATED_FIXED', completed: false, fare: null, settlement: null, quotedCents: 4500 })).toMatchObject({ cents: 4500, approx: false, state: 'ESTIMATE' });
  });
});
