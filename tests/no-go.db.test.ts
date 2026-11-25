import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { invalidateNoGoCache, noGoSchema } from '@/server/no-go';
import * as quote from '@/app/api/v1/quote/route';
import type { CreateBookingInput } from '@/lib/validation';

// «Запретная зона» (2026-11-24, operator): no pickup, stop or destination inside an active red zone.
const inside = { lat: 34.7000, lng: 33.1000, label: 'Inside' };
const lim = { lat: 34.6713, lng: 33.0423, label: 'Limassol Old Port' };
const lca = { lat: 34.8754, lng: 33.6249, label: 'Larnaca Airport' };
const sq: [number, number][] = [[34.69, 33.09], [34.69, 33.11], [34.71, 33.11], [34.71, 33.09]];
let id = '';
const inp = (p: typeof lim, d: typeof lim): CreateBookingInput => ({ pickup: p, dropoff: d, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'T', phone: '+35799123456' } as CreateBookingInput);
let n = 0; const key = () => `nogo-${Date.now()}-${++n}`;
afterAll(async () => { if (id) await prisma.noGoZone.delete({ where: { id } }).catch(() => {}); invalidateNoGoCache(); });

describe('no-go zones', () => {
  it('a pickup or destination inside an active zone is refused; switched off → allowed', async () => {
    id = (await prisma.noGoZone.create({ data: { name: 'Test base', polygon: sq } })).id;
    invalidateNoGoCache();
    for (const [p, d] of [[inside, lca], [lim, inside]] as const) {
      const r = await createBooking(inp(p, d), key());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('NO_GO_ZONE');
    }
    const q = await quote.POST(new Request('http://localhost:3000/api/v1/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.7.7.7' }, body: JSON.stringify({ pickup: lim, dropoff: inside, vClass: 'COMFORT', passengerCount: 1 }) }));
    expect(q.status).toBe(422);
    expect((await q.json()).error.code).toBe('NO_GO_ZONE');
    await prisma.noGoZone.update({ where: { id }, data: { active: false } });
    invalidateNoGoCache();
    const r = await createBooking(inp(inside, lca), key());
    if (!r.ok) expect(r.code).not.toBe('NO_GO_ZONE');
  });

  it('точки подачи: a pickup inside the (rounded) territory goes to the nearest point; outside — unchanged', async () => {
    const t = await prisma.noGoZone.create({ data: { name: 'Port', kind: 'POINT', polygon: sq, points: [{ lat: 34.7050, lng: 33.1050, name: 'Gate 3' }, { lat: 34.7005, lng: 33.1005, name: 'Gate 5' }] } });
    invalidateNoGoCache();
    try {
      const r = await createBooking(inp(inside, lca), key());
      expect(r.ok).toBe(true);
      if (r.ok) {
        const b = await prisma.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
        expect([b.pickupLat, b.pickupLng, b.pickupLabel]).toEqual([34.7005, 33.1005, 'Port · Gate 5']);
      }
      const r2 = await createBooking(inp(lim, lca), key());
      if (r2.ok) expect((await prisma.booking.findUniqueOrThrow({ where: { reference: r2.body.reference } })).pickupLat).toBe(lim.lat);
    } finally { await prisma.noGoZone.delete({ where: { id: t.id } }); invalidateNoGoCache(); }
  });
  it('точки высадки: a destination inside the territory goes to the nearest drop-off point, apart from the pickup points', async () => {
    const t = await prisma.noGoZone.create({ data: { name: 'Port', kind: 'POINT', polygon: sq, points: [{ lat: 34.7050, lng: 33.1050, name: 'Gate 3' }], dropPoints: [{ lat: 34.6985, lng: 33.0985, name: 'Departures' }, { lat: 34.7060, lng: 33.0960, name: 'Cruise' }] } });
    invalidateNoGoCache();
    try {
      const r = await createBooking(inp(lim, inside), key());
      expect(r.ok).toBe(true);
      if (r.ok) {
        const b = await prisma.booking.findUniqueOrThrow({ where: { reference: r.body.reference } });
        expect([b.dropoffLat, b.dropoffLng, b.dropoffLabel]).toEqual([34.6985, 33.0985, 'Port · Departures']);
      }
    } finally { await prisma.noGoZone.delete({ where: { id: t.id } }); invalidateNoGoCache(); }
    // pickup and drop-off points may stand on one spot (operator 2026-11-26; was ≥ 15 m apart)
    const base = { name: 'P', kind: 'POINT' as const, polygon: sq, points: [{ lat: 34.70, lng: 33.10, name: '' }] };
    expect(noGoSchema.safeParse({ ...base, dropPoints: [{ lat: 34.70, lng: 33.10, name: '' }] }).success).toBe(true);
    expect(noGoSchema.safeParse({ ...base, dropPoints: [{ lat: 34.7010, lng: 33.10, name: '' }] }).success).toBe(true);
  });
});
