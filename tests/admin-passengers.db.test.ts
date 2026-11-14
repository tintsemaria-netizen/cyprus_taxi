import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { listPassengers, passengerRides } from '@/server/admin-passengers';
import { createBooking } from '@/server/bookings';
import type { CreateBookingInput } from '@/lib/validation';

// Admin "Clients" list (2026-11-14): search and per-client ride counts.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);

const RUN = `${Date.now()}`;
const input = { pickup: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Zed', phone: '+35799123456' } as CreateBookingInput;
let n = 0;

describe('admin passengers', () => {
  it('counts rides by status and finds by name/email', async () => {
    const p = await prisma.passenger.create({ data: { name: `Zed ${RUN}`, email: `zed${RUN}@example.com` } });
    for (const status of ['COMPLETED', 'COMPLETED', 'CANCELED'] as const) {
      const r = await createBooking(input, `ap-${RUN}-${++n}`, undefined, p.id);
      if (!r.ok) throw new Error('create');
      await prisma.booking.update({ where: { reference: r.body.reference }, data: { status } });
    }
    const byName = await listPassengers(`zed ${RUN}`);
    expect(byName.total).toBe(1);
    expect(byName.passengers[0]).toMatchObject({ id: p.id, rides: 3, completed: 2, canceled: 1 });
    expect((await listPassengers(`zed${RUN}@EXAMPLE`)).passengers[0]?.id).toBe(p.id);
    expect((await passengerRides(p.id)).length).toBe(3);
  });
});
