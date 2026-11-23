import { describe, it, expect } from 'vitest';
import { completedTotalCents } from '@/lib/fare-total';
import { resolveFinal } from '@/server/driver/earnings';

// Operator 2026-11-24: the amount fixed at «Завершить» — with waiting — is the same in the receipt
// and in the driver's earnings / analytics / bookkeeping; a driver's correction of a meter ride replaces it.
const meter = { priceType: 'REGULATED_METER_ESTIMATE', estimateCents: 1460, waitingCents: 120, finalCents: null, currency: 'EUR', paymentStatus: 'PENDING' };
const fixed = { priceType: 'REGULATED_FIXED', estimateCents: 5500, waitingCents: 300, finalCents: 5500, currency: 'EUR', paymentStatus: 'PENDING' };

describe('one completed-ride total', () => {
  it('meter ride: the app fare + waiting, counted at once (not «pending»)', () => {
    expect(completedTotalCents(meter)).toBe(1580);
    expect(resolveFinal(meter, null)).toMatchObject({ finalCents: 1580, source: 'completion' });
  });
  it('fixed price: price + waiting everywhere (55 € + 3 € = 58 €)', () => {
    expect(completedTotalCents(fixed)).toBe(5800);
    expect(resolveFinal(fixed, null).finalCents).toBe(5800);
  });
  it('a driver correction replaces a meter ride amount; a fixed price cannot be corrected', () => {
    const corr = { reportedFinalCents: 1720, currency: 'EUR', paymentReceived: true };
    expect(completedTotalCents(meter, 1720)).toBe(1720);
    expect(resolveFinal(meter, corr)).toMatchObject({ finalCents: 1720, source: 'settlement', collected: true });
    expect(completedTotalCents(fixed, 9999)).toBe(5800);
    expect(resolveFinal(fixed, corr).finalCents).toBe(5800);
  });
});
