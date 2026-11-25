import { describe, it, expect } from 'vitest';
import { createBooking } from '@/server/bookings';
import { prisma } from '@/lib/db';
import type { CreateBookingInput } from '@/lib/validation';

// 2026-11-24 (operator): a co-rider order carries at most 3 people and 3 suitcases (up to 10 kg).
const lca = { lat: 34.8754, lng: 33.6249, label: 'Larnaca Airport' }, lim = { lat: 34.6713, lng: 33.0423, label: 'Limassol Old Port' };
const inp = (pax: number, bags: number): CreateBookingInput => ({ pickup: lim, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: pax, luggageCount: bags,
  passengerName: 'Test', phone: '+35799123456', shareOptIn: true, shareMaxExtraMin: 15 } as CreateBookingInput);
let n = 0; const key = () => `share-lim-${Date.now()}-${++n}`;

describe('co-rider size limits', () => {
  it('4 people or 4 suitcases with a co-rider are refused; 3 + 3 is fine', async () => {
    for (const [p, b] of [[4, 1], [1, 4]]) {
      const r = await createBooking(inp(p, b), key());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('SHARE_TOO_BIG');
    }
    const r = await createBooking(inp(3, 3), key());
    if (!r.ok) expect(r.code).not.toBe('SHARE_TOO_BIG');
  });
  it('without a co-rider the usual car limits apply', async () => {
    const r = await createBooking({ ...inp(5, 5), vClass: 'XL', shareOptIn: false } as CreateBookingInput, key());
    if (!r.ok) expect(r.code).not.toBe('SHARE_TOO_BIG');
  });
  it('«Попутчик» is Comfort only: an XL booking is saved without a co-rider (2026-11-25)', async () => {
    const r = await createBooking({ ...inp(2, 1), vClass: 'XL' } as CreateBookingInput, key());
    expect(r.ok).toBe(true);
    if (r.ok) expect((await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!.shareOptIn).toBe(false);
    const c = await createBooking(inp(2, 1), key());
    expect(c.ok).toBe(true);
    if (c.ok) expect((await prisma.booking.findUnique({ where: { reference: c.body.reference } }))!.shareOptIn).toBe(true);
  });
});
