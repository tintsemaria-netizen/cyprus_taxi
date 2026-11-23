import { describe, it, expect } from 'vitest';
import { createBooking } from '@/server/bookings';
import * as quote from '@/app/api/v1/quote/route';
import type { CreateBookingInput } from '@/lib/validation';

// 2026-11-24 (operator): no pickup, stop or destination off the island of Cyprus — neither a price nor an order.
const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const sea = { lat: 34.62, lng: 33.05, label: 'Sea south of Limassol' };
const input = (p: typeof marina, d: typeof marina): CreateBookingInput =>
  ({ pickup: p, dropoff: d, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);
const RUN = `${Date.now()}`;
let n = 0;

describe('off-island points', () => {
  it('a booking with the pickup or destination in the sea is refused', async () => {
    for (const [p, d] of [[sea, marina], [marina, sea]] as const) {
      const r = await createBooking(input(p, d), `off-${RUN}-${++n}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('OFF_ISLAND');
    }
  });
  it('a quote off the island is refused with OFF_ISLAND', async () => {
    const res = await quote.POST(new Request('http://localhost:3000/api/v1/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.${n}.1` },
      body: JSON.stringify({ pickup: marina, dropoff: sea, vClass: 'COMFORT', passengerCount: 1 }) }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('OFF_ISLAND');
  });
});
